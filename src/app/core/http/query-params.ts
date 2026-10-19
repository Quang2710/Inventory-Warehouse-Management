import { HttpParams } from '@angular/common/http';

type QueryValue = string | number | boolean | null | undefined;

/** Chuyển object query (sinh từ contract) thành HttpParams, bỏ giá trị rỗng. */
export function toHttpParams(query: object = {}): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query) as [string, QueryValue][]) {
    if (value !== null && value !== undefined && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}
