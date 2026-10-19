import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

import type {
  Permission,
  Role,
  RoleDefinition,
  User,
  UserCreateRequest,
  UserPage,
  UserUpdateRequest,
} from '../../../core/api';
import { API_BASE_URL } from '../../../core/config/app-config';
import { toHttpParams } from '../../../core/http/query-params';

/** Người dùng (`/users`) và ma trận phân quyền (`/roles`). */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(query: Record<string, string | number>): Observable<UserPage> {
    return this.http.get<UserPage>(`${this.baseUrl}/users`, { params: toHttpParams(query) });
  }

  create(body: UserCreateRequest): Observable<User> {
    return this.http.post<User>(`${this.baseUrl}/users`, body);
  }

  update(id: string, body: UserUpdateRequest): Observable<User> {
    return this.http.put<User>(`${this.baseUrl}/users/${id}`, body);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/users/${id}`);
  }

  resetPassword(id: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/users/${id}/reset-password`, { newPassword });
  }

  roles(): Observable<RoleDefinition[]> {
    return this.http.get<RoleDefinition[]>(`${this.baseUrl}/roles`);
  }

  updateRolePermissions(role: Role, permissions: Permission[]): Observable<RoleDefinition> {
    return this.http.put<RoleDefinition>(`${this.baseUrl}/roles/${role}/permissions`, {
      permissions,
    });
  }
}
