import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { ApiError } from '../http/api-error';
import { SKIP_ERROR_NOTIFY } from '../http/http-context';
import { NotificationService } from '../notification/notification.service';

/**
 * Lỗi nào hiện snackbar chung. Các lỗi còn lại do nơi gọi hiển thị theo ngữ cảnh:
 * - 401: luồng xác thực tự xử lý (refresh / về trang đăng nhập).
 * - 404, 422: trang/form hiển thị (trạng thái "không tìm thấy", lỗi theo field).
 */
function shouldNotify(status: number): boolean {
  return status === 0 || status === 403 || status === 409 || status >= 500;
}

/**
 * Chuẩn hóa mọi `HttpErrorResponse` thành `ApiError` `{ status, code, message, details }`
 * và hiện thông báo cho lỗi chung (mất mạng, không có quyền, xung đột, lỗi máy chủ).
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const notifications = inject(NotificationService);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }
      const apiError = ApiError.fromHttpError(error);
      if (!request.context.get(SKIP_ERROR_NOTIFY) && shouldNotify(apiError.status)) {
        notifications.error(apiError);
      }
      return throwError(() => apiError);
    }),
  );
};
