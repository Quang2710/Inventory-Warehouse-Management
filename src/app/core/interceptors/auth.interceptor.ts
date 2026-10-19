import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { type Observable, catchError, switchMap, throwError } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { TokenStorage } from '../auth/token-storage';
import { API_BASE_URL } from '../config/app-config';
import { AUTH_RETRIED, SKIP_AUTH } from '../http/http-context';

function withBearer<T>(request: HttpRequest<T>, token: string): HttpRequest<T> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

function isUnauthorized(error: unknown): error is HttpErrorResponse {
  return error instanceof HttpErrorResponse && error.status === 401;
}

/**
 * - Gắn `Authorization: Bearer <access token>` cho request tới API.
 * - Gặp 401: refresh token MỘT lần (dùng chung cho các request đồng thời) rồi gửi lại request.
 * - Refresh thất bại hoặc vẫn 401 sau khi thử lại: kết thúc phiên, chuyển về /login.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const apiBaseUrl = inject(API_BASE_URL);
  const isApiRequest = request.url === apiBaseUrl || request.url.startsWith(`${apiBaseUrl}/`);
  if (request.context.get(SKIP_AUTH) || !isApiRequest) {
    return next(request);
  }

  const auth = inject(AuthStore);
  const tokens = inject(TokenStorage);
  const accessToken = tokens.accessToken;

  return next(accessToken ? withBearer(request, accessToken) : request).pipe(
    catchError((error: unknown) => {
      if (!isUnauthorized(error)) {
        return throwError(() => error);
      }
      if (request.context.get(AUTH_RETRIED) || !tokens.refreshToken) {
        auth.expireSession();
        return throwError(() => error);
      }
      return retryAfterRefresh(request, next, auth, error);
    }),
  );
};

function retryAfterRefresh(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  auth: AuthStore,
  originalError: HttpErrorResponse,
): Observable<HttpEvent<unknown>> {
  return auth.refreshAccessToken().pipe(
    catchError(() => {
      auth.expireSession();
      return throwError(() => originalError);
    }),
    switchMap((newAccessToken) => {
      request.context.set(AUTH_RETRIED, true);
      return next(withBearer(request, newAccessToken)).pipe(
        catchError((retryError: unknown) => {
          if (isUnauthorized(retryError)) {
            auth.expireSession();
          }
          return throwError(() => retryError);
        }),
      );
    }),
  );
}
