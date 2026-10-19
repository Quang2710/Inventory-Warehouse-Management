import type { vi } from './translations/vi';

export const LANGUAGES = ['vi', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

type Dictionary<T> = { [K in keyof T]: T[K] extends string ? string : Dictionary<T[K]> };

/** Cấu trúc bắt buộc của mọi bản dịch (theo bản gốc tiếng Việt). */
export type Translations = Dictionary<typeof vi>;

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Khóa dịch hợp lệ, vd `'auth.login.title'` — sai khóa sẽ lỗi biên dịch. */
export type TranslationKey = Leaves<typeof vi>;

export type TranslationParams = Readonly<Record<string, string | number>>;
