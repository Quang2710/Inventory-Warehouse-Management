import { http, HttpResponse } from 'msw';

import type {
  AuthTokens,
  CurrentUser,
  ErrorResponse,
  LoginRequest,
  LoginResponse,
  RefreshTokenRequest,
} from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { db } from '../db';
import { recordAudit } from '../domain/audit';
import { toCurrentUser } from '../mappers/user.mapper';
import { authenticate, issueTokens, revokeAllSessions, revokeSession } from '../utils/auth';
import { nowIso } from '../utils/date';
import { verifyPassword } from '../utils/hash';
import { apiError, readJson, Validator } from '../utils/http';
import { verifyToken } from '../utils/jwt';

const API = MOCK_CONFIG.apiUrl;

const invalidRefreshToken = () =>
  apiError(401, 'INVALID_REFRESH_TOKEN', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');

export const authHandlers = [
  http.post<never, LoginRequest, LoginResponse | ErrorResponse>(
    `${API}/auth/login`,
    async ({ request }) => {
      const body = await readJson<LoginRequest>(request);
      new Validator()
        .require('username', body.username, 'Vui lòng nhập tên đăng nhập.')
        .require('password', body.password, 'Vui lòng nhập mật khẩu.')
        .throwIfInvalid();

      const username = String(body.username).trim().toLowerCase();
      const user = db.user.findFirst({ where: { username: { equals: username } } });
      if (!user || !verifyPassword(user.username, String(body.password), user.passwordHash)) {
        recordAudit({
          actor: null,
          actorName: username,
          action: 'LOGIN_FAILED',
          entityType: 'AUTH',
          summary: `Đăng nhập thất bại với tên "${username}"`,
        });
        return apiError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không đúng.');
      }
      if (user.status !== 'ACTIVE') {
        recordAudit({
          actor: user,
          action: 'LOGIN_FAILED',
          entityType: 'AUTH',
          entityId: user.id,
          entityLabel: user.username,
          summary: 'Đăng nhập bị từ chối: tài khoản đã khóa',
        });
        return apiError(
          403,
          'ACCOUNT_LOCKED',
          'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.',
        );
      }

      const updated =
        db.user.update({
          where: { id: { equals: user.id } },
          data: { lastLoginAt: nowIso() },
        }) ?? user;
      recordAudit({
        actor: updated,
        action: 'LOGIN',
        entityType: 'AUTH',
        entityId: updated.id,
        entityLabel: updated.username,
        summary: 'Đăng nhập thành công',
      });
      return HttpResponse.json<LoginResponse>({
        ...issueTokens(updated),
        user: toCurrentUser(updated),
      });
    },
  ),

  http.post<never, RefreshTokenRequest, AuthTokens | ErrorResponse>(
    `${API}/auth/refresh`,
    async ({ request }) => {
      const body = await readJson<RefreshTokenRequest>(request);
      const result =
        typeof body.refreshToken === 'string' ? verifyToken(body.refreshToken, 'refresh') : null;
      if (!result?.valid) {
        return invalidRefreshToken();
      }
      const { jti, sub } = result.payload;
      const session = db.session.findFirst({ where: { id: { equals: jti } } });
      if (session?.revoked) {
        // Refresh token đã xoay vòng mà bị dùng lại → nghi lộ token: thu hồi mọi phiên của người dùng.
        revokeAllSessions(sub);
        return invalidRefreshToken();
      }
      const user = db.user.findFirst({ where: { id: { equals: sub } } });
      if (!user || user.status !== 'ACTIVE') {
        return invalidRefreshToken();
      }
      // Phiên không có trong db của tab này (do tab khác cấp) vẫn hợp lệ nếu chữ ký + hạn đúng.
      if (session) {
        revokeSession(session.id);
      }
      return HttpResponse.json<AuthTokens>(issueTokens(user));
    },
  ),

  http.post(`${API}/auth/logout`, async ({ request }) => {
    const body = await readJson<RefreshTokenRequest>(request);
    if (typeof body.refreshToken === 'string') {
      const result = verifyToken(body.refreshToken, 'refresh');
      if (result.valid && db.session.findFirst({ where: { id: { equals: result.payload.jti } } })) {
        revokeSession(result.payload.jti);
      }
      const user = result.valid
        ? db.user.findFirst({ where: { id: { equals: result.payload.sub } } })
        : null;
      if (user) {
        recordAudit({
          actor: user,
          action: 'LOGOUT',
          entityType: 'AUTH',
          entityId: user.id,
          entityLabel: user.username,
          summary: 'Đăng xuất',
        });
      }
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API}/auth/me`, ({ request }) =>
    HttpResponse.json<CurrentUser>(toCurrentUser(authenticate(request))),
  ),
];
