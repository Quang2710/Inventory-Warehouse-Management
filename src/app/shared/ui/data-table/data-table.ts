import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChildren,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSortModule, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { BrowserStorage } from '../../../core/storage/browser-storage';
import type { SortState } from '../../data-access/paged-list';
import { StatePanel } from '../state-panel/state-panel';

export interface TableColumn {
  key: string;
  labelKey: TranslationKey;
  sortable?: boolean;
  /** Field sort phía server nếu khác `key`. */
  sortKey?: string;
  align?: 'start' | 'end' | 'center';
  /** Ẩn mặc định (người dùng có thể bật trong "Chọn cột"). */
  hidden?: boolean;
  /** Luôn hiển thị, không cho ẩn. */
  required?: boolean;
}

/** Ngữ cảnh ô: `$implicit` là dòng dữ liệu. */
interface CellContext<T> {
  $implicit: T;
}

/**
 * `<ng-template appCell="status" [appCellOf]="rows" let-row>…</ng-template>` — tùy biến ô
 * của một cột. `appCellOf` chỉ dùng để Angular suy ra kiểu dòng (giống `matCellDef`); bỏ qua
 * thì dòng có kiểu `any`.
 */
@Directive({ selector: 'ng-template[appCell]' })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class CellTemplate<T = any> {
  readonly appCell = input.required<string>();
  readonly appCellOf = input<readonly T[]>();
  readonly template = inject<TemplateRef<CellContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(
    _directive: CellTemplate<T>,
    _context: unknown,
  ): _context is CellContext<T> {
    return true;
  }
}

const SKELETON_ROWS = Array.from({ length: 6 }, (_, index) => index);

/**
 * Bảng dữ liệu dùng chung: sort/phân trang phía server, chọn cột (ghi nhớ theo bảng),
 * skeleton khi tải lần đầu, thanh tiến trình khi tải lại, trạng thái trống / lỗi thống nhất.
 */
@Component({
  selector: 'app-data-table',
  imports: [
    NgTemplateOutlet,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatMenuModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    StatePanel,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-table.html',
  styleUrl: './data-table.scss',
})
export class DataTable<T> {
  private readonly storage = inject(BrowserStorage);
  private readonly i18n = inject(I18nService);

  /** Dùng làm khóa ghi nhớ cột đang hiển thị. */
  readonly tableId = input.required<string>();
  readonly columns = input.required<readonly TableColumn[]>();
  readonly rows = input.required<readonly T[]>();
  readonly total = input(0);
  readonly pageIndex = input(0);
  readonly pageSize = input(20);
  readonly sort = input<SortState | null>(null);
  readonly loading = input(false);
  readonly loaded = input(true);
  readonly error = input<unknown>(null);
  /** Đang có bộ lọc → thông báo "không có kết quả" thay vì "chưa có dữ liệu". */
  readonly filtered = input(false);
  readonly paginated = input(true);
  readonly clickable = input(false);
  readonly emptyIcon = input('inventory');
  readonly ariaLabel = input<string>();

  readonly page = output<PageEvent>();
  readonly sortChange = output<SortState | null>();
  readonly rowClick = output<T>();
  readonly retry = output<void>();

  private readonly cellTemplates = contentChildren(CellTemplate);
  protected readonly templates = computed(
    () => new Map(this.cellTemplates().map((cell) => [cell.appCell(), cell.template])),
  );

  private readonly hiddenOverride = signal<Set<string> | null>(null);
  protected readonly hidden = computed(() => {
    const override = this.hiddenOverride();
    if (override) return override;
    const stored = this.storage.get(this.storageKey());
    if (stored) {
      try {
        return new Set<string>(JSON.parse(stored) as string[]);
      } catch {
        // dữ liệu hỏng → dùng mặc định
      }
    }
    return new Set(
      this.columns()
        .filter((column) => column.hidden)
        .map((column) => column.key),
    );
  });
  protected readonly visibleColumns = computed(() =>
    this.columns().filter((column) => column.required || !this.hidden().has(column.key)),
  );
  protected readonly displayedColumns = computed(() =>
    this.visibleColumns().map((column) => column.key),
  );
  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly showSkeleton = computed(() => this.loading() && !this.loaded());
  protected readonly errorMessage = computed(() =>
    this.error() ? this.i18n.errorMessage(this.error()) : null,
  );

  private storageKey(): string {
    return `iwm.table.${this.tableId()}.hidden`;
  }

  protected toggleColumn(column: TableColumn): void {
    const next = new Set(this.hidden());
    if (next.has(column.key)) next.delete(column.key);
    else next.add(column.key);
    this.hiddenOverride.set(next);
    this.storage.set(this.storageKey(), JSON.stringify([...next]));
  }

  protected onSort(sort: Sort): void {
    this.sortChange.emit(
      sort.direction ? { active: sort.active, direction: sort.direction } : null,
    );
  }

  protected onRow(row: T): void {
    if (this.clickable()) {
      this.rowClick.emit(row);
    }
  }

  protected cellValue(row: T, key: string): unknown {
    const value = (row as Record<string, unknown>)[key];
    return value === null || value === undefined || value === '' ? '—' : value;
  }
}
