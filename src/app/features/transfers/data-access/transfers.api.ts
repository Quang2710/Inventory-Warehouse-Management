import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type {
  Transfer,
  TransferPage,
  TransferReceiveRequest,
  TransferRequest,
} from '../../../core/api';
import { API_BASE_URL } from '../../../core/config/app-config';
import { SKIP_ERROR_NOTIFY, httpContext } from '../../../core/http/http-context';
import { toHttpParams } from '../../../core/http/query-params';

@Injectable({ providedIn: 'root' })
export class TransfersApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(query: Record<string, string | number>): Observable<TransferPage> {
    return this.http.get<TransferPage>(`${this.baseUrl}/transfers`, {
      params: toHttpParams(query),
    });
  }

  get(id: string): Observable<Transfer> {
    return this.http.get<Transfer>(`${this.baseUrl}/transfers/${id}`);
  }

  create(body: TransferRequest): Observable<Transfer> {
    return this.http.post<Transfer>(`${this.baseUrl}/transfers`, body);
  }

  update(id: string, body: TransferRequest): Observable<Transfer> {
    return this.http.put<Transfer>(`${this.baseUrl}/transfers/${id}`, body);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/transfers/${id}`);
  }

  /** 422 INSUFFICIENT_STOCK do trang tự hiển thị theo dòng. */
  ship(id: string): Observable<Transfer> {
    return this.http.post<Transfer>(`${this.baseUrl}/transfers/${id}/ship`, null, {
      context: httpContext(SKIP_ERROR_NOTIFY),
    });
  }

  receive(id: string, body: TransferReceiveRequest): Observable<Transfer> {
    return this.http.post<Transfer>(`${this.baseUrl}/transfers/${id}/receive`, body);
  }

  cancel(id: string, reason: string): Observable<Transfer> {
    return this.http.post<Transfer>(`${this.baseUrl}/transfers/${id}/cancel`, { reason });
  }
}
