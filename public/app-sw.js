/* eslint-disable */
/**
 * Service worker của BẢN DEMO (build `production,demo`): một scope chỉ có một service worker,
 * nên gộp hai worker vào một:
 *  - MSW (mockServiceWorker.js) xử lý request `/api/**` → backend giả chạy trong trang;
 *  - ngsw (ngsw-worker.js, Angular) xử lý phần còn lại → cache app shell, chạy offline, cập nhật.
 *
 * Mỗi script tự đăng ký listener `fetch`; ta chặn `addEventListener('fetch')` lúc nạp để lấy
 * listener của từng bên rồi tự điều phối theo URL. Các sự kiện khác (install, activate, message…)
 * giữ nguyên: hai bên phân biệt message theo cấu trúc dữ liệu riêng (`type` vs `action`).
 *
 * Bản build thật KHÔNG chứa file này (angular.json → production → assets.ignore).
 */
(function () {
  const scope = self.registration ? self.registration.scope : self.location.origin + '/';
  const apiPrefix = new URL('api/', scope).pathname;
  const fetchListeners = { msw: [], ngsw: [] };
  const originalAddEventListener = self.addEventListener;
  let owner = null;

  self.addEventListener = function (type, listener, options) {
    if (type === 'fetch' && owner) {
      fetchListeners[owner].push(listener);
      return;
    }
    return originalAddEventListener.call(self, type, listener, options);
  };

  owner = 'msw';
  importScripts('./mockServiceWorker.js');
  owner = 'ngsw';
  importScripts('./ngsw-worker.js');
  owner = null;
  self.addEventListener = originalAddEventListener;

  originalAddEventListener.call(self, 'fetch', function (event) {
    const url = new URL(event.request.url);
    const isApi = url.origin === self.location.origin && url.pathname.startsWith(apiPrefix);
    for (const listener of isApi ? fetchListeners.msw : fetchListeners.ngsw) {
      listener.call(self, event);
    }
  });
})();
