import { environment } from '../environments/environment';

function readNumber(key: string, fallback: number): number {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined || raw.trim() === '') {
      return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Cấu hình backend giả (MSW).
 *
 * Có thể ghi đè khi debug / chạy e2e bằng localStorage rồi tải lại trang:
 * - `iwm.mock.errorRate`      tỉ lệ lỗi 500 ngẫu nhiên (mặc định 0.02, đặt `0` để tắt)
 * - `iwm.mock.delayMin`       độ trễ tối thiểu (ms, mặc định 200)
 * - `iwm.mock.delayMax`       độ trễ tối đa (ms, mặc định 600)
 * - `iwm.mock.accessTokenTtl` thời hạn access token (giây, mặc định 900) — đặt nhỏ để thử tự refresh
 */
export const MOCK_CONFIG = {
  apiUrl: environment.apiUrl,
  delayMin: Math.max(0, readNumber('iwm.mock.delayMin', 200)),
  delayMax: Math.max(0, readNumber('iwm.mock.delayMax', 600)),
  errorRate: Math.min(1, Math.max(0, readNumber('iwm.mock.errorRate', 0.02))),
  accessTokenTtlSec: Math.max(5, readNumber('iwm.mock.accessTokenTtl', 15 * 60)),
  refreshTokenTtlSec: 7 * 24 * 60 * 60,
  /** Seed cố định cho faker: cùng seed → cùng bộ dữ liệu, giúp tái hiện lỗi. */
  seed: 20261018,
  /** Số ngày lịch sử chứng từ được sinh (tính lùi từ hôm nay). */
  seedHistoryDays: 120,
  /** Tăng khi đổi cấu trúc db/seed để snapshot cũ trong IndexedDB bị bỏ qua. */
  snapshotVersion: 3,
  indexedDbName: 'iwm-mock-db',
} as const;
