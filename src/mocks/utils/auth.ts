import type { AuthTokens, Permission } from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { hasPermission } from '../data/rbac';
import { db, type UserEntity } from '../db';
import { errors } from './http';
import { signToken, verifyToken } from './jwt';

/**
 * Xác thực request bằng access token (Bearer). Ném Response 401 nếu không hợp lệ.
 * Dùng trong resolver: `const user = authenticate(request);`
 */
export function authenticate(request: Request): UserEntity {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '');
  if (!match) {
    throw errors.unauthorized('Bạn chưa đăng nhập.');
  }
  const result = verifyToken(match[1], 'access');
  if (!result.valid) {
    throw result.reason === 'expired'
      ? errors.unauthorized('Phiên làm việc đã hết hạn.', 'TOKEN_EXPIRED')
      : errors.unauthorized();
  }
  const user = db.user.findFirst({ where: { id: { equals: result.payload.sub } } });
  if (!user || user.status !== 'ACTIVE') {
    throw errors.unauthorized('Tài khoản không còn hiệu lực.');
  }
  return user;
}

/** Xác thực + kiểm tra đủ TẤT CẢ quyền. Thiếu quyền → ném Response 403. */
export function authorize(request: Request, ...permissions: Permission[]): UserEntity {
  const user = authenticate(request);
  if (!permissions.every((permission) => hasPermission(user.role, permission))) {
    throw errors.forbidden();
  }
  return user;
}

function purgeExpiredSessions(nowMs: number): void {
  db.session
    .getAll()
    .filter((session) => Date.parse(session.expiresAt) <= nowMs)
    .forEach((session) => db.session.delete({ where: { id: { equals: session.id } } }));
}

/** Cấp cặp access/refresh token mới và ghi nhận phiên (jti của refresh token). */
export function issueTokens(user: UserEntity, nowMs = Date.now()): AuthTokens {
  purgeExpiredSessions(nowMs);
  const sessionId = crypto.randomUUID();
  db.session.create({
    id: sessionId,
    user,
    expiresAt: new Date(nowMs + MOCK_CONFIG.refreshTokenTtlSec * 1000).toISOString(),
    revoked: false,
    createdAt: new Date(nowMs).toISOString(),
  });
  const claims = { sub: user.id, username: user.username, role: user.role };
  return {
    accessToken: signToken(
      { ...claims, type: 'access', jti: crypto.randomUUID() },
      MOCK_CONFIG.accessTokenTtlSec,
      nowMs,
    ),
    refreshToken: signToken(
      { ...claims, type: 'refresh', jti: sessionId },
      MOCK_CONFIG.refreshTokenTtlSec,
      nowMs,
    ),
    tokenType: 'Bearer',
    expiresIn: MOCK_CONFIG.accessTokenTtlSec,
  };
}

export function revokeSession(sessionId: string): void {
  db.session.update({ where: { id: { equals: sessionId } }, data: { revoked: true } });
}

export function revokeAllSessions(userId: string): void {
  db.session
    .getAll()
    .filter((session) => session.user?.id === userId)
    .forEach((session) => revokeSession(session.id));
}
