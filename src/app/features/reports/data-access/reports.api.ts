import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type {
  AbcReport,
  InventorySummaryPage,
  QueryOf,
  StockCard,
  StockValuePage,
} from '../../../core/api';
import { API_BASE_URL } from '../../../core/config/app-config';
import { toHttpParams } from '../../../core/http/query-params';

type Query = Record<string, string | number | boolean>;

@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/reports`;

  stockCard(query: QueryOf<'getStockCard'>): Observable<StockCard> {
    return this.http.get<StockCard>(`${this.url}/stock-card`, { params: toHttpParams(query) });
  }

  inventorySummary(
    query: QueryOf<'getInventorySummary'> | Query,
  ): Observable<InventorySummaryPage> {
    return this.http.get<InventorySummaryPage>(`${this.url}/inventory-summary`, {
      params: toHttpParams(query),
    });
  }

  stockValue(query: QueryOf<'getStockValue'> | Query): Observable<StockValuePage> {
    return this.http.get<StockValuePage>(`${this.url}/stock-value`, {
      params: toHttpParams(query),
    });
  }

  abc(query: QueryOf<'getAbcAnalysis'> | Query): Observable<AbcReport> {
    return this.http.get<AbcReport>(`${this.url}/abc`, { params: toHttpParams(query) });
  }
}
