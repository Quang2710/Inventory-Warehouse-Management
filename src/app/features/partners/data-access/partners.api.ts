import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type {
  Customer,
  CustomerPage,
  CustomerRequest,
  Permission,
  Supplier,
  SupplierPage,
  SupplierRequest,
} from '../../../core/api';
import { API_BASE_URL } from '../../../core/config/app-config';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { toHttpParams } from '../../../core/http/query-params';

export type PartnerKind = 'supplier' | 'customer';
export type Partner = Supplier | Customer;
export type PartnerRequest = SupplierRequest | CustomerRequest;

export interface PartnerKindConfig {
  path: 'suppliers' | 'customers';
  read: Permission;
  write: Permission;
  title: TranslationKey;
  subtitle: TranslationKey;
  create: TranslationKey;
  createTitle: TranslationKey;
  editTitle: TranslationKey;
  created: TranslationKey;
  updated: TranslationKey;
  deleted: TranslationKey;
  deleteTitle: TranslationKey;
}

export const PARTNER_KINDS: Readonly<Record<PartnerKind, PartnerKindConfig>> = {
  supplier: {
    path: 'suppliers',
    read: 'supplier:read',
    write: 'supplier:write',
    title: 'partners.suppliers.title',
    subtitle: 'partners.suppliers.subtitle',
    create: 'partners.suppliers.create',
    createTitle: 'partners.suppliers.createTitle',
    editTitle: 'partners.suppliers.editTitle',
    created: 'partners.suppliers.created',
    updated: 'partners.suppliers.updated',
    deleted: 'partners.suppliers.deleted',
    deleteTitle: 'partners.suppliers.deleteTitle',
  },
  customer: {
    path: 'customers',
    read: 'customer:read',
    write: 'customer:write',
    title: 'partners.customers.title',
    subtitle: 'partners.customers.subtitle',
    create: 'partners.customers.create',
    createTitle: 'partners.customers.createTitle',
    editTitle: 'partners.customers.editTitle',
    created: 'partners.customers.created',
    updated: 'partners.customers.updated',
    deleted: 'partners.customers.deleted',
    deleteTitle: 'partners.customers.deleteTitle',
  },
};

/** Nhà cung cấp (`/suppliers`) và khách hàng (`/customers`) — cùng cấu trúc CRUD. */
@Injectable({ providedIn: 'root' })
export class PartnersApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(
    kind: PartnerKind,
    query: Record<string, string | number>,
  ): Observable<SupplierPage | CustomerPage> {
    return this.http.get<SupplierPage | CustomerPage>(this.url(kind), {
      params: toHttpParams(query),
    });
  }

  create(kind: PartnerKind, body: PartnerRequest): Observable<Partner> {
    return this.http.post<Partner>(this.url(kind), body);
  }

  update(kind: PartnerKind, id: string, body: PartnerRequest): Observable<Partner> {
    return this.http.put<Partner>(`${this.url(kind)}/${id}`, body);
  }

  delete(kind: PartnerKind, id: string): Observable<void> {
    return this.http.delete<void>(`${this.url(kind)}/${id}`);
  }

  private url(kind: PartnerKind): string {
    return `${this.baseUrl}/${PARTNER_KINDS[kind].path}`;
  }
}
