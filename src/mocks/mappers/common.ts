import type { UserRef } from '../../app/core/api/schema';
import { findById } from '../db';

/** `null` trong db → bỏ trường (contract dùng trường tùy chọn thay vì null). */
export function opt<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

export function userRef(id: string | null | undefined): UserRef | undefined {
  const user = findById('user', id);
  return user ? { id: user.id, fullName: user.fullName } : undefined;
}

/** Như userRef nhưng luôn trả giá trị (người dùng đã xóa → tên giữ chỗ). */
export function requiredUserRef(id: string): UserRef {
  return userRef(id) ?? { id, fullName: 'Người dùng đã xóa' };
}

export function warehouseName(id: string): string {
  return findById('warehouse', id)?.name ?? '—';
}
