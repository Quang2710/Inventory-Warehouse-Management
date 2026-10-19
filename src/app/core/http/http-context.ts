import { HttpContext, HttpContextToken } from '@angular/common/http';

/** Không gắn access token và không tự refresh khi 401 (dùng cho login/refresh/logout). */
export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);

/** Không hiện snackbar lỗi chung — nơi gọi tự hiển thị lỗi (vd form đăng nhập). */
export const SKIP_ERROR_NOTIFY = new HttpContextToken<boolean>(() => false);

/** Không hiện thanh tiến trình toàn cục (vd request chạy ngầm). */
export const SKIP_LOADING = new HttpContextToken<boolean>(() => false);

/** Đánh dấu request đã được thử lại sau khi refresh token — tránh vòng lặp vô hạn. */
export const AUTH_RETRIED = new HttpContextToken<boolean>(() => false);

export function httpContext(
  ...flags: (typeof SKIP_AUTH | typeof SKIP_ERROR_NOTIFY | typeof SKIP_LOADING)[]
): HttpContext {
  return flags.reduce((context, flag) => context.set(flag, true), new HttpContext());
}
