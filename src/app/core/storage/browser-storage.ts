import { Injectable } from '@angular/core';

/**
 * Bọc localStorage: không ném lỗi khi trình duyệt chặn storage (chế độ riêng tư, quota…).
 */
@Injectable({ providedIn: 'root' })
export class BrowserStorage {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Bỏ qua: tùy chọn chỉ có hiệu lực trong phiên hiện tại.
    }
  }

  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Bỏ qua.
    }
  }
}

/** Khóa lưu trữ dùng chung toàn ứng dụng. */
export const STORAGE_KEYS = {
  language: 'iwm.language',
  theme: 'iwm.theme',
  accessToken: 'iwm.auth.accessToken',
  refreshToken: 'iwm.auth.refreshToken',
} as const;
