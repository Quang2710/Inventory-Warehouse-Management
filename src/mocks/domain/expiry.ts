import type { ExpiryStatus } from '../../app/core/api/schema';
import { daysBetween } from '../utils/date';

/** Ngưỡng mặc định "sắp hết hạn" (ngày). */
export const DEFAULT_EXPIRING_DAYS = 30;

/** Lô hết hạn khi ngày hết hạn trước ngày tham chiếu (ngày hết hạn vẫn còn dùng được). */
export function isExpired(expiryDate: string | null, asOf: string): boolean {
  return !!expiryDate && expiryDate < asOf;
}

/** Số ngày còn lại tới hạn (âm = đã hết hạn), `null` nếu không có hạn. */
export function daysToExpiry(expiryDate: string | null, asOf: string): number | null {
  return expiryDate ? daysBetween(asOf, expiryDate) : null;
}

export function expiryStatusOf(
  expiryDate: string | null,
  asOf: string,
  expiringDays = DEFAULT_EXPIRING_DAYS,
): ExpiryStatus {
  const days = daysToExpiry(expiryDate, asOf);
  if (days === null) return 'NO_EXPIRY';
  if (days < 0) return 'EXPIRED';
  return days <= expiringDays ? 'EXPIRING' : 'VALID';
}

/** Đọc tham số `days` (1–365), mặc định 30. */
export function parseExpiringDays(raw: string | null): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : DEFAULT_EXPIRING_DAYS;
}
