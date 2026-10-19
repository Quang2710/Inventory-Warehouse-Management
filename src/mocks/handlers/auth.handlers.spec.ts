import { drop } from '@mswjs/data';

import { DEMO_ACCOUNTS } from '../data/demo-accounts';
import { DEFAULT_ROLE_PERMISSIONS } from '../data/rbac';
import { db } from '../db';
import { SEEDED_USER_PASSWORD, seedDatabase } from '../seed';
import { call, login } from '../testing/mock-api';

describe('mock auth handlers', () => {
  beforeAll(() => {
    drop(db);
    seedDatabase(new Date('2026-10-18T10:00:00+07:00'));
  });

  it.each(DEMO_ACCOUNTS.map((account) => [account.username, account] as const))(
    'đăng nhập được với tài khoản demo %s, nhận quyền và phạm vi kho',
    async (_username, account) => {
      const body = await login(account.username, account.password);
      expect(typeof body.accessToken).toBe('string');
      expect(body.user).toEqual(
        expect.objectContaining({
          username: account.username,
          role: account.role,
          permissions: [...DEFAULT_ROLE_PERMISSIONS[account.role]],
          warehouseIds: expect.any(Array),
        }),
      );
    },
  );

  it('sai mật khẩu → 401 INVALID_CREDENTIALS và ghi nhật ký LOGIN_FAILED', async () => {
    const before = db.auditLog.getAll().filter((entry) => entry.action === 'LOGIN_FAILED').length;
    const result = await call('POST', '/auth/login', {
      body: { username: 'admin', password: 'sai-mat-khau' },
    });
    expect(result.status).toBe(401);
    expect(result.body['code']).toBe('INVALID_CREDENTIALS');
    expect(db.auditLog.getAll().filter((entry) => entry.action === 'LOGIN_FAILED')).toHaveLength(
      before + 1,
    );
  });

  it('tài khoản bị khóa → 403 ACCOUNT_LOCKED', async () => {
    const locked = db.user.findFirst({ where: { status: { equals: 'LOCKED' } } })!;
    const result = await call('POST', '/auth/login', {
      body: { username: locked.username, password: SEEDED_USER_PASSWORD },
    });
    expect(result.status).toBe(403);
    expect(result.body['code']).toBe('ACCOUNT_LOCKED');
  });

  it('thiếu thông tin → 422 VALIDATION_ERROR kèm lỗi theo field', async () => {
    const result = await call('POST', '/auth/login', { body: { username: '' } });
    expect(result.status).toBe(422);
    expect(result.body).toEqual(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        details: { username: [expect.any(String)], password: [expect.any(String)] },
      }),
    );
  });

  it('/auth/me yêu cầu access token hợp lệ', async () => {
    expect((await call('GET', '/auth/me')).status).toBe(401);
    expect((await call('GET', '/auth/me', { token: 'gia-mao' })).status).toBe(401);

    const { accessToken } = await login('quanly', 'Quanly@123');
    const me = await call('GET', '/auth/me', { token: accessToken });
    expect(me.status).toBe(200);
    expect(me.body).toEqual(
      expect.objectContaining({ username: 'quanly', role: 'WAREHOUSE_MANAGER' }),
    );
  });

  it('refresh xoay vòng token; dùng lại refresh token cũ → thu hồi toàn bộ phiên', async () => {
    const { refreshToken: first } = await login('nhanvien', 'Nhanvien@123');

    const rotated = await call('POST', '/auth/refresh', { body: { refreshToken: first } });
    expect(rotated.status).toBe(200);
    const second = rotated.body['refreshToken'];
    expect(second).not.toBe(first);

    const reused = await call('POST', '/auth/refresh', { body: { refreshToken: first } });
    expect(reused.status).toBe(401);
    expect(reused.body['code']).toBe('INVALID_REFRESH_TOKEN');

    const afterReuse = await call('POST', '/auth/refresh', { body: { refreshToken: second } });
    expect(afterReuse.status).toBe(401);
  });

  it('đăng xuất thu hồi refresh token', async () => {
    const { refreshToken } = await login('ketoan', 'Ketoan@123');
    expect((await call('POST', '/auth/logout', { body: { refreshToken } })).status).toBe(204);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken } })).status).toBe(401);
  });

  it('/__demo/accounts trả 4 tài khoản, mỗi vai trò một tài khoản', async () => {
    const result = await call<{ role: string }[]>('GET', '/__demo/accounts');
    expect(result.body).toHaveLength(4);
    expect(new Set(result.body.map((account) => account.role)).size).toBe(4);
  });
});
