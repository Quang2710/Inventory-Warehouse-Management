import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { Product, SerialUnit } from '../../core/api';
import { isApiError } from '../../core/http/api-error';
import { ProductsApi } from './products.api';
import { StockApi } from './stock.api';

export interface CodeMatch {
  product: Product;
  /** Có khi mã quét là số serial của một đơn vị hàng. */
  serial?: SerialUnit;
  matchedBy: 'barcode' | 'sku' | 'serial';
}

const notFound = (error: unknown) => isApiError(error) && error.status === 404;

/**
 * Tra một mã quét / gõ tay: mã vạch → SKU → số serial. Trả `null` nếu không khớp.
 * Lỗi khác 404 (mạng, quyền) được ném ra cho nơi gọi hiển thị.
 */
@Injectable({ providedIn: 'root' })
export class CodeLookup {
  private readonly products = inject(ProductsApi);
  private readonly stock = inject(StockApi);

  async resolve(raw: string): Promise<CodeMatch | null> {
    const code = raw.trim();
    if (!code) return null;
    try {
      return { product: await firstValueFrom(this.products.byBarcode(code)), matchedBy: 'barcode' };
    } catch (error) {
      if (!notFound(error)) throw error;
    }
    const page = await firstValueFrom(this.products.list({ q: code, size: 5 }));
    const bySku = page.items.find((product) => product.sku.toLowerCase() === code.toLowerCase());
    if (bySku) return { product: bySku, matchedBy: 'sku' };
    try {
      const serial = await firstValueFrom(this.stock.serial(code));
      const product = await firstValueFrom(this.products.get(serial.productId));
      return { product, serial, matchedBy: 'serial' };
    } catch (error) {
      if (notFound(error) || (isApiError(error) && error.status === 403)) return null;
      throw error;
    }
  }
}
