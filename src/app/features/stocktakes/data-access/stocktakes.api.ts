import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type {
  Stocktake,
  StocktakeCountBatch,
  StocktakeCountResult,
  StocktakeLine,
  StocktakePage,
  StocktakeRequest,
} from '../../../core/api';
import { API_BASE_URL } from '../../../core/config/app-config';
import { SKIP_ERROR_NOTIFY, SKIP_LOADING, httpContext } from '../../../core/http/http-context';
import { toHttpParams } from '../../../core/http/query-params';

@Injectable({ providedIn: 'root' })
export class StocktakesApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(query: Record<string, string | number>): Observable<StocktakePage> {
    return this.http.get<StocktakePage>(`${this.baseUrl}/stocktakes`, {
      params: toHttpParams(query),
    });
  }

  get(id: string, background = false): Observable<Stocktake> {
    return this.http.get<Stocktake>(`${this.baseUrl}/stocktakes/${id}`, {
      context: background ? httpContext(SKIP_ERROR_NOTIFY, SKIP_LOADING) : undefined,
    });
  }

  lines(id: string, background = false): Observable<StocktakeLine[]> {
    return this.http.get<StocktakeLine[]>(`${this.baseUrl}/stocktakes/${id}/lines`, {
      context: background ? httpContext(SKIP_ERROR_NOTIFY, SKIP_LOADING) : undefined,
    });
  }

  create(body: StocktakeRequest): Observable<Stocktake> {
    return this.http.post<Stocktake>(`${this.baseUrl}/stocktakes`, body);
  }

  /** Đồng bộ hàng đợi số đếm — chạy ngầm, lỗi do hàng đợi tự xử lý. */
  submitCounts(id: string, body: StocktakeCountBatch): Observable<StocktakeCountResult> {
    return this.http.post<StocktakeCountResult>(`${this.baseUrl}/stocktakes/${id}/counts`, body, {
      context: httpContext(SKIP_ERROR_NOTIFY, SKIP_LOADING),
    });
  }

  submit(id: string): Observable<Stocktake> {
    return this.http.post<Stocktake>(`${this.baseUrl}/stocktakes/${id}/submit`, null);
  }

  reopen(id: string): Observable<Stocktake> {
    return this.http.post<Stocktake>(`${this.baseUrl}/stocktakes/${id}/reopen`, null);
  }

  approve(id: string): Observable<Stocktake> {
    return this.http.post<Stocktake>(`${this.baseUrl}/stocktakes/${id}/approve`, null);
  }

  cancel(id: string, reason: string): Observable<Stocktake> {
    return this.http.post<Stocktake>(`${this.baseUrl}/stocktakes/${id}/cancel`, { reason });
  }
}
