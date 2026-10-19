import { DATE_PIPE_DEFAULT_OPTIONS, registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import localeVi from '@angular/common/locales/vi';
import {
  type ApplicationConfig,
  DEFAULT_CURRENCY_CODE,
  LOCALE_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatIconRegistry } from '@angular/material/icon';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';

import { routes } from './app.routes';
import { AuthStore } from './core/auth/auth.store';
import { AppTitleStrategy } from './core/i18n/app-title.strategy';
import { I18nService } from './core/i18n/i18n.service';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { loadingInterceptor } from './core/interceptors/loading.interceptor';
import { ThemeService } from './core/theme/theme.service';

registerLocaleData(localeVi);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    // Thứ tự: loading (ngoài cùng) → error (chuẩn hóa lỗi) → auth (gắn token, refresh khi 401).
    provideHttpClient(withInterceptors([loadingInterceptor, errorInterceptor, authInterceptor])),
    { provide: TitleStrategy, useClass: AppTitleStrategy },

    // Định dạng nghiệp vụ cố định theo Việt Nam (kể cả khi giao diện tiếng Anh):
    // tiền VND, ngày dd/MM/yyyy, múi giờ Asia/Ho_Chi_Minh (UTC+7).
    { provide: LOCALE_ID, useValue: 'vi' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'VND' },
    {
      provide: DATE_PIPE_DEFAULT_OPTIONS,
      useValue: { dateFormat: 'dd/MM/yyyy', timezone: '+0700' },
    },

    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
    },
    {
      provide: MAT_SNACK_BAR_DEFAULT_OPTIONS,
      useValue: { horizontalPosition: 'end', verticalPosition: 'bottom' },
    },

    provideAppInitializer(() => {
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
      inject(ThemeService); // áp dụng theme đã lưu trước khi render
      const i18n = inject(I18nService);
      const auth = inject(AuthStore);
      return i18n.init().then(() => auth.restoreSession());
    }),
  ],
};
