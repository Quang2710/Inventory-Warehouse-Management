import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { type ActivatedRouteSnapshot, RouterLink } from '@angular/router';

import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface Crumb {
  /** Khóa dịch (khi `data.breadcrumb` là chuỗi). */
  labelKey?: string;
  /** Nhãn đã có sẵn (khi `data.breadcrumb` là hàm, vd tên kho từ resolver). */
  label?: string;
  url: string;
}

export const BREADCRUMB_KEY = 'breadcrumb';

/** `data.breadcrumb`: khóa dịch, hoặc hàm trả nhãn động từ dữ liệu đã resolve của route. */
export type BreadcrumbValue =
  string | ((route: ActivatedRouteSnapshot) => string | null | undefined);

/**
 * Dựng breadcrumb từ cây route đang kích hoạt: mỗi route TỰ khai báo `data.breadcrumb`
 * (không tính data kế thừa từ route cha) sẽ thành một nút.
 */
export function buildBreadcrumbs(root: ActivatedRouteSnapshot): Crumb[] {
  const crumbs: Crumb[] = [];
  const segments: string[] = [];
  let route: ActivatedRouteSnapshot | null = root;
  while (route) {
    segments.push(...route.url.map((segment) => segment.path));
    const value = route.routeConfig?.data?.[BREADCRUMB_KEY] as BreadcrumbValue | undefined;
    const url = `/${segments.join('/')}`;
    if (typeof value === 'string') {
      crumbs.push({ labelKey: value, url });
    } else if (typeof value === 'function') {
      const label = value(route);
      if (label) crumbs.push({ label, url });
    }
    route = route.firstChild;
  }
  return crumbs;
}

@Component({
  selector: 'app-breadcrumb',
  imports: [RouterLink, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="'nav.breadcrumb' | t">
      <ol>
        <li>
          <a routerLink="/" [attr.aria-label]="'nav.home' | t">
            <mat-icon aria-hidden="true">home</mat-icon>
          </a>
        </li>
        @for (crumb of crumbs(); track crumb.url; let last = $last) {
          <li>
            <mat-icon class="separator" aria-hidden="true">chevron_right</mat-icon>
            @if (last) {
              <span aria-current="page">{{ label(crumb) }}</span>
            } @else {
              <a [routerLink]="crumb.url">{{ label(crumb) }}</a>
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: `
    ol {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
    }
    li {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    a {
      display: inline-flex;
      color: inherit;
      text-decoration: none;
      border-radius: var(--mat-sys-corner-extra-small);
    }
    a:hover {
      color: var(--mat-sys-primary);
      text-decoration: underline;
    }
    mat-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }
    [aria-current='page'] {
      color: var(--mat-sys-on-surface);
    }
  `,
})
export class Breadcrumb {
  private readonly i18n = inject(I18nService);

  readonly crumbs = input.required<readonly Crumb[]>();

  protected label(crumb: Crumb): string {
    return crumb.label ?? this.i18n.translate(crumb.labelKey ?? '');
  }
}
