import type { Role } from '../../app/core/api/schema';
import { fnv1a } from './hash';

/**
 * JWT GIẢ cho backend mock: cấu trúc header.payload.signature đúng chuẩn (decode được bằng
 * jwt.io) nhưng chữ ký chỉ là băm FNV — không an toàn, không dùng ngoài mock.
 */
export type TokenType = 'access' | 'refresh';

export interface MockJwtPayload {
  sub: string;
  username: string;
  role: Role;
  type: TokenType;
  jti: string;
  /** Giây kể từ epoch. */
  iat: number;
  exp: number;
}

export type VerifyResult =
  | { valid: true; payload: MockJwtPayload }
  | { valid: false; reason: 'malformed' | 'signature' | 'expired' | 'type' };

const SECRET = 'iwm-mock-jwt-secret';
const HEADER = { alg: 'HS256', typ: 'JWT' } as const;

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function signature(data: string): string {
  return base64UrlEncode(fnv1a(`${data}.${SECRET}`) + fnv1a(`${SECRET}.${data}`));
}

export function signToken(
  claims: Omit<MockJwtPayload, 'iat' | 'exp'>,
  ttlSeconds: number,
  nowMs = Date.now(),
): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: MockJwtPayload = { ...claims, iat, exp: iat + ttlSeconds };
  const data = `${base64UrlEncode(JSON.stringify(HEADER))}.${base64UrlEncode(JSON.stringify(payload))}`;
  return `${data}.${signature(data)}`;
}

function isPayload(value: unknown): value is MockJwtPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['sub'] === 'string' &&
    typeof candidate['jti'] === 'string' &&
    typeof candidate['exp'] === 'number' &&
    (candidate['type'] === 'access' || candidate['type'] === 'refresh')
  );
}

export function verifyToken(
  token: string,
  expectedType: TokenType,
  nowMs = Date.now(),
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed' };
  }
  const [header, body, sig] = parts;
  if (signature(`${header}.${body}`) !== sig) {
    return { valid: false, reason: 'signature' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(body));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (!isPayload(payload)) {
    return { valid: false, reason: 'malformed' };
  }
  if (payload.type !== expectedType) {
    return { valid: false, reason: 'type' };
  }
  if (payload.exp * 1000 <= nowMs) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, payload };
}
