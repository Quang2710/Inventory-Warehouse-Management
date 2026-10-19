import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type { AuthTokens, CurrentUser, LoginRequest, LoginResponse } from '../api';
import { API_BASE_URL } from '../config/app-config';
import { SKIP_AUTH, SKIP_ERROR_NOTIFY, SKIP_LOADING, httpContext } from '../http/http-context';

/** Gọi các endpoint `/auth/*` theo contract openapi.yaml. */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.baseUrl}/auth/login`, credentials, {
      context: httpContext(SKIP_AUTH, SKIP_ERROR_NOTIFY),
    });
  }

  refresh(refreshToken: string): Observable<AuthTokens> {
    return this.http.post<AuthTokens>(
      `${this.baseUrl}/auth/refresh`,
      { refreshToken },
      { context: httpContext(SKIP_AUTH, SKIP_ERROR_NOTIFY) },
    );
  }

  logout(refreshToken: string): Observable<void> {
    return this.http.post<void>(
      `${this.baseUrl}/auth/logout`,
      { refreshToken },
      { context: httpContext(SKIP_AUTH, SKIP_ERROR_NOTIFY, SKIP_LOADING) },
    );
  }

  /** @param background chạy ngầm (không hiện thanh tiến trình / thông báo lỗi). */
  me(background = false): Observable<CurrentUser> {
    return this.http.get<CurrentUser>(`${this.baseUrl}/auth/me`, {
      context: background ? httpContext(SKIP_LOADING, SKIP_ERROR_NOTIFY) : undefined,
    });
  }
}
