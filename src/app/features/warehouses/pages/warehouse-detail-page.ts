import { CurrencyPipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { BinStockItem, Location, MapBin, Warehouse, WarehouseMap } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import { LOCATION_TYPE_LABEL_KEYS, WAREHOUSE_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { WarehousesApi } from '../../../shared/data-access/warehouses.api';
import { ConfirmService } from '../../../shared/ui/confirm-dialog/confirm.service';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { StatePanel } from '../../../shared/ui/state-panel/state-panel';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { BinPanel } from '../components/bin-panel';
import {
  LocationFormDialog,
  RackGeneratorDialog,
  type LocationFormData,
  type RackGeneratorData,
} from '../components/location-dialogs';
import { LocationTree, type AddLocationEvent } from '../components/location-tree';
import { WarehouseFormDialog } from '../components/warehouse-form-dialog';
import { WarehouseMapView } from '../components/warehouse-map';

const TABS = ['map', 'locations', 'info'] as const;
type Tab = (typeof TABS)[number];

/** Chi tiết kho: sơ đồ (mặc định), cây vị trí, thông tin. Kho được resolve trước khi vào trang. */
@Component({
  selector: 'app-warehouse-detail-page',
  imports: [
    DecimalPipe,
    CurrencyPipe,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    TranslatePipe,
    PageHeader,
    StatusChip,
    StatePanel,
    Skeleton,
    WarehouseMapView,
    BinPanel,
    LocationTree,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './warehouse-detail-page.html',
  styleUrl: './warehouse-detail-page.scss',
})
export class WarehouseDetailPage {
  private readonly api = inject(WarehousesApi);
  private readonly lookup = inject(WarehouseLookup);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthStore);

  /** Từ resolver (withComponentInputBinding). */
  readonly warehouse = input.required<Warehouse>();
  /** Query param `tab`. */
  readonly tab = input<string>();

  protected readonly current = linkedSignal(() => this.warehouse());
  protected readonly statusLabels = WAREHOUSE_STATUS;
  protected readonly tabIndex = computed(() =>
    Math.max(0, TABS.indexOf((this.tab() ?? 'map') as Tab)),
  );
  protected readonly canEdit = computed(
    () =>
      this.auth.hasPermission('warehouse:write') && this.auth.canAccessWarehouse(this.current().id),
  );

  // ── Sơ đồ ──
  protected readonly map = signal<WarehouseMap | null>(null);
  protected readonly mapError = signal<unknown>(null);
  protected readonly zoneId = signal<string | null>(null);
  protected readonly selectedBin = signal<MapBin | null>(null);
  protected readonly binItems = signal<BinStockItem[]>([]);
  protected readonly binLoading = signal(false);
  protected readonly fillRate = computed(() => {
    const map = this.map();
    return map && map.capacity > 0 ? map.quantity / map.capacity : 0;
  });

  // ── Vị trí ──
  protected readonly locations = signal<Location[] | null>(null);
  protected readonly locationsError = signal<unknown>(null);

  constructor() {
    effect(() => {
      const id = this.warehouse().id;
      untracked(() => {
        this.selectedBin.set(null);
        this.zoneId.set(null);
        void this.loadMap(id);
        void this.loadLocations(id);
      });
    });
  }

  protected selectTab(index: number): void {
    void this.router.navigate([], {
      queryParams: { tab: index === 0 ? null : TABS[index] },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected async loadMap(id = this.current().id): Promise<void> {
    this.mapError.set(null);
    try {
      this.map.set(await firstValueFrom(this.api.map(id)));
    } catch (error) {
      this.mapError.set(error);
    }
  }

  protected async loadLocations(id = this.current().id): Promise<void> {
    this.locationsError.set(null);
    try {
      this.locations.set(await firstValueFrom(this.api.locations(id)));
    } catch (error) {
      this.locationsError.set(error);
    }
  }

  protected async selectBin(bin: MapBin): Promise<void> {
    this.selectedBin.set(bin);
    this.binLoading.set(true);
    try {
      const page = await firstValueFrom(
        this.api.binStock({ locationId: bin.id, size: 200, sort: 'sku,asc' }),
      );
      if (this.selectedBin()?.id === bin.id) this.binItems.set(page.items);
    } catch {
      this.binItems.set([]);
    } finally {
      this.binLoading.set(false);
    }
  }

  private async refreshAll(): Promise<void> {
    await Promise.all([this.loadLocations(), this.loadMap(), this.reloadWarehouse()]);
  }

  private async reloadWarehouse(): Promise<void> {
    try {
      this.current.set(await firstValueFrom(this.api.get(this.current().id)));
    } catch {
      // giữ dữ liệu cũ
    }
  }

  // ── Thao tác ──

  protected async editWarehouse(): Promise<void> {
    const ref = this.dialog.open<WarehouseFormDialog, Warehouse, Warehouse>(WarehouseFormDialog, {
      data: this.current(),
      width: '640px',
      maxWidth: 'calc(100vw - 32px)',
    });
    const saved = await firstValueFrom(ref.afterClosed());
    if (saved) this.current.set(saved);
  }

  protected async deleteWarehouse(): Promise<void> {
    const warehouse = this.current();
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t('warehouses.deleteTitle', { name: warehouse.name }),
      message: this.i18n.t('warehouses.deleteMessage'),
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.delete(warehouse.id));
      this.notifications.success('warehouses.deleted');
      void this.lookup.refresh();
      void this.router.navigate(['/warehouses']);
    } catch {
      // 409 hiển thị bởi error interceptor.
    }
  }

  protected async addLocation(event: AddLocationEvent): Promise<void> {
    const ref = this.dialog.open<LocationFormDialog, LocationFormData, Location>(
      LocationFormDialog,
      {
        data: { warehouseId: this.current().id, type: event.type, parent: event.parent },
        width: '560px',
        maxWidth: 'calc(100vw - 32px)',
      },
    );
    if (await firstValueFrom(ref.afterClosed())) await this.refreshAll();
  }

  protected async editLocation(location: Location): Promise<void> {
    const ref = this.dialog.open<LocationFormDialog, LocationFormData, Location>(
      LocationFormDialog,
      {
        data: {
          warehouseId: this.current().id,
          type: location.type,
          parent: this.locations()?.find((item) => item.id === location.parentId) ?? null,
          location,
        },
        width: '560px',
        maxWidth: 'calc(100vw - 32px)',
      },
    );
    if (await firstValueFrom(ref.afterClosed())) await this.refreshAll();
  }

  protected async generateRack(zone?: Location): Promise<void> {
    const locations = this.locations() ?? [];
    const ref = this.dialog.open<RackGeneratorDialog, RackGeneratorData, Location[]>(
      RackGeneratorDialog,
      {
        data: {
          warehouseId: this.current().id,
          zones: locations.filter((location) => location.type === 'ZONE'),
          zoneId: zone?.id,
          locations,
        },
        width: '560px',
        maxWidth: 'calc(100vw - 32px)',
      },
    );
    if (await firstValueFrom(ref.afterClosed())) await this.refreshAll();
  }

  protected async removeLocation(location: Location): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t('locations.deleteTitle', { code: location.code }),
      message: this.i18n.t('locations.deleteMessage'),
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.deleteLocation(location.id));
      this.notifications.success('locations.deleted');
      await this.refreshAll();
    } catch {
      // 409 hiển thị bởi error interceptor.
    }
  }

  protected typeLabel(type: Location['type']) {
    return LOCATION_TYPE_LABEL_KEYS[type];
  }
}
