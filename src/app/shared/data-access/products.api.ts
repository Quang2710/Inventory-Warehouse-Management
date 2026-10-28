import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type { Product, ProductPage, QueryOf, StockItem } from '../../core/api';
import { API_BASE_URL } from '../../core/config/app-config';
import { SKIP_ERROR_NOTIFY, SKIP_LOADING, httpContext } from '../../core/http/http-context';
import { toHttpParams } from '../../core/http/query-params';

/** Tra cứu sản phẩm & tồn theo sản phẩm (phục vụ ô chọn hàng, quét mã). */
@Injectable({ providedIn: 'root' })
export class ProductsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(query: QueryOf<'listProducts'>): Observable<ProductPage> {
    return this.http.get<ProductPage>(`${this.baseUrl}/products`, {
      params: toHttpParams(query),
      context: httpContext(SKIP_LOADING),
    });
  }

  get(id: string): Observable<Product> {
    return this.http.get<Product>(`${this.baseUrl}/products/${id}`, {
      context: httpContext(SKIP_LOADING),
    });
  }

  byBarcode(barcode: string): Observable<Product> {
    return this.http.get<Product>(
      `${this.baseUrl}/products/by-barcode/${encodeURIComponent(barcode)}`,
      {
        context: httpContext(SKIP_ERROR_NOTIFY),
      },
    );
  }

  stockByProduct(productId: string): Observable<StockItem[]> {
    return this.http.get<StockItem[]>(`${this.baseUrl}/stock/by-product/${productId}`, {
      context: httpContext(SKIP_LOADING),
    });
  }
}
