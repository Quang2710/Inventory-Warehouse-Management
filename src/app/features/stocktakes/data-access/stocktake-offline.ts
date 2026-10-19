import { Injectable } from '@angular/core';

import type { Stocktake, StocktakeCountEntry, StocktakeLine } from '../../../core/api';
import { IdbStore } from '../../../core/offline/idb-store';

/** Bản chụp phiên kiểm kê lưu trên máy để tiếp tục đếm khi mất mạng / tải lại trang. */
export interface CachedSession {
  stocktake: Stocktake;
  lines: StocktakeLine[];
  savedAt: string;
}

/** Một số đếm chờ đồng bộ. `display` giúp vẽ dòng hàng ngoài danh sách khi chưa có id từ server. */
export interface QueuedCount extends StocktakeCountEntry {
  stocktakeId: string;
  display?: Pick<
    StocktakeLine,
    'sku' | 'productName' | 'unit' | 'barcode' | 'locationCode' | 'locationPath'
  >;
}

const DATABASE = 'iwm-offline';
const STORES = ['stocktake-sessions', 'stocktake-queue'] as const;

/**
 * Lưu trữ offline của kiểm kê (IndexedDB). Ghi vào máy TRƯỚC khi gửi server, nên số đếm
 * không mất khi mất mạng, tắt tab hay hết pin.
 */
@Injectable({ providedIn: 'root' })
export class StocktakeOfflineStore {
  private readonly sessions = new IdbStore<CachedSession>(DATABASE, STORES[0], STORES);
  private readonly queue = new IdbStore<QueuedCount>(DATABASE, STORES[1], STORES);

  async loadSession(stocktakeId: string): Promise<CachedSession | null> {
    try {
      return (await this.sessions.get(stocktakeId)) ?? null;
    } catch {
      return null;
    }
  }

  async saveSession(session: CachedSession): Promise<void> {
    try {
      await this.sessions.put(session.stocktake.id, session);
    } catch (error) {
      console.warn('Không lưu được dữ liệu kiểm kê offline', error);
    }
  }

  async pending(stocktakeId: string): Promise<QueuedCount[]> {
    try {
      return (await this.queue.getAll())
        .filter((entry) => entry.stocktakeId === stocktakeId)
        .sort((a, b) => a.countedAt.localeCompare(b.countedAt));
    } catch {
      return [];
    }
  }

  async enqueue(entry: QueuedCount): Promise<void> {
    await this.queue.put(entry.clientId, entry);
  }

  async dequeue(clientIds: readonly string[]): Promise<void> {
    await Promise.all(clientIds.map((clientId) => this.queue.delete(clientId)));
  }
}
