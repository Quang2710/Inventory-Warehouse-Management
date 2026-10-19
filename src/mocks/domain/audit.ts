import type { AuditAction, AuditChange, AuditEntityType } from '../../app/core/api/schema';
import { db, type AuditLogEntity, type UserEntity } from '../db';

/** Trường kỹ thuật không đưa vào diff. */
const IGNORED_FIELDS = new Set(['id', 'updatedAt', 'createdAt', 'passwordHash']);

export interface AuditInput {
  actor: Pick<UserEntity, 'id' | 'fullName'> | null;
  /** Tên hiển thị khi không có actor (vd đăng nhập sai tên). */
  actorName?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  before?: object | null;
  after?: object | null;
  /** Diff bổ sung đã tính sẵn (vd thay đổi quyền). */
  changes?: AuditChange[];
  occurredAt?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function stringify(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(String).join(', ') : null;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/** So sánh hai trạng thái phẳng, trả các trường thay đổi. */
export function diff(
  before: object | null | undefined,
  after: object | null | undefined,
): AuditChange[] {
  const left = (before ?? {}) as Record<string, unknown>;
  const right = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changes: AuditChange[] = [];
  for (const field of keys) {
    if (IGNORED_FIELDS.has(field)) continue;
    const from = stringify(left[field]);
    const to = stringify(right[field]);
    if (from !== to) {
      changes.push({ field, from, to });
    }
  }
  return changes;
}

function clientInfo(): { ipAddress: string; userAgent: string | null } {
  return {
    ipAddress: '127.0.0.1',
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
  };
}

/** Ghi một bản ghi nhật ký. Mọi handler ghi dữ liệu đều gọi hàm này. */
export function recordAudit(input: AuditInput): AuditLogEntity {
  const changes = [...(input.changes ?? []), ...diff(input.before, input.after)];
  const client = input.ipAddress === undefined ? clientInfo() : null;
  return db.auditLog.create({
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    userId: input.actor?.id ?? null,
    userName: input.actor?.fullName ?? input.actorName ?? 'Hệ thống',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityLabel: input.entityLabel ?? null,
    summary: input.summary,
    changes: JSON.stringify(changes),
    ipAddress: input.ipAddress ?? client?.ipAddress ?? null,
    userAgent: input.userAgent ?? client?.userAgent ?? null,
  });
}
