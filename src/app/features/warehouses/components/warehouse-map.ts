import { DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { MapBin, MapZone, WarehouseMap } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

export type FillLevel = 'empty' | 'low' | 'medium' | 'high' | 'over' | 'inactive';

export function fillLevel(bin: Pick<MapBin, 'status' | 'quantity' | 'fillRate'>): FillLevel {
  if (bin.status === 'INACTIVE') return 'inactive';
  if (bin.quantity <= 0) return 'empty';
  if (bin.fillRate > 1) return 'over';
  if (bin.fillRate >= 0.9) return 'high';
  if (bin.fillRate >= 0.5) return 'medium';
  return 'low';
}

const LEGEND: readonly { level: FillLevel; labelKey: Parameters<I18nService['t']>[0] }[] = [
  { level: 'empty', labelKey: 'map.legend.empty' },
  { level: 'low', labelKey: 'map.legend.low' },
  { level: 'medium', labelKey: 'map.legend.medium' },
  { level: 'high', labelKey: 'map.legend.high' },
  { level: 'over', labelKey: 'map.legend.over' },
  { level: 'inactive', labelKey: 'map.legend.inactive' },
];

/**
 * Sơ đồ kho (component trình bày): mỗi kệ là lưới tầng × ô, màu theo mức lấp đầy.
 * Chỉ nhận dữ liệu qua input và phát sự kiện chọn ô.
 */
@Component({
  selector: 'app-warehouse-map',
  imports: [DecimalPipe, PercentPipe, MatTooltipModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './warehouse-map.html',
  styleUrl: './warehouse-map.scss',
})
export class WarehouseMapView {
  private readonly i18n = inject(I18nService);

  readonly map = input.required<WarehouseMap>();
  /** `null` = tất cả khu. */
  readonly zoneId = input<string | null>(null);
  readonly selectedBinId = input<string | null>(null);
  readonly binSelect = output<MapBin>();

  protected readonly legend = LEGEND;
  protected readonly fillLevel = fillLevel;
  protected readonly zones = computed<MapZone[]>(() => {
    const zoneId = this.zoneId();
    return zoneId ? this.map().zones.filter((zone) => zone.id === zoneId) : this.map().zones;
  });

  protected binLabel(bin: MapBin): string {
    return this.i18n.t('map.binLabel', {
      code: bin.code,
      quantity: bin.quantity.toLocaleString('vi-VN'),
      capacity: bin.capacity.toLocaleString('vi-VN'),
      fill: `${Math.round(bin.fillRate * 100)}%`,
      skus: bin.skuCount,
    });
  }

  /** Số ô ngắn gọn hiển thị trong ô (phần cuối của mã). */
  protected shortCode(code: string): string {
    return code.split('-').pop() ?? code;
  }

  protected rate(quantity: number, capacity: number): number {
    return capacity > 0 ? quantity / capacity : 0;
  }
}
