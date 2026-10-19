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
}
