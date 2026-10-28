import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type {
  QueryOf,
  SerialUnit,
  SerialUnitPage,
  StockItemPage,
  StockLotPage,
  StockMovementPage,
} from '../../core/api';
import { API_BASE_URL } from '../../core/config/app-config';
import { SKIP_ERROR_NOTIFY, SKIP_LOADING, httpContext } from '../../core/http/http-context';
import { toHttpParams } from '../../core/http/query-params';

/** Tồn kho: theo kho, theo lô/HSD, serial và biến động (dùng ở nhiều màn hình). */
@Injectable({ providedIn: 'root' })
export class StockApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(query: QueryOf<'listStock'> | Record<string, string | number>): Observable<StockItemPage> {
    return this.http.get<StockItemPage>(`${this.baseUrl}/stock`, { params: toHttpParams(query) });
  }

  lots(
    query: QueryOf<'listStockLots'> | Record<string, string | number>,
  ): Observable<StockLotPage> {
    return this.http.get<StockLotPage>(`${this.baseUrl}/stock/lots`, {
      params: toHttpParams(query),
      context: httpContext(SKIP_LOADING),
    });
  }

  serials(
    query: QueryOf<'listSerials'> | Record<string, string | number>,
  ): Observable<SerialUnitPage> {
    return this.http.get<SerialUnitPage>(`${this.baseUrl}/serials`, {
      params: toHttpParams(query),
      context: httpContext(SKIP_LOADING),
    });
  }

  /** Tra một serial khi quét mã — 404 do nơi gọi xử lý. */
  serial(serialNumber: string): Observable<SerialUnit> {
    return this.http.get<SerialUnit>(
      `${this.baseUrl}/serials/${encodeURIComponent(serialNumber)}`,
      { context: httpContext(SKIP_ERROR_NOTIFY) },
    );
  }

  movements(
    query: QueryOf<'listStockMovements'> | Record<string, string | number>,
  ): Observable<StockMovementPage> {
    return this.http.get<StockMovementPage>(`${this.baseUrl}/stock-movements`, {
      params: toHttpParams(query),
    });
  }
}
