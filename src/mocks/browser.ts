import { setupWorker } from 'msw/browser';

import { environment } from '../environments/environment';
import { handlers } from './handlers';
import { initDatabase, persistNow, schedulePersist, watchOtherTabs } from './persistence';

/**
 * Khởi động backend giả. CHỈ được gọi từ `src/main.ts` khi `environment.useMock === true`
 * (nạp bằng dynamic import nên không lọt vào bundle khi tắt mock).
 */
export async function startMockServer(): Promise<void> {
  await initDatabase();
  watchOtherTabs();

  const worker = setupWorker(...handlers);
  worker.events.on('response:mocked', ({ request }) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      schedulePersist();
    }
  });
  addEventListener('pagehide', () => void persistNow());

  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: environment.production,
    serviceWorker: {
      // Bản demo có PWA: MSW chạy trong service worker gộp (app-sw.js = MSW + ngsw).
      url: new URL(
        environment.serviceWorker.enabled
          ? environment.serviceWorker.script
          : 'mockServiceWorker.js',
        document.baseURI,
      ).pathname,
    },
  });
}
