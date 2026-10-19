import { DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { type Observable, Subject, catchError, of, switchMap, tap } from 'rxjs';

import type { Page } from '../../core/api';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  active: string;
  direction: SortDirection;
}

/** Bộ lọc riêng của từng danh sách: giá trị chuỗi, `null` = không lọc. */
export type ListFilters = Record<string, string | null>;

export interface ListParams<F extends ListFilters> {
  page: number;
  size: number;
  sort: SortState | null;
  q: string;
  filters: F;
}

export interface PagedListOptions<T, F extends ListFilters> {
  fetch: (params: ListParams<F>) => Observable<Page<T>>;
  filters: F;
  size?: number;
  sort?: SortState | null;
  /** Đồng bộ trạng thái với query string để chia sẻ link / F5 / quay lại đúng trang. */
  syncWithUrl?: boolean;
}

/** Chuyển tham số danh sách thành query của API (`page`, `size`, `sort=field,dir`, `q`, filter…). */
export function toApiQuery<F extends ListFilters>(
  params: ListParams<F>,
): Record<string, string | number> {
  const query: Record<string, string | number> = { page: params.page, size: params.size };
  if (params.sort) query['sort'] = `${params.sort.active},${params.sort.direction}`;
  if (params.q) query['q'] = params.q;
  for (const [key, value] of Object.entries(params.filters)) {
    if (value !== null && value !== '') query[key] = value;
  }
  return query;
}

/**
 * Trạng thái một danh sách phân trang phía server: tham số → gọi API (hủy request cũ khi đổi
 * tham số) → items/total/loading/error. Dùng trong page (state cục bộ bằng signals).
 */
export class PagedList<T, F extends ListFilters> {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly reload$ = new Subject<ListParams<F>>();
  private readonly defaults: ListParams<F>;

  readonly params = signal<ListParams<F>>(null as unknown as ListParams<F>);
  readonly items = signal<T[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<unknown>(null);
  /** Đã từng tải xong ít nhất một lần (phân biệt "đang tải lần đầu" với "trống"). */
  readonly loaded = signal(false);
  readonly pageIndex = computed(() => this.params().page - 1);
  readonly hasFilters = computed(() => {
    const params = this.params();
    return (
      !!params.q || Object.values(params.filters).some((value) => value !== null && value !== '')
    );
  });

  constructor(private readonly options: PagedListOptions<T, F>) {
    this.defaults = {
      page: 1,
      size: options.size ?? 20,
      sort: options.sort ?? null,
      q: '',
      filters: { ...options.filters },
    };
    this.params.set(options.syncWithUrl === false ? this.defaults : this.readUrl());

    this.reload$
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((params) =>
          options.fetch(params).pipe(
            catchError((error: unknown) => {
              this.error.set(error);
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((page) => {
        this.loading.set(false);
        this.loaded.set(true);
        if (page) {
          this.items.set(page.items);
          this.total.set(page.total);
        }
      });
    this.reload();
  }

  reload(): void {
    this.reload$.next(this.params());
  }

  /** `pageIndex` 0-based như mat-paginator. */
  setPage(pageIndex: number, size: number): void {
    this.update({ page: pageIndex + 1, size });
  }

  setSort(sort: SortState | null): void {
    this.update({ sort: sort?.direction ? sort : null, page: 1 });
  }

  setQuery(q: string): void {
    if (q.trim() !== this.params().q) {
      this.update({ q: q.trim(), page: 1 });
    }
  }

  setFilter<K extends keyof F>(key: K, value: F[K]): void {
    this.update({ filters: { ...this.params().filters, [key]: value || null }, page: 1 });
  }

  clearFilters(): void {
    this.update({ q: '', filters: { ...this.defaults.filters }, page: 1 });
  }

  private update(patch: Partial<ListParams<F>>): void {
    this.params.update((current) => ({ ...current, ...patch }));
    if (this.options.syncWithUrl !== false) {
      this.writeUrl();
    }
    this.reload();
  }

  private readUrl(): ListParams<F> {
    const query = this.route.snapshot.queryParamMap;
    const page = Number(query.get('page'));
    const size = Number(query.get('size'));
    const [active, direction] = (query.get('sort') ?? '').split(',');
    const filters = { ...this.defaults.filters };
    for (const key of Object.keys(filters)) {
      const value = query.get(key);
      if (value !== null) (filters as ListFilters)[key] = value;
    }
    return {
      page: Number.isInteger(page) && page >= 1 ? page : 1,
      size: [10, 20, 50, 100].includes(size) ? size : this.defaults.size,
      sort:
        active && (direction === 'asc' || direction === 'desc')
          ? { active, direction }
          : this.defaults.sort,
      q: query.get('q') ?? '',
      filters,
    };
  }

  private writeUrl(): void {
    const params = this.params();
    const queryParams: Record<string, string | number | null> = {
      page: params.page > 1 ? params.page : null,
      size: params.size !== this.defaults.size ? params.size : null,
      sort:
        params.sort && JSON.stringify(params.sort) !== JSON.stringify(this.defaults.sort)
          ? `${params.sort.active},${params.sort.direction}`
          : null,
      q: params.q || null,
    };
    for (const [key, value] of Object.entries(params.filters)) {
      queryParams[key] = value || null;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

/** Tạo PagedList trong injection context (field initializer của component). */
export function injectPagedList<T, F extends ListFilters>(
  options: PagedListOptions<T, F>,
): PagedList<T, F> {
  return new PagedList<T, F>(options);
}
