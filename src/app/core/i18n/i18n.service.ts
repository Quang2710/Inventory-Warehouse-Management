import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

import { APP_ENVIRONMENT } from '../config/app-config';
import { type ApiError, isApiError } from '../http/api-error';
import { BrowserStorage, STORAGE_KEYS } from '../storage/browser-storage';
import {
  LANGUAGES,
  type Language,
  type TranslationKey,
  type TranslationParams,
  type Translations,
} from './i18n.types';
import { vi } from './translations/vi';

/** Bản dịch ngoài tiếng Việt được nạp lười (tách chunk riêng). */
const LOADERS: Record<Exclude<Language, 'vi'>, () => Promise<Translations>> = {
  en: () => import('./translations/en').then((module) => module.en),
};

function isLanguage(value: string | null): value is Language {
  return value !== null && (LANGUAGES as readonly string[]).includes(value);
}

function lookup(dictionary: Translations, key: string): string | undefined {
  let node: unknown = dictionary;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * i18n gọn nhẹ dựa trên signals (đổi ngôn ngữ tức thì, không cần tải lại trang).
 * Không dùng @angular/localize vì cần đổi ngôn ngữ lúc chạy trong cùng một bản build.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly document = inject(DOCUMENT);
  private readonly storage = inject(BrowserStorage);
  private readonly environment = inject(APP_ENVIRONMENT);

  private readonly dictionaries = signal<Partial<Record<Language, Translations>>>({ vi });
  private readonly current = signal<Language>('vi');

  readonly language = this.current.asReadonly();
  readonly languages = LANGUAGES;
  private readonly dictionary = computed(() => this.dictionaries()[this.current()] ?? vi);

  constructor() {
    effect(() => {
      this.document.documentElement.lang = this.current();
    });
  }

  /** Gọi trong app initializer: khôi phục ngôn ngữ đã chọn trước khi render. */
  async init(): Promise<void> {
    const saved = this.storage.get(STORAGE_KEYS.language);
    await this.use(isLanguage(saved) ? saved : this.environment.defaultLanguage);
  }

  async use(language: Language): Promise<void> {
    if (!this.dictionaries()[language] && language !== 'vi') {
      try {
        const dictionary = await LOADERS[language]();
        this.dictionaries.update((loaded) => ({ ...loaded, [language]: dictionary }));
      } catch (error) {
        console.error(`Không tải được bản dịch "${language}"`, error);
        return;
      }
    }
    this.current.set(language);
    this.storage.set(STORAGE_KEYS.language, language);
  }

  /** Dịch theo khóa; thiếu bản dịch thì dùng tiếng Việt, cuối cùng trả lại chính khóa. */
  t(key: TranslationKey, params?: TranslationParams): string {
    return this.translate(key, params);
  }

  /** Dịch khóa động (từ route data, cấu hình…). Khóa không tồn tại → trả lại nguyên chuỗi. */
  translate(key: string, params?: TranslationParams): string {
    const template = lookup(this.dictionary(), key) ?? lookup(vi, key) ?? key;
    return interpolate(template, params);
  }

  /** Thông điệp thân thiện cho lỗi bất kỳ: ưu tiên bản dịch theo mã lỗi, rồi thông điệp từ server. */
  errorMessage(error: unknown): string {
    if (!isApiError(error)) {
      return this.t('errors.unknown');
    }
    const byCode = lookup(this.dictionary(), `errors.codes.${error.code}`);
    if (byCode) {
      return byCode;
    }
    return error.message && !this.isTechnicalMessage(error) ? error.message : this.fallback(error);
  }

  private isTechnicalMessage(error: ApiError): boolean {
    // Thông điệp mặc định của HttpErrorResponse ("Http failure response for …") không dành cho người dùng.
    return /^Http failure/i.test(error.message);
  }

  private fallback(error: ApiError): string {
    if (error.status === 0) return this.t('errors.network');
    if (error.status === 403) return this.t('errors.forbidden');
    if (error.status >= 500) return this.t('errors.server');
    return this.t('errors.unknown');
  }
}
