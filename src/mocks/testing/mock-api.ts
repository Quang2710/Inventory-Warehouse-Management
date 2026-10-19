import { getResponse } from 'msw';

import { handlers } from '../handlers';

/**
 * Gọi handler MSW trực tiếp (không qua mạng) trong unit test của backend giả.
 * Bỏ qua handler đầu tiên (độ trễ + lỗi ngẫu nhiên) để test nhanh và tất định.
 */
const businessHandlers = handlers.slice(1);

export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export async function call<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<ApiResult<T>> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }
  const request = new Request(new URL(`/api${path}`, location.origin), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let response: Response | undefined;
  try {
    response = await getResponse(businessHandlers, request);
  } catch (thrown) {
    // Resolver ném Response (401/403/422…) — đó chính là response trả về client.
    if (thrown instanceof Response) {
      response = thrown;
    } else {
      throw thrown;
    }
  }
  if (!response) {
    throw new Error(`Không có handler cho ${method} ${path}`);
  }
  const body = (response.status === 204 ? null : await response.json()) as T;
  return { status: response.status, body };
}

/** Đăng nhập, trả access token + phản hồi đầy đủ. */
export async function login(username: string, password: string) {
  const result = await call<{
    accessToken: string;
    refreshToken: string;
    user: Record<string, unknown>;
  }>('POST', '/auth/login', { body: { username, password } });
  if (result.status !== 200) {
    throw new Error(`Đăng nhập ${username} thất bại: ${result.status}`);
  }
  return result.body;
}

export const DEMO_PASSWORDS = {
  admin: 'Admin@123',
  quanly: 'Quanly@123',
  nhanvien: 'Nhanvien@123',
  ketoan: 'Ketoan@123',
} as const;

export async function tokenOf(username: keyof typeof DEMO_PASSWORDS): Promise<string> {
  return (await login(username, DEMO_PASSWORDS[username])).accessToken;
}
