import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';

import { I18nService } from './i18n.service';

/**
 * `title` trong route là KHÓA DỊCH (vd `'nav.products'`). Tiêu đề tab = "<trang> · <tên app>"
 * và tự cập nhật khi đổi ngôn ngữ.
 */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly i18n = inject(I18nService);
  private readonly pageKey = signal<string | undefined>(undefined);

  constructor() {
    super();
    effect(() => {
      const appName = this.i18n.t('app.name');
      const key = this.pageKey();
      this.title.setTitle(key ? `${this.i18n.translate(key)} · ${appName}` : appName);
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.pageKey.set(this.buildTitle(snapshot));
  }
}
