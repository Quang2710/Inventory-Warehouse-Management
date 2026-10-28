import { DOCUMENT, DestroyRef, computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import type { AlertSummary } from '../../../core/api';
import { BrowserStorage } from '../../../core/storage/browser-storage';
import { AlertsApi } from './alerts.api';

const DAYS_KEY = 'iwm.alerts.expiringDays';
/** Làm mới huy hiệu cảnh báo định kỳ (tồn thay đổi khi người khác duyệt phiếu). */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_DAYS = 30;

interface AlertsState {
  summary: AlertSummary | null;
  /** Ngưỡng "sắp hết hạn" (ngày) người dùng chọn — ghi nhớ trên máy. */
  expiringDays: number;
  loading: boolean;
}

/**
 * State cảnh báo dùng chung: huy hiệu trên header và màn Cảnh báo. Tự làm mới mỗi 5 phút
 * và khi người dùng quay lại tab; gọi `refresh()` sau thao tác làm đổi tồn kho.
 */
export const AlertsStore = signalStore(
  { providedIn: 'root' },
  withState<AlertsState>({ summary: null, expiringDays: DEFAULT_DAYS, loading: false }),
  withProps(() => ({
    _api: inject(AlertsApi),
    _storage: inject(BrowserStorage),
    _document: inject(DOCUMENT),
    _destroyRef: inject(DestroyRef),
  })),
  withComputed(({ summary }) => ({
    total: computed(() => summary()?.total ?? 0),
    critical: computed(() => summary()?.critical ?? 0),
  })),
  withMethods((store) => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight: Promise<void> | null = null;

    const refresh = (): Promise<void> => {
      inFlight ??= (async () => {
        patchState(store, { loading: true });
        try {
          const summary = await firstValueFrom(store._api.summary({ days: store.expiringDays() }));
          patchState(store, { summary });
        } catch {
          // Giữ số cũ khi mất mạng / lỗi tạm thời.
        } finally {
          patchState(store, { loading: false });
          inFlight = null;
        }
      })();
      return inFlight;
    };

    const onVisible = () => {
      if (store._document.visibilityState === 'visible') void refresh();
    };

    const stop = (): void => {
      if (timer) clearInterval(timer);
      timer = null;
      store._document.removeEventListener('visibilitychange', onVisible);
      patchState(store, { summary: null });
    };

    return {
      refresh,
      setExpiringDays(days: number): void {
        patchState(store, { expiringDays: days });
        store._storage.set(DAYS_KEY, String(days));
        void refresh();
      },
      /** Bắt đầu theo dõi (gọi khi vào khung ứng dụng, người dùng có quyền xem tồn). */
      start(): void {
        if (timer) return;
        const saved = Number(store._storage.get(DAYS_KEY));
        if (Number.isInteger(saved) && saved >= 1 && saved <= 365) {
          patchState(store, { expiringDays: saved });
        }
        void refresh();
        timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
        store._document.addEventListener('visibilitychange', onVisible);
        store._destroyRef.onDestroy(stop);
      },
      stop,
    };
  }),
);
