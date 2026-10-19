import { HttpResponse } from 'msw';

import type { ErrorResponse } from '../../app/core/api/schema';

export type FieldErrors = Record<string, string[]>;

/** Response lỗi chuẩn `{ code, message, details? }`. Có thể `throw` trong resolver của MSW. */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: FieldErrors,
): HttpResponse<ErrorResponse> {
  const body: ErrorResponse = details ? { code, message, details } : { code, message };
  return HttpResponse.json(body, { status });
}

export const errors = {
  unauthorized: (
    message = 'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại.',
    code = 'UNAUTHORIZED',
  ) => apiError(401, code, message),
  forbidden: (message = 'Bạn không có quyền thực hiện thao tác này.') =>
    apiError(403, 'FORBIDDEN', message),
  notFound: (message = 'Không tìm thấy dữ liệu.') => apiError(404, 'NOT_FOUND', message),
  conflict: (message: string) => apiError(409, 'CONFLICT', message),
  invalidState: (message: string) => apiError(409, 'INVALID_STATE', message),
  validation: (details: FieldErrors, message = 'Dữ liệu không hợp lệ, vui lòng kiểm tra lại.') =>
    apiError(422, 'VALIDATION_ERROR', message, details),
  insufficientStock: (details: FieldErrors, message = 'Không đủ tồn kho để thực hiện.') =>
    apiError(422, 'INSUFFICIENT_STOCK', message, details),
  internal: (message = 'Lỗi hệ thống, vui lòng thử lại sau.') =>
    apiError(500, 'INTERNAL_ERROR', message),
};

/** Đọc body JSON; body hỏng trả về object rỗng để bước validate báo lỗi theo field. */
export async function readJson<T extends object>(request: Request): Promise<Partial<T>> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}

/** Gom lỗi validate theo field; ném 422 nếu có lỗi. */
export class Validator {
  private readonly fieldErrors: FieldErrors = {};

  require(field: string, value: unknown, message = 'Trường này là bắt buộc.'): this {
    const empty =
      value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (empty) {
      this.add(field, message);
    }
    return this;
  }

  check(condition: boolean, field: string, message: string): this {
    if (!condition) {
      this.add(field, message);
    }
    return this;
  }

  add(field: string, message: string): this {
    (this.fieldErrors[field] ??= []).push(message);
    return this;
  }

  get hasErrors(): boolean {
    return Object.keys(this.fieldErrors).length > 0;
  }

  throwIfInvalid(message?: string): void {
    if (this.hasErrors) {
      throw errors.validation(this.fieldErrors, message);
    }
  }
}

export function noContent(): HttpResponse<null> {
  return new HttpResponse(null, { status: 204 });
}

/** Chuỗi khác rỗng, đã trim; ngược lại `null`. */
export function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
