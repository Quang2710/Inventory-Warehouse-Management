import { Directive, type TemplateRef, effect, inject, input } from '@angular/core';

import type { Role } from '../../core/api';
import { AuthStore } from '../../core/auth/auth.store';
import { ConditionalView } from './conditional-view';

/**
 * Chỉ hiển thị khi người dùng có MỘT trong các vai trò:
 * `<button *hasRole="'ADMIN'">…</button>`
 * `<section *hasRole="['ADMIN', 'WAREHOUSE_MANAGER']; else readonly">…</section>`
 *
 * Đây chỉ là ẩn/hiện giao diện — quyền thật luôn được kiểm tra ở server.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector -- tên `*hasRole` theo đặc tả dự án
  selector: '[hasRole]',
})
export class HasRoleDirective {
  private readonly auth = inject(AuthStore);
  private readonly view = new ConditionalView();

  readonly hasRole = input.required<Role | readonly Role[]>();
  readonly hasRoleElse = input<TemplateRef<unknown> | null>(null);

  constructor() {
    effect(() => {
      const roles: readonly Role[] = ([] as Role[]).concat(this.hasRole());
      this.view.update(this.auth.hasRole(...roles), this.hasRoleElse());
    });
  }
}
