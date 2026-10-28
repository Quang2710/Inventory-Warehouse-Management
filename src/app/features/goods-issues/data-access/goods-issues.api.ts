import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type {
  AllocationPreview,
  AllocationPreviewRequest,
  GoodsIssue,
  GoodsIssuePage,
  GoodsIssueRequest,
} from '../../../core/api';
import { API_BASE_URL } from '../../../core/config/app-config';
import { SKIP_ERROR_NOTIFY, SKIP_LOADING, httpContext } from '../../../core/http/http-context';
import { toHttpParams } from '../../../core/http/query-params';
import type { WorkflowApi } from '../../../shared/data-access/document-workflow';

@Injectable({ providedIn: 'root' })
export class GoodsIssuesApi implements WorkflowApi<GoodsIssue> {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly url = `${this.baseUrl}/goods-issues`;
  private readonly silent = httpContext(SKIP_ERROR_NOTIFY);

  list(query: Record<string, string | number>): Observable<GoodsIssuePage> {
    return this.http.get<GoodsIssuePage>(this.url, { params: toHttpParams(query) });
  }

  get(id: string): Observable<GoodsIssue> {
    return this.http.get<GoodsIssue>(`${this.url}/${id}`);
  }

  /** Gợi ý lấy hàng theo FEFO — gọi ngầm khi người dùng sửa dòng, lỗi do form tự xử lý. */
  previewAllocation(body: AllocationPreviewRequest): Observable<AllocationPreview> {
    return this.http.post<AllocationPreview>(`${this.url}/allocation-preview`, body, {
      context: httpContext(SKIP_ERROR_NOTIFY, SKIP_LOADING),
    });
  }

  create(body: GoodsIssueRequest): Observable<GoodsIssue> {
    return this.http.post<GoodsIssue>(this.url, body, { context: this.silent });
  }

  update(id: string, body: GoodsIssueRequest): Observable<GoodsIssue> {
    return this.http.put<GoodsIssue>(`${this.url}/${id}`, body, { context: this.silent });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, { context: this.silent });
  }

  submit(id: string): Observable<GoodsIssue> {
    return this.http.post<GoodsIssue>(`${this.url}/${id}/submit`, null, { context: this.silent });
  }

  approve(id: string): Observable<GoodsIssue> {
    return this.http.post<GoodsIssue>(`${this.url}/${id}/approve`, null, { context: this.silent });
  }

  reject(id: string, reason: string): Observable<GoodsIssue> {
    return this.http.post<GoodsIssue>(
      `${this.url}/${id}/reject`,
      { reason },
      { context: this.silent },
    );
  }

  cancel(id: string, reason: string): Observable<GoodsIssue> {
    return this.http.post<GoodsIssue>(
      `${this.url}/${id}/cancel`,
      { reason },
      { context: this.silent },
    );
  }
}
