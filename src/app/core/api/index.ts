/**
 * Điểm import duy nhất cho type API. Toàn bộ type sinh từ `openapi.yaml`
 * (`npm run api:gen`) — KHÔNG định nghĩa lại thủ công.
 */
export type * from './schema';

import type { PageMeta, operations } from './schema';

/** Trang dữ liệu chuẩn `{ items, total, page, size }`. */
export type Page<T> = PageMeta & { items: T[] };

/** Kiểu query string của một operation, vd `QueryOf<'listProducts'>`. */
export type QueryOf<K extends keyof operations> = operations[K] extends {
  parameters: { query?: infer Q };
}
  ? NonNullable<Q>
  : never;
