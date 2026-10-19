import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type { AuditLogPage } from '../../../core/api';
import { API_BASE_URL } from '../../../core/config/app-config';
import { toHttpParams } from '../../../core/http/query-params';

@Injectable({ providedIn: 'root' })
export class AuditLogsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(query: Record<string, string | number>): Observable<AuditLogPage> {
    return this.http.get<AuditLogPage>(`${this.baseUrl}/audit-logs`, {
      params: toHttpParams(query),
    });
  }
}
