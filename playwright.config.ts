import { defineConfig, devices } from '@playwright/test';

const PORT = 4300;
const isCI = !!process.env['CI'];

/**
 * E2E chạy trên `ng serve` (cấu hình development → backend giả MSW trong trình duyệt).
 * Mặc định dùng Google Chrome đã cài trên máy; CI có thể đặt `PW_CHANNEL=chromium`
 * sau khi chạy `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : 4,
  // Lần mở trang đầu của mỗi test phải khởi động MSW + sinh dữ liệu seed (~1s, lâu hơn khi chạy song song).
  expect: { timeout: 15_000 },
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env['PW_CHANNEL'] ?? 'chrome' },
    },
  ],
  webServer: {
    command: `node node_modules/@angular/cli/bin/ng.js serve --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
