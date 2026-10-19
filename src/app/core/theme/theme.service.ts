import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';

import { BrowserStorage, STORAGE_KEYS } from '../storage/browser-storage';

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

function isThemeMode(value: string | null): value is ThemeMode {
  return value !== null && (THEME_MODES as readonly string[]).includes(value);
}

/**
 * Theme sáng/tối. Material 3 (`mat.theme` với theme-type `color-scheme`) dùng `light-dark()`,
 * nên chỉ cần đổi `color-scheme` của <html>; chế độ "system" để trình duyệt tự theo hệ điều hành.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly storage = inject(BrowserStorage);

  readonly mode = signal<ThemeMode>(this.initialMode());
  readonly modes = THEME_MODES;

  constructor() {
    effect(() => {
      const mode = this.mode();
      this.document.documentElement.style.colorScheme = mode === 'system' ? 'light dark' : mode;
      this.storage.set(STORAGE_KEYS.theme, mode);
    });
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
  }

  private initialMode(): ThemeMode {
    const saved = this.storage.get(STORAGE_KEYS.theme);
    return isThemeMode(saved) ? saved : 'system';
  }
}
