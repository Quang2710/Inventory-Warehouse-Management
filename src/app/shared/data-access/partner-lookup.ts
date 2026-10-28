import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { Customer, CustomerPage, Supplier, SupplierPage } from '../../core/api';
import { API_BASE_URL } from '../../core/config/app-config';
import { SKIP_ERROR_NOTIFY, SKIP_LOADING, httpContext } from '../../core/http/http-context';

/**
 * Nhà cung cấp / khách hàng đang giao dịch — cho ô chọn đối tác trên phiếu nhập/xuất.
 * Nạp một lần mỗi phiên; người dùng không có quyền xem đối tác → danh sách rỗng (vẫn nhập tay).
 */
@Injectable({ providedIn: 'root' })
export class PartnerLookup {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly context = httpContext(SKIP_LOADING, SKIP_ERROR_NOTIFY);

  readonly suppliers = signal<Supplier[]>([]);
  readonly customers = signal<Customer[]>([]);
  private suppliersLoaded: Promise<void> | null = null;
  private customersLoaded: Promise<void> | null = null;

  loadSuppliers(): Promise<void> {
    this.suppliersLoaded ??= firstValueFrom(
      this.http.get<SupplierPage>(`${this.baseUrl}/suppliers`, {
        params: { status: 'ACTIVE', size: 200, sort: 'name,asc' },
        context: this.context,
      }),
    )
      .then((page) => this.suppliers.set(page.items))
      .catch(() => {
        this.suppliersLoaded = null;
      });
    return this.suppliersLoaded;
  }

  loadCustomers(): Promise<void> {
    this.customersLoaded ??= firstValueFrom(
      this.http.get<CustomerPage>(`${this.baseUrl}/customers`, {
        params: { status: 'ACTIVE', size: 200, sort: 'name,asc' },
        context: this.context,
      }),
    )
      .then((page) => this.customers.set(page.items))
      .catch(() => {
        this.customersLoaded = null;
      });
    return this.customersLoaded;
  }
}
