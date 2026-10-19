import { signToken, verifyToken } from './jwt';

describe('mock JWT', () => {
  const claims = {
    sub: 'user-1',
    username: 'admin',
    role: 'ADMIN' as const,
    jti: 'jti-1',
  };

  it('ký và xác thực token hợp lệ', () => {
    const token = signToken({ ...claims, type: 'access' }, 60, 1_000_000);
    const result = verifyToken(token, 'access', 1_000_000 + 30_000);
    expect(result).toEqual({
      valid: true,
      payload: expect.objectContaining({ sub: 'user-1', role: 'ADMIN', exp: 1000 + 60 }),
    });
  });

  it('từ chối token hết hạn, sai loại hoặc bị sửa', () => {
    const token = signToken({ ...claims, type: 'access' }, 60, 1_000_000);
    expect(verifyToken(token, 'access', 1_000_000 + 61_000)).toEqual({
      valid: false,
      reason: 'expired',
    });
    expect(verifyToken(token, 'refresh', 1_000_000)).toEqual({ valid: false, reason: 'type' });

    const [header, , signature] = token.split('.');
    const forgedPayload = btoa(
      JSON.stringify({ ...claims, role: 'ADMIN', type: 'access', exp: 9e9 }),
    );
    expect(verifyToken(`${header}.${forgedPayload}.${signature}`, 'access').valid).toBe(false);
    expect(verifyToken('not-a-jwt', 'access')).toEqual({ valid: false, reason: 'malformed' });
  });

  it('payload giải mã được như JWT chuẩn (base64url, hỗ trợ tiếng Việt)', () => {
    const token = signToken({ ...claims, username: 'Đặng Thị Ánh', type: 'refresh' }, 60);
    const result = verifyToken(token, 'refresh');
    expect(result.valid && result.payload.username).toBe('Đặng Thị Ánh');
  });
});
