import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { Category, CategoryPage } from '../../core/api';
import { API_BASE_URL } from '../../core/config/app-config';
import { SKIP_ERROR_NOTIFY, SKIP_LOADING, httpContext } from '../../core/http/http-context';

/** Danh mục sản phẩm (nhóm cha trước, nhóm con thụt lề) cho ô lọc báo cáo / tồn kho. */
@Injectable({ providedIn: 'root' })
export class CategoryLookup {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private loaded: Promise<void> | null = null;

  /** Đã sắp: mỗi nhóm cha theo sau là các nhóm con. */
  readonly items = signal<(Category & { depth: number })[]>([]);

  ensureLoaded(): Promise<void> {
    this.loaded ??= firstValueFrom(
      this.http.get<CategoryPage>(`${this.baseUrl}/categories`, {
        params: { size: 200, sort: 'code,asc' },
        context: httpContext(SKIP_LOADING, SKIP_ERROR_NOTIFY),
      }),
    )
      .then((page) => {
        const roots = page.items.filter((category) => !category.parentId);
        this.items.set(
          roots.flatMap((root) => [
            { ...root, depth: 0 },
            ...page.items
              .filter((category) => category.parentId === root.id)
              .map((child) => ({ ...child, depth: 1 })),
          ]),
        );
      })
      .catch(() => {
        this.loaded = null;
      });
    return this.loaded;
  }
}
