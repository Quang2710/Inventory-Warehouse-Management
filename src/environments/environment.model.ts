export interface AppEnvironment {
  /** Build tối ưu cho production. */
  production: boolean;
  /** Base URL của REST API (không có dấu `/` ở cuối). Đổi giá trị này để trỏ sang backend thật. */
  apiUrl: string;
  /**
   * Bật backend giả (MSW). Mock CHỈ được nạp (dynamic import) trong `src/main.ts`;
   * UI chỉ đọc cờ này để hiện tiện ích demo (tài khoản mẫu, nút "Reset dữ liệu demo").
   */
  useMock: boolean;
  /** Ngôn ngữ mặc định khi người dùng chưa chọn. */
  defaultLanguage: 'vi' | 'en';
  /**
   * PWA (cài lên màn hình chính, chạy offline app shell). `script`:
   * - `ngsw-worker.js`: service worker của Angular (bản build thật).
   * - `app-sw.js`: bản demo — gộp MSW (request `/api`) với ngsw (còn lại) vì một scope chỉ có
   *   một service worker.
   */
  serviceWorker: { enabled: boolean; script: 'ngsw-worker.js' | 'app-sw.js' };
}
