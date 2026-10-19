import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { Warehouse } from '../../core/api';
import { WarehousesApi } from './warehouses.api';

/**
 * Danh sách kho người dùng được phép thao tác (server đã lọc theo phạm vi kho) — dùng cho
 * ô chọn kho ở nhiều màn hình; nạp một lần, gọi `refresh()` sau khi thêm/sửa kho.
 */
@Injectable({ providedIn: 'root' })
export class WarehouseLookup {
  private readonly api = inject(WarehousesApi);
  private readonly state = signal<Warehouse[] | null>(null);
  private readonly allState = signal<Warehouse[] | null>(null);
  private pending: Promise<void> | null = null;

  /** Kho trong phạm vi của người dùng. */
  readonly items = computed(() => this.state() ?? []);
  readonly active = computed(() =>
    this.items().filter((warehouse) => warehouse.status === 'ACTIVE'),
  );
  /** Mọi kho đang hoạt động (chọn kho đến khi chuyển kho). */
  readonly allActive = computed(() =>
    (this.allState() ?? []).filter((warehouse) => warehouse.status === 'ACTIVE'),
  );

  /** Nạp nếu chưa có. */
  ensureLoaded(): Promise<void> {
    if (this.state() !== null) return Promise.resolve();
    return this.refresh();
  }

  refresh(): Promise<void> {
    this.pending ??= Promise.all([
      firstValueFrom(this.api.list({ size: 100, sort: 'code,asc' })),
      firstValueFrom(this.api.list({ size: 100, sort: 'code,asc', scope: 'all' })),
    ])
      .then(([mine, all]) => {
        this.state.set(mine.items);
        this.allState.set(all.items);
      })
      .catch(() => {
        this.state.set(this.state() ?? []);
        this.allState.set(this.allState() ?? []);
      })
      .finally(() => (this.pending = null));
    return this.pending;
  }

  name(id: string | null | undefined): string {
    return (this.allState() ?? this.items()).find((warehouse) => warehouse.id === id)?.name ?? '';
  }
}
