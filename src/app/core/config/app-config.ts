import { InjectionToken, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import type { AppEnvironment } from '../../../environments/environment.model';

/** Cấu hình môi trường hiện hành — inject thay vì import trực tiếp để dễ thay khi test. */
export const APP_ENVIRONMENT = new InjectionToken<AppEnvironment>('APP_ENVIRONMENT', {
  providedIn: 'root',
  factory: () => environment,
});

/** Base URL của REST API, ví dụ `/api`. Mọi service gọi API đều ghép URL từ token này. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => inject(APP_ENVIRONMENT).apiUrl.replace(/\/+$/, ''),
});
