import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type { GoodsReceipt, GoodsReceiptPage, GoodsReceiptRequest } from '../../../core/api';
import { API_BASE_URL } from '../../../core/config/app-config';
import { SKIP_ERROR_NOTIFY, httpContext } from '../../../core/http/http-context';
import { toHttpParams } from '../../../core/http/query-params';
import type { WorkflowApi } from '../../../shared/data-access/document-workflow';

@Injectable({ providedIn: 'root' })
export class GoodsReceiptsApi implements WorkflowApi<GoodsReceipt> {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly url = `${this.baseUrl}/goods-receipts`;

  list(query: Record<string, string | number>): Observable<GoodsReceiptPage> {
    return this.http.get<GoodsReceiptPage>(this.url, { params: toHttpParams(query) });
  }

  get(id: string): Observable<GoodsReceipt> {
    return this.http.get<GoodsReceipt>(`${this.url}/${id}`);
  }

  /** Lỗi 422 do form tự gắn vào field → không hiện snackbar chung. */
  create(body: GoodsReceiptRequest): Observable<GoodsReceipt> {
    return this.http.post<GoodsReceipt>(this.url, body, {
      context: httpContext(SKIP_ERROR_NOTIFY),
    });
  }

  update(id: string, body: GoodsReceiptRequest): Observable<GoodsReceipt> {
    return this.http.put<GoodsReceipt>(`${this.url}/${id}`, body, {
      context: httpContext(SKIP_ERROR_NOTIFY),
    });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, { context: httpContext(SKIP_ERROR_NOTIFY) });
  }

  submit(id: string): Observable<GoodsReceipt> {
    return this.http.post<GoodsReceipt>(`${this.url}/${id}/submit`, null, {
      context: httpContext(SKIP_ERROR_NOTIFY),
    });
  }

  approve(id: string): Observable<GoodsReceipt> {
    return this.http.post<GoodsReceipt>(`${this.url}/${id}/approve`, null, {
      context: httpContext(SKIP_ERROR_NOTIFY),
    });
  }

  reject(id: string, reason: string): Observable<GoodsReceipt> {
    return this.http.post<GoodsReceipt>(
      `${this.url}/${id}/reject`,
      { reason },
      {
        context: httpContext(SKIP_ERROR_NOTIFY),
      },
    );
  }

  cancel(id: string, reason: string): Observable<GoodsReceipt> {
    return this.http.post<GoodsReceipt>(
      `${this.url}/${id}/cancel`,
      { reason },
      {
        context: httpContext(SKIP_ERROR_NOTIFY),
      },
    );
  }
}
