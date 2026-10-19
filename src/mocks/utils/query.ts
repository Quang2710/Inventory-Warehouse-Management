import { errors } from './http';
import { matchesQuery } from './text';

export type SortDirection = 'asc' | 'desc';

export interface ListQuery {
  page: number;
  size: number;
  sort: { field: string; direction: SortDirection } | null;
  q: string;
  params: URLSearchParams;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface ListOptions<T> {
  /** Các field được phép sort (whitelist) — sort field khác sẽ trả 422. */
  sortable: readonly (keyof T & string)[];
  /** Sort mặc định khi request không truyền `sort`. */
  defaultSort?: `${keyof T & string},${SortDirection}`;
  /** Lấy các chuỗi dùng để tìm kiếm theo `q`. */
  searchIn?: (item: T) => readonly (string | null | undefined)[];
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;
const SORT_PATTERN = /^([A-Za-z0-9_.]+),(asc|desc)$/;

function parsePositiveInt(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

/** Phân tích `?page=&size=&sort=field,asc&q=` (page bắt đầu từ 1). Sai định dạng → ném 422. */
export function parseListQuery(url: URL): ListQuery {
  const params = url.searchParams;
  const page = parsePositiveInt(params.get('page'), 1);
  const size = parsePositiveInt(params.get('size'), DEFAULT_PAGE_SIZE);
  const rawSort = params.get('sort');
  const sortMatch = rawSort ? SORT_PATTERN.exec(rawSort) : null;

  const details: Record<string, string[]> = {};
  if (page === null) {
    details['page'] = ['page phải là số nguyên ≥ 1.'];
  }
  if (size === null || size > MAX_PAGE_SIZE) {
    details['size'] = [`size phải là số nguyên từ 1 đến ${MAX_PAGE_SIZE}.`];
  }
  if (rawSort && !sortMatch) {
    details['sort'] = ['sort phải có dạng field,asc hoặc field,desc.'];
  }
  if (Object.keys(details).length > 0) {
    throw errors.validation(details, 'Tham số truy vấn không hợp lệ.');
  }

  return {
    page: page ?? 1,
    size: size ?? DEFAULT_PAGE_SIZE,
    sort: sortMatch ? { field: sortMatch[1], direction: sortMatch[2] as SortDirection } : null,
    q: params.get('q')?.trim() ?? '',
    params,
  };
}

const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });

function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty || bEmpty) {
    return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1; // giá trị rỗng luôn ở cuối
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  return collator.compare(String(a), String(b));
}

export function sortItems<T>(items: readonly T[], field: keyof T, direction: SortDirection): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => factor * compareValues(left[field], right[field]));
}

/**
 * Áp dụng tìm kiếm `q` → sắp xếp → phân trang lên danh sách DTO đã lọc sẵn theo filter riêng.
 */
export function toPage<T>(items: readonly T[], query: ListQuery, options: ListOptions<T>): Page<T> {
  const searchIn = options.searchIn;
  let result =
    searchIn && query.q
      ? items.filter((item) => matchesQuery(query.q, searchIn(item)))
      : [...items];

  const sort =
    query.sort ??
    (options.defaultSort
      ? {
          field: options.defaultSort.split(',')[0],
          direction: options.defaultSort.split(',')[1] as SortDirection,
        }
      : null);

  if (sort) {
    if (!(options.sortable as readonly string[]).includes(sort.field)) {
      throw errors.validation(
        {
          sort: [
            `Không hỗ trợ sắp xếp theo "${sort.field}". Cho phép: ${options.sortable.join(', ')}.`,
          ],
        },
        'Tham số truy vấn không hợp lệ.',
      );
    }
    result = sortItems(result, sort.field as keyof T, sort.direction);
  }

  const start = (query.page - 1) * query.size;
  return {
    items: result.slice(start, start + query.size),
    total: result.length,
    page: query.page,
    size: query.size,
  };
}

/** So khớp filter dạng enum/id: không truyền → luôn khớp. */
export function matchesFilter(value: string | null | undefined, filter: string | null): boolean {
  return filter === null || filter === '' || value === filter;
}

/** So khớp khoảng ngày `YYYY-MM-DD` (bao gồm hai đầu). */
export function inDateRange(date: string, from: string | null, to: string | null): boolean {
  const day = date.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}
