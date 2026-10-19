import {
  ChangeDetectionStrategy,
  Component,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type Routes, provideRouter, withComponentInputBinding } from '@angular/router';

import type { CurrentUser, LoginResponse, Permission, Role } from '../app/core/api';
import { AuthStore } from '../app/core/auth/auth.store';
import { authInterceptor } from '../app/core/interceptors/auth.interceptor';
import { errorInterceptor } from '../app/core/interceptors/error.interceptor';

/** Trang rỗng làm đích điều hướng trong test router. */
@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
export class BlankPage {}

/** Provider tối thiểu để test core: router, HttpClient (interceptor thật) + backend giả của Angular. */
export function provideCoreTesting(routes: Routes = []): (Provider | EnvironmentProviders)[] {
  return [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([errorInterceptor, authInterceptor])),
    provideHttpClientTesting(),
  ];
}

export function testUser(role: Role, permissions: Permission[] = []): CurrentUser {
  return {
    id: `user-${role.toLowerCase()}`,
    username: role.toLowerCase(),
    fullName: `Người dùng ${role}`,
    email: `${role.toLowerCase()}@example.com`,
    role,
    permissions,
    warehouseIds: [],
  };
}

/** Đăng nhập qua AuthStore thật, trả lời request `/api/auth/login` bằng HttpTestingController. */
export async function loginAs(user: CurrentUser): Promise<void> {
  const auth = TestBed.inject(AuthStore);
  const backend = TestBed.inject(HttpTestingController);
  const pending = auth.login({ username: user.username, password: 'secret' });
  backend.expectOne('/api/auth/login').flush({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    tokenType: 'Bearer',
    expiresIn: 900,
    user,
  } satisfies LoginResponse);
  await pending;
}
