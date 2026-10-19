import { test as base, expect, type Page } from '@playwright/test';

import { vi } from '../src/app/core/i18n/translations/vi';

/**
 * Trang đã cấu hình backend giả cho e2e: tắt lỗi 500 ngẫu nhiên và giảm độ trễ
 * để test ổn định (xem src/mocks/config.ts). Mỗi test có trình duyệt riêng → dữ liệu seed mới.
 */
export const test = base.extend<{ mockOverrides: Record<string, string> }>({
  mockOverrides: [
    { 'iwm.mock.errorRate': '0', 'iwm.mock.delayMin': '0', 'iwm.mock.delayMax': '50' },
    { option: true },
  ],
  page: async ({ page, mockOverrides }, use) => {
    await page.addInitScript((overrides) => {
      for (const [key, value] of Object.entries(overrides)) {
        localStorage.setItem(key, value);
      }
    }, mockOverrides);
    await use(page);
  },
});

export { expect };

/** Bản dịch tiếng Việt của ứng dụng — dùng làm nhãn để tìm phần tử theo vai trò truy cập. */
export const t = vi;

export async function loginWithForm(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel(t.auth.login.username, { exact: true }).fill(username);
  await page.getByLabel(t.auth.login.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: t.auth.login.submit, exact: true }).click();
}
