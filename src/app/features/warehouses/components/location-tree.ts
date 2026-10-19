import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { Location, LocationType } from '../../../core/api';
import { LOCATION_TYPE_LABEL_KEYS, WAREHOUSE_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';

interface TreeNode {
  location: Location;
  depth: number;
  children: TreeNode[];
}

export const CHILD_TYPE: Readonly<Record<LocationType, LocationType | null>> = {
  ZONE: 'RACK',
  RACK: 'LEVEL',
  LEVEL: 'BIN',
  BIN: null,
};

const TYPE_ICON: Readonly<Record<LocationType, string>> = {
  ZONE: 'grid_view',
  RACK: 'shelves',
  LEVEL: 'layers',
  BIN: 'package_2',
};

export interface AddLocationEvent {
  parent: Location | null;
  type: LocationType;
}

/** Cây vị trí khu › kệ › tầng › ô (component trình bày, thao tác phát ra ngoài). */
@Component({
  selector: 'app-location-tree',
  imports: [
    NgTemplateOutlet,
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe,
    StatusChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './location-tree.html',
  styleUrl: './location-tree.scss',
})
export class LocationTree {
  readonly locations = input.required<readonly Location[]>();
  readonly editable = input(false);

  readonly add = output<AddLocationEvent>();
  readonly generate = output<Location>();
  readonly edit = output<Location>();
  readonly remove = output<Location>();

  protected readonly typeLabels = LOCATION_TYPE_LABEL_KEYS;
  protected readonly statusLabels = WAREHOUSE_STATUS;
  protected readonly typeIcons = TYPE_ICON;
  protected readonly childType = CHILD_TYPE;

  /** Mặc định mở các khu; người dùng mở/thu từng nhánh. */
  private readonly expandedOverride = signal<Set<string> | null>(null);
  protected readonly expanded = computed(
    () =>
      this.expandedOverride() ??
      new Set(
        this.locations()
          .filter((location) => location.type === 'ZONE')
          .map((location) => location.id),
      ),
  );

  protected readonly roots = computed<TreeNode[]>(() => {
    const byParent = new Map<string | null, Location[]>();
    for (const location of this.locations()) {
      const list = byParent.get(location.parentId ?? null) ?? [];
      list.push(location);
      byParent.set(location.parentId ?? null, list);
    }
    const build = (parentId: string | null, depth: number): TreeNode[] =>
      (byParent.get(parentId) ?? [])
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'vi', { numeric: true }),
        )
        .map((location) => ({ location, depth, children: build(location.id, depth + 1) }));
    return build(null, 0);
  });

  protected toggle(id: string): void {
    const next = new Set(this.expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedOverride.set(next);
  }

  protected expandAll(): void {
    this.expandedOverride.set(
      new Set(
        this.locations()
          .filter((l) => l.type !== 'BIN')
          .map((l) => l.id),
      ),
    );
  }

  protected collapseAll(): void {
    this.expandedOverride.set(new Set());
  }
}
