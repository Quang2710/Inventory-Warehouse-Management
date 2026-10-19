import { delay, http, HttpResponse } from 'msw';

import { MOCK_CONFIG } from '../config';
import { errors } from '../utils/http';

const API = MOCK_CONFIG.apiUrl;

/** Không gây lỗi ngẫu nhiên cho các endpoint mà demo cần luôn chạy được. */
const CHAOS_EXEMPT = [/\/auth\//, /\/__demo\//];

function randomDelay(): number {
  const min = Math.min(MOCK_CONFIG.delayMin, MOCK_CONFIG.delayMax);
  const max = Math.max(MOCK_CONFIG.delayMin, MOCK_CONFIG.delayMax);
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Chạy TRƯỚC mọi handler nghiệp vụ: giả lập độ trễ mạng 200–600ms và lỗi 500 ngẫu nhiên ~2%.
 * Trả về `undefined` để MSW chuyển tiếp request sang handler kế tiếp.
 */
export const latencyAndChaosHandler = http.all(`${API}/*`, async ({ request }) => {
  // Giả lập mất mạng: backend giả chạy ngay trong trình duyệt nên vẫn "trả lời" được khi offline —
  // chủ động trả lỗi mạng để luồng offline của ứng dụng (hàng đợi đồng bộ) hoạt động như thật.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return HttpResponse.error();
  }
  await delay(randomDelay());
  const path = new URL(request.url).pathname;
  const exempt = CHAOS_EXEMPT.some((pattern) => pattern.test(path));
  if (!exempt && Math.random() < MOCK_CONFIG.errorRate) {
    return errors.internal('Lỗi máy chủ ngẫu nhiên (giả lập). Vui lòng thử lại.');
  }
  return undefined;
});

/** Chạy SAU CÙNG: API chưa được mock trả 404 thay vì rơi xuống dev server (trả index.html). */
export const notImplementedHandler = http.all(`${API}/*`, ({ request }) =>
  errors.notFound(`API chưa được hỗ trợ: ${request.method} ${new URL(request.url).pathname}`),
);
