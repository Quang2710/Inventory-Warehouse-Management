import { DOCUMENT, DestroyRef, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { type Observable, finalize, firstValueFrom, map, shareReplay, tap, throwError } from 'rxjs';

import type { CurrentUser, LoginRequest, Permission, Role } from '../api';
import { NotificationService } from '../notification/notification.service';
import { STORAGE_KEYS } from '../storage/browser-storage';
import { AuthApi } from './auth.api';
import type { RouteAccess } from './route-access';
import { TokenStorage } from './token-storage';

/** `unknown`: chưa khôi phục phiên (trước app initializer). */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

/** Lý do kết thúc phiên — hiển thị thông báo tương ứng trên màn hình đăng nhập. */
export type SessionEndReason = 'logout' | 'expired' | 'demo-reset';

interface AuthState {
  user: CurrentUser | null;
  status: AuthStatus;
}

/**
 * State xác thực dùng chung: người dùng hiện tại, vai trò, quyền và vòng đời phiên.
 * Quyền lấy từ server (`/auth/me`, `/auth/login`) — client không tự suy ra quyền từ vai trò.
 */
export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>({ user: null, status: 'unknown' }),
  withProps(() => ({
    _api: inject(AuthApi),
    _tokens: inject(TokenStorage),
    _router: inject(Router),
    _notify: inject(NotificationService),
  })),
  withComputed(({ user }) => ({
    isAuthenticated: computed(() => user() !== null),
    role: computed<Role | null>(() => user()?.role ?? null),
    permissions: computed<ReadonlySet<Permission>>(() => new Set(user()?.permissions ?? [])),
    /** Kho được phép thao tác; `null` = mọi kho. */
    warehouseScope: computed<ReadonlySet<string> | null>(() => {
      const ids = user()?.warehouseIds ?? [];
      return ids.length > 0 ? new Set(ids) : null;
    }),
  })),
  withMethods((store) => {
    /** Refresh đang chạy — mọi request 401 đồng thời dùng chung một lần refresh. */
    let refreshInFlight$: Observable<string> | null = null;
    let lastProfileRefresh = 0;

    const clearSession = (): void => {
      store._tokens.clear();
      patchState(store, { user: null, status: 'anonymous' });
    };

    const hasRole = (...roles: readonly Role[]): boolean => {
      const role = store.role();
      return role !== null && roles.includes(role);
    };

    const hasPermission = (...permissions: readonly Permission[]): boolean => {
      const granted = store.permissions();
      return store.isAuthenticated() && permissions.every((permission) => granted.has(permission));
    };

    const endSession = async (reason: SessionEndReason, returnUrl?: string): Promise<void> => {
      clearSession();
      const queryParams = returnUrl && returnUrl !== '/' ? { reason, returnUrl } : { reason };
      await store._router.navigate(['/login'], { queryParams });
    };

    return {
      hasRole,
      hasPermission,

      canAccess(access?: RouteAccess | null): boolean {
        if (!store.isAuthenticated()) {
          return false;
        }
        const rolesOk = !access?.roles?.length || hasRole(...access.roles);
        const permissionsOk = !access?.permissions?.length || hasPermission(...access.permissions);
        return rolesOk && permissionsOk;
      },

      /** Người dùng có được thao tác tại kho này không (phạm vi kho). */
      canAccessWarehouse(warehouseId: string | null | undefined): boolean {
        const scope = store.warehouseScope();
        return (
          !!warehouseId && store.isAuthenticated() && (scope === null || scope.has(warehouseId))
        );
      },

      /**
       * Nạp lại quyền/phạm vi từ server (Admin có thể vừa đổi ma trận quyền).
       * Bỏ qua nếu vừa nạp trong `minIntervalMs`.
       */
      async refreshProfile(minIntervalMs = 30_000): Promise<void> {
        if (store.status() !== 'authenticated' || Date.now() - lastProfileRefresh < minIntervalMs) {
          return;
        }
        lastProfileRefresh = Date.now();
        try {
          const user = await firstValueFrom(store._api.me(true));
          patchState(store, { user });
        } catch {
          // Lỗi mạng/hết phiên đã được interceptor xử lý.
        }
      },

      async login(credentials: LoginRequest): Promise<CurrentUser> {
        const response = await firstValueFrom(store._api.login(credentials));
        store._tokens.save(response);
        patchState(store, { user: response.user, status: 'authenticated' });
        return response.user;
      },

      /** Gọi trong app initializer: có refresh token thì nạp lại người dùng (tự refresh nếu cần). */
      async restoreSession(): Promise<void> {
        if (!store._tokens.refreshToken) {
          clearSession();
          return;
        }
        try {
          const user = await firstValueFrom(store._api.me());
          patchState(store, { user, status: 'authenticated' });
        } catch {
          clearSession();
        }
      },

      refreshAccessToken(): Observable<string> {
        const refreshToken = store._tokens.refreshToken;
        if (!refreshToken) {
          return throwError(() => new Error('Không có refresh token.'));
        }
        refreshInFlight$ ??= store._api.refresh(refreshToken).pipe(
          tap((tokens) => store._tokens.save(tokens)),
          map((tokens) => tokens.accessToken),
          finalize(() => (refreshInFlight$ = null)),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
        return refreshInFlight$;
      },

      async logout(): Promise<void> {
        const refreshToken = store._tokens.refreshToken;
        if (refreshToken) {
          // Thu hồi phía server; lỗi mạng không chặn việc đăng xuất ở client.
          store._api.logout(refreshToken).subscribe({ error: () => undefined });
        }
        await endSession('logout');
      },

      /** Refresh thất bại hoặc server từ chối phiên → về trang đăng nhập, giữ lại URL đang xem. */
      expireSession(): void {
        if (store.status() !== 'authenticated') {
          clearSession();
          return;
        }
        store._notify.warning('auth.sessionExpired');
        void endSession('expired', store._router.url);
      },

      /** Kết thúc phiên phía client (vd sau khi reset dữ liệu demo — mọi phiên đã bị xóa). */
      endSession,
    };
  }),
  withHooks({
    onInit(store) {
      // Đồng bộ đăng xuất giữa các tab: tab khác xóa refresh token → tab này cũng thoát.
      const view = inject(DOCUMENT).defaultView;
      const onStorage = (event: StorageEvent): void => {
        const tokenRemoved =
          event.key === null ||
          (event.key === STORAGE_KEYS.refreshToken && event.newValue === null);
        if (tokenRemoved && store.isAuthenticated()) {
          void store.endSession('logout');
        }
      };
      // Quay lại tab → nạp lại quyền để giao diện phản ánh thay đổi phân quyền mới nhất.
      const onVisibility = (): void => {
        if (view?.document.visibilityState === 'visible') {
          void store.refreshProfile();
        }
      };
      view?.addEventListener('storage', onStorage);
      view?.document.addEventListener('visibilitychange', onVisibility);
      inject(DestroyRef).onDestroy(() => {
        view?.removeEventListener('storage', onStorage);
        view?.document.removeEventListener('visibilitychange', onVisibility);
      });
    },
  }),
);

export type AuthStore = InstanceType<typeof AuthStore>;
