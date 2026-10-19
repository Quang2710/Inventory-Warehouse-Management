import { DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import type { Product, Stocktake, StocktakeLine } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { isApiError } from '../../../core/http/api-error';
import { NetworkStatus } from '../../../core/offline/network-status.service';
import { StocktakeOfflineStore, type QueuedCount } from './stocktake-offline';
import { StocktakesApi } from './stocktakes.api';

interface CountSessionState {
  stocktake: Stocktake | null;
  /** Dòng theo server + số đếm chưa đồng bộ đã áp lên (lạc quan). */
  lines: StocktakeLine[];
  pending: QueuedCount[];
  syncing: boolean;
  lastSyncedAt: string | null;
  /** Thời điểm bản chụp offline đang hiển thị (khi chưa nạp được từ server). */
  cachedAt: string | null;
  loadError: unknown;
  /** Số đếm vừa bị bỏ qua vì thiết bị khác có số mới hơn. */
  staleCount: number;
}

const SYNC_BATCH = 200;
const RETRY_MS = 20_000;

function lineKey(locationId: string, productId: string): string {
  return `${locationId}|${productId}`;
}

/** Áp các số đếm chưa đồng bộ lên danh sách dòng (dòng ngoài danh sách được thêm tạm). */
function overlay(
  lines: readonly StocktakeLine[],
  pending: readonly QueuedCount[],
): StocktakeLine[] {
  const result = [...lines];
  for (const entry of pending) {
    const index = entry.lineId
      ? result.findIndex((line) => line.id === entry.lineId)
      : result.findIndex(
          (line) =>
            lineKey(line.locationId, line.productId) ===
            lineKey(entry.locationId ?? '', entry.productId ?? ''),
        );
    const patch = {
      countedQuantity: entry.countedQuantity,
      countedAt: entry.countedAt,
      note: entry.note,
    };
    if (index >= 0) {
      result[index] = { ...result[index], ...patch };
    } else if (entry.locationId && entry.productId && entry.display) {
      result.push({
        id: `local-${entry.clientId}`,
        locationId: entry.locationId,
        productId: entry.productId,
        ...entry.display,
        expectedQuantity: 0,
        variance: null,
        stockChanged: false,
        unexpected: true,
        ...patch,
      });
    }
  }
  return result;
}

/**
 * Phiên đếm kiểm kê offline-first (cung cấp ở cấp component trang đếm):
 * 1. Mở trang: hiện ngay bản chụp trong IndexedDB, rồi làm mới từ server khi có mạng.
 * 2. Mỗi số đếm được ghi vào hàng đợi IndexedDB TRƯỚC, cập nhật giao diện ngay.
 * 3. Hàng đợi tự đồng bộ theo lô khi có mạng (sự kiện online + thử lại định kỳ);
 *    server áp dụng idempotent theo `clientId`, xung đột giải theo `countedAt` mới nhất.
 */
export const CountSessionStore = signalStore(
  withState<CountSessionState>({
    stocktake: null,
    lines: [],
    pending: [],
    syncing: false,
    lastSyncedAt: null,
    cachedAt: null,
    loadError: null,
    staleCount: 0,
  }),
  withProps(() => ({
    _api: inject(StocktakesApi),
    _offline: inject(StocktakeOfflineStore),
    _network: inject(NetworkStatus),
    _auth: inject(AuthStore),
  })),
  withComputed((store) => ({
    countedCount: computed(
      () => store.lines().filter((line) => line.countedQuantity !== null).length,
    ),
    pendingCount: computed(() => store.pending().length),
    online: computed(() => store._network.online()),
    editable: computed(
      () =>
        store.stocktake()?.status === 'IN_PROGRESS' && store._auth.hasPermission('stocktake:count'),
    ),
  })),
  withMethods((store) => {
    /** Dòng gốc từ server (chưa áp hàng đợi) — để dựng lại sau mỗi thay đổi. */
    let serverLines: StocktakeLine[] = [];

    const recompute = (pending: QueuedCount[]) =>
      patchState(store, { pending, lines: overlay(serverLines, pending) });

    const persist = async () => {
      const stocktake = store.stocktake();
      if (stocktake) {
        await store._offline.saveSession({
          stocktake,
          lines: serverLines,
          savedAt: new Date().toISOString(),
        });
      }
    };

    const refreshFromServer = async (id: string) => {
      const [stocktake, lines] = await Promise.all([
        firstValueFrom(store._api.get(id, true)),
        firstValueFrom(store._api.lines(id, true)),
      ]);
      serverLines = lines;
      patchState(store, { stocktake, cachedAt: null, loadError: null });
      recompute(await store._offline.pending(id));
      await persist();
    };

    const sync = async (): Promise<void> => {
      const stocktake = store.stocktake();
      if (
        !stocktake ||
        store.syncing() ||
        store.pending().length === 0 ||
        !store._network.online()
      ) {
        return;
      }
      patchState(store, { syncing: true });
      try {
        while (store.pending().length > 0) {
          const batch = store.pending().slice(0, SYNC_BATCH);
          const result = await firstValueFrom(
            store._api.submitCounts(stocktake.id, {
              entries: batch.map(({ stocktakeId: _id, display: _display, ...entry }) => entry),
            }),
          );
          const updated = [
            ...result.applied.map((item) => item.line),
            ...result.skipped.flatMap((item) => (item.line ? [item.line] : [])),
          ];
          for (const line of updated) {
            const index = serverLines.findIndex(
              (item) =>
                item.id === line.id ||
                lineKey(item.locationId, item.productId) ===
                  lineKey(line.locationId, line.productId),
            );
            if (index >= 0) serverLines[index] = line;
            else serverLines = [...serverLines, line];
          }
          const done = [...result.applied, ...result.skipped].map((item) => item.clientId);
          await store._offline.dequeue(done);
          const stale = result.skipped.filter((item) => item.reason === 'STALE').length;
          patchState(store, {
            staleCount: store.staleCount() + stale,
            lastSyncedAt: new Date().toISOString(),
          });
          recompute(store.pending().filter((entry) => !done.includes(entry.clientId)));
          await persist();
        }
      } catch (error) {
        // Phiên đã chuyển trạng thái (vd đã gửi duyệt) → không đồng bộ được nữa; còn lại: chờ thử lại.
        if (isApiError(error) && error.status === 409) {
          // Số đếm còn lại không thể áp dụng cho phiên đã đóng — dọn hàng đợi, giao diện chuyển chỉ xem.
          await store._offline.dequeue(store.pending().map((entry) => entry.clientId));
          recompute([]);
          await refreshFromServer(stocktake.id).catch(() => undefined);
        }
      } finally {
        patchState(store, { syncing: false });
      }
    };

    const enqueue = async (entry: QueuedCount) => {
      await store._offline.enqueue(entry);
      recompute([...store.pending(), entry]);
      void sync();
    };

    return {
      async load(id: string): Promise<void> {
        serverLines = [];
        patchState(store, {
          stocktake: null,
          lines: [],
          pending: [],
          loadError: null,
          staleCount: 0,
        });
        const cached = await store._offline.loadSession(id);
        if (cached) {
          serverLines = cached.lines;
          patchState(store, { stocktake: cached.stocktake, cachedAt: cached.savedAt });
          recompute(await store._offline.pending(id));
        }
        try {
          await refreshFromServer(id);
          void sync();
        } catch (error) {
          if (!cached) patchState(store, { loadError: error });
        }
      },

      /** Ghi số đếm tuyệt đối cho một dòng. */
      async count(line: StocktakeLine, countedQuantity: number, note?: string): Promise<void> {
        const stocktake = store.stocktake();
        if (!stocktake || !store.editable() || countedQuantity < 0) return;
        const local = line.id.startsWith('local-');
        await enqueue({
          stocktakeId: stocktake.id,
          clientId: crypto.randomUUID(),
          ...(local
            ? { locationId: line.locationId, productId: line.productId }
            : { lineId: line.id }),
          countedQuantity,
          countedAt: new Date().toISOString(),
          note,
          display: local
            ? {
                sku: line.sku,
                productName: line.productName,
                unit: line.unit,
                barcode: line.barcode,
                locationCode: line.locationCode,
                locationPath: line.locationPath,
              }
            : undefined,
        });
      },

      /** Hàng tìm thấy trong ô nhưng không có trong danh sách chốt. */
      async countUnexpected(
        product: Product,
        bin: Pick<StocktakeLine, 'locationId' | 'locationCode' | 'locationPath'>,
        countedQuantity: number,
      ): Promise<void> {
        const stocktake = store.stocktake();
        if (!stocktake || !store.editable()) return;
        await enqueue({
          stocktakeId: stocktake.id,
          clientId: crypto.randomUUID(),
          locationId: bin.locationId,
          productId: product.id,
          countedQuantity,
          countedAt: new Date().toISOString(),
          display: {
            sku: product.sku,
            productName: product.name,
            unit: product.unit,
            barcode: product.barcode,
            locationCode: bin.locationCode,
            locationPath: bin.locationPath,
          },
        });
      },

      sync,

      dismissStale(): void {
        patchState(store, { staleCount: 0 });
      },
    };
  }),
  withHooks({
    onInit(store) {
      // Có mạng trở lại → đồng bộ ngay; còn hàng đợi → thử lại định kỳ.
      effect(() => {
        if (store.online()) untracked(() => void store.sync());
      });
      const timer = setInterval(() => void store.sync(), RETRY_MS);
      inject(DestroyRef).onDestroy(() => clearInterval(timer));
    },
  }),
);

export type CountSessionStore = InstanceType<typeof CountSessionStore>;
