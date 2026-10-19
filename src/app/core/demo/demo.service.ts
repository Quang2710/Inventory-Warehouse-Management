import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import { API_BASE_URL, APP_ENVIRONMENT } from '../config/app-config';
import { SKIP_AUTH, SKIP_ERROR_NOTIFY, httpContext } from '../http/http-context';
import type { DemoAccount } from './demo.models';

/**
 * Tiện ích chế độ demo. Gọi endpoint `/__demo/*` qua HttpClient như mọi API khác —
 * KHÔNG import code mock. Khi chạy với backend thật (`useMock: false`) tính năng này bị ẩn.
 */
@Injectable({ providedIn: 'root' })
export class DemoService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly enabled = inject(APP_ENVIRONMENT).useMock;

  getAccounts(): Observable<DemoAccount[]> {
    return this.http.get<DemoAccount[]>(`${this.baseUrl}/__demo/accounts`, {
      context: httpContext(SKIP_AUTH, SKIP_ERROR_NOTIFY),
    });
  }

  reset(): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/__demo/reset`, null, {
      context: httpContext(SKIP_AUTH),
    });
  }
}
