import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type { AlertPage, AlertSummary } from '../../../core/api';
import { API_BASE_URL } from '../../../core/config/app-config';
import { SKIP_ERROR_NOTIFY, SKIP_LOADING, httpContext } from '../../../core/http/http-context';
import { toHttpParams } from '../../../core/http/query-params';

@Injectable({ providedIn: 'root' })
export class AlertsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(query: Record<string, string | number>): Observable<AlertPage> {
    return this.http.get<AlertPage>(`${this.baseUrl}/alerts`, { params: toHttpParams(query) });
  }

  /** Gọi ngầm (huy hiệu header) — không hiện thanh tiến trình / snackbar lỗi. */
  summary(query: { days?: number; warehouseId?: string } = {}): Observable<AlertSummary> {
    return this.http.get<AlertSummary>(`${this.baseUrl}/alerts/summary`, {
      params: toHttpParams(query),
      context: httpContext(SKIP_LOADING, SKIP_ERROR_NOTIFY),
    });
  }
}
