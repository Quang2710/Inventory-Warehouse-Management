import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { appConfig } from './app/app.config';
import { environment } from './environments/environment';

/**
 * Backend giả (MSW) CHỈ được nạp tại đây, bằng dynamic import và chỉ khi `useMock === true`.
 * Code ứng dụng không bao giờ import `src/mocks` (ESLint chặn) — đổi sang backend thật chỉ cần
 * đổi environment.
 *
 * `MOCK_BACKEND_BUNDLED` (hằng build-time) giúp esbuild loại bỏ nhánh này ở build production,
 * nên bundle production không chứa code/dữ liệu mock.
 */
async function enableMocking(): Promise<void> {
  if (MOCK_BACKEND_BUNDLED && environment.useMock) {
    const { startMockServer } = await import('./mocks/browser');
    await startMockServer();
  } else if (environment.useMock) {
    throw new Error('environment.useMock = true nhưng cấu hình build này không kèm backend giả.');
  }
}

function showBootError(error: unknown): void {
  console.error(error);
  const root = document.querySelector('app-root');
  if (root) {
    root.innerHTML =
      '<div class="boot" role="alert"><span>Không khởi động được ứng dụng. ' +
      'Vui lòng tải lại trang hoặc xem Console để biết chi tiết.</span></div>';
  }
}

enableMocking()
  .then(() => bootstrapApplication(App, appConfig))
  .catch(showBootError);
