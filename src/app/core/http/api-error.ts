import { type HttpErrorResponse } from '@angular/common/http';

import type { ErrorResponse } from '../api';

/** Mã lỗi phía client (không có trong contract) khi không nhận được response chuẩn. */
export const CLIENT_ERROR_CODES = {
  network: 'NETWORK_ERROR',
  unknown: 'UNKNOWN_ERROR',
} as const;

const DEFAULT_CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
};

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ErrorResponse>).code === 'string' &&
    typeof (value as Partial<ErrorResponse>).message === 'string'
  );
}

/**
 * Lỗi API đã chuẩn hóa. Error interceptor chuyển mọi `HttpErrorResponse` thành `ApiError`,
 * nên service/store/component chỉ cần xử lý một kiểu lỗi.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, string[]>> = {},
  ) {
    super(message);
  }

  static fromHttpError(error: HttpErrorResponse): ApiError {
    if (isErrorResponse(error.error)) {
      return new ApiError(error.status, error.error.code, error.error.message, error.error.details);
    }
    if (error.status === 0) {
      return new ApiError(0, CLIENT_ERROR_CODES.network, error.message);
    }
    const code =
      DEFAULT_CODE_BY_STATUS[error.status] ??
      (error.status >= 500 ? 'INTERNAL_ERROR' : CLIENT_ERROR_CODES.unknown);
    return new ApiError(error.status, code, error.message);
  }

  /** Lỗi theo field của một đường dẫn, vd `fieldErrors('lines.0.quantity')`. */
  fieldErrors(path: string): readonly string[] {
    return this.details[path] ?? [];
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
