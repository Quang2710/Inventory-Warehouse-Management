import { Injectable, inject } from '@angular/core';

import type { AuthTokens } from '../api';
import { BrowserStorage, STORAGE_KEYS } from '../storage/browser-storage';

/**
 * Lưu cặp token để F5 không mất phiên.
 *
 * Lưu ý bảo mật: localStorage đọc được bởi JavaScript (rủi ro XSS). Với backend thật nên chuyển
 * refresh token sang cookie `HttpOnly; Secure; SameSite=Strict` — chỉ cần thay lớp này.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorage {
  private readonly storage = inject(BrowserStorage);

  get accessToken(): string | null {
    return this.storage.get(STORAGE_KEYS.accessToken);
  }

  get refreshToken(): string | null {
    return this.storage.get(STORAGE_KEYS.refreshToken);
  }

  save(tokens: Pick<AuthTokens, 'accessToken' | 'refreshToken'>): void {
    this.storage.set(STORAGE_KEYS.accessToken, tokens.accessToken);
    this.storage.set(STORAGE_KEYS.refreshToken, tokens.refreshToken);
  }

  clear(): void {
    this.storage.remove(STORAGE_KEYS.accessToken);
    this.storage.remove(STORAGE_KEYS.refreshToken);
  }
}
