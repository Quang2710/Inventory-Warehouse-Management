import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type {
  BinStockPage,
  GenerateRackRequest,
  Location,
  LocationRequest,
  LocationUpdateRequest,
  QueryOf,
  Warehouse,
  WarehouseMap,
  WarehousePage,
  WarehouseRequest,
} from '../../core/api';
import { API_BASE_URL } from '../../core/config/app-config';
import { toHttpParams } from '../../core/http/query-params';

/** Kho, vị trí, sơ đồ kho và tồn theo ô (`/warehouses`, `/locations`, `/stock/bins`). */
@Injectable({ providedIn: 'root' })
export class WarehousesApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(query: QueryOf<'listWarehouses'> = {}): Observable<WarehousePage> {
    return this.http.get<WarehousePage>(`${this.baseUrl}/warehouses`, {
      params: toHttpParams(query),
    });
  }

  get(id: string): Observable<Warehouse> {
    return this.http.get<Warehouse>(`${this.baseUrl}/warehouses/${id}`);
  }

  create(body: WarehouseRequest): Observable<Warehouse> {
    return this.http.post<Warehouse>(`${this.baseUrl}/warehouses`, body);
  }

  update(id: string, body: WarehouseRequest): Observable<Warehouse> {
    return this.http.put<Warehouse>(`${this.baseUrl}/warehouses/${id}`, body);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/warehouses/${id}`);
  }

  locations(warehouseId: string, query: QueryOf<'listLocations'> = {}): Observable<Location[]> {
    return this.http.get<Location[]>(`${this.baseUrl}/warehouses/${warehouseId}/locations`, {
      params: toHttpParams(query),
    });
  }

  createLocation(warehouseId: string, body: LocationRequest): Observable<Location> {
    return this.http.post<Location>(`${this.baseUrl}/warehouses/${warehouseId}/locations`, body);
  }

  generateRack(warehouseId: string, body: GenerateRackRequest): Observable<Location[]> {
    return this.http.post<Location[]>(
      `${this.baseUrl}/warehouses/${warehouseId}/locations/generate`,
      body,
    );
  }

  updateLocation(id: string, body: LocationUpdateRequest): Observable<Location> {
    return this.http.put<Location>(`${this.baseUrl}/locations/${id}`, body);
  }

  deleteLocation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/locations/${id}`);
  }

  map(warehouseId: string): Observable<WarehouseMap> {
    return this.http.get<WarehouseMap>(`${this.baseUrl}/warehouses/${warehouseId}/map`);
  }

  binStock(query: QueryOf<'listBinStock'>): Observable<BinStockPage> {
    return this.http.get<BinStockPage>(`${this.baseUrl}/stock/bins`, {
      params: toHttpParams(query),
    });
  }
}
