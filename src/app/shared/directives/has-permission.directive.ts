import { Directive, type TemplateRef, effect, inject, input } from '@angular/core';

import type { Permission } from '../../core/api';
import { AuthStore } from '../../core/auth/auth.store';
import { ConditionalView } from './conditional-view';

/**
 * Chỉ hiển thị khi người dùng có TẤT CẢ các quyền:
 * `<button *hasPermission="'goods-receipt:approve'">Duyệt</button>`
 * `<a *hasPermission="['product:read', 'stock:read']; else noAccess">…</a>`
 *
 * Đây chỉ là ẩn/hiện giao diện — quyền thật luôn được kiểm tra ở server.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector -- tên `*hasPermission` theo đặc tả dự án
  selector: '[hasPermission]',
})
export class HasPermissionDirective {
  private readonly auth = inject(AuthStore);
  private readonly view = new ConditionalView();

  readonly hasPermission = input.required<Permission | readonly Permission[]>();
  readonly hasPermissionElse = input<TemplateRef<unknown> | null>(null);

  constructor() {
    effect(() => {
      const permissions: readonly Permission[] = ([] as Permission[]).concat(this.hasPermission());
      this.view.update(this.auth.hasPermission(...permissions), this.hasPermissionElse());
    });
  }
}
