import { http, HttpResponse } from 'msw';

import type {
  AuditChange,
  Permission,
  ResetPasswordRequest,
  Role,
  RolePermissionsRequest,
  UserCreateRequest,
  UserStatus,
  UserUpdateRequest,
} from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { ALL_PERMISSIONS, ROLES } from '../data/rbac';
import { db, findById, type UserEntity } from '../db';
import { recordAudit } from '../domain/audit';
import { toRoleDefinition, toUser } from '../mappers/user.mapper';
import { authorize, revokeAllSessions } from '../utils/auth';
import { nowIso } from '../utils/date';
import { hashPassword } from '../utils/hash';
import { cleanText, EMAIL_PATTERN, errors, noContent, readJson, Validator } from '../utils/http';
import { matchesFilter, parseListQuery, toPage } from '../utils/query';

const API = MOCK_CONFIG.apiUrl;
const USERNAME = /^[a-z0-9._-]{3,32}$/;
const STATUSES: readonly UserStatus[] = ['ACTIVE', 'LOCKED'];

function requireUser(id: string): UserEntity {
  const user = findById('user', id);
  if (!user) throw errors.notFound('Không tìm thấy người dùng.');
  return user;
}

function validateProfile(body: Partial<UserUpdateRequest>, validator: Validator): void {
  validator
    .require('fullName', body.fullName, 'Vui lòng nhập họ tên.')
    .require('email', body.email, 'Vui lòng nhập email.')
    .check(!!body.role && ROLES.includes(body.role), 'role', 'Vui lòng chọn vai trò.');
  if (body.email && !EMAIL_PATTERN.test(body.email)) validator.add('email', 'Email không hợp lệ.');
  const warehouseIds = body.warehouseIds ?? [];
  if (!Array.isArray(warehouseIds) || warehouseIds.some((id) => !findById('warehouse', id))) {
    validator.add('warehouseIds', 'Danh sách kho không hợp lệ.');
  }
}

function userSnapshot(user: UserEntity) {
  const warehouses = user.warehouseIds.map((id) => findById('warehouse', id)?.code ?? id);
  return {
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    warehouses: warehouses.length ? warehouses : ['Mọi kho'],
  };
}

export const userHandlers = [
  http.get(`${API}/users`, ({ request }) => {
    authorize(request, 'user:read');
    const query = parseListQuery(new URL(request.url));
    const role = query.params.get('role');
    const status = query.params.get('status');
    const items = db.user
      .getAll()
      .filter((user) => matchesFilter(user.role, role))
      .filter((user) => matchesFilter(user.status, status))
      .map(toUser);
    return HttpResponse.json(
      toPage(items, query, {
        sortable: ['username', 'fullName', 'role', 'status', 'lastLoginAt', 'createdAt'],
        defaultSort: 'username,asc',
        searchIn: (user) => [user.username, user.fullName, user.email, user.phone],
      }),
    );
  }),

  http.post(`${API}/users`, async ({ request }) => {
    const actor = authorize(request, 'user:write');
    const body = await readJson<UserCreateRequest>(request);
    const validator = new Validator().require(
      'username',
      body.username,
      'Vui lòng nhập tên đăng nhập.',
    );
    if (body.username && !USERNAME.test(body.username)) {
      validator.add('username', 'Tên đăng nhập 3–32 ký tự: chữ thường, số, ".", "_" hoặc "-".');
    } else if (body.username && db.user.getAll().some((user) => user.username === body.username)) {
      validator.add('username', 'Tên đăng nhập đã tồn tại.');
    }
    if (!body.password || body.password.length < 8)
      validator.add('password', 'Mật khẩu tối thiểu 8 ký tự.');
    validateProfile(body, validator);
    validator.throwIfInvalid();
    const now = nowIso();
    const user = db.user.create({
      username: body.username!,
      passwordHash: hashPassword(body.username!, body.password!),
      fullName: body.fullName!.trim(),
      email: body.email!.trim(),
      phone: cleanText(body.phone),
      role: body.role!,
      status: 'ACTIVE',
      warehouseIds: [...new Set(body.warehouseIds ?? [])],
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    recordAudit({
      actor,
      action: 'CREATE',
      entityType: 'USER',
      entityId: user.id,
      entityLabel: user.username,
      summary: `Tạo người dùng ${user.fullName}`,
      after: userSnapshot(user),
    });
    return HttpResponse.json(toUser(user), { status: 201 });
  }),

  http.get(`${API}/users/:id`, ({ request, params }) => {
    authorize(request, 'user:read');
    return HttpResponse.json(toUser(requireUser(String(params['id']))));
  }),

  http.put(`${API}/users/:id`, async ({ request, params }) => {
    const actor = authorize(request, 'user:write');
    const user = requireUser(String(params['id']));
    const body = await readJson<UserUpdateRequest>(request);
    const validator = new Validator().check(
      !!body.status && STATUSES.includes(body.status),
      'status',
      'Trạng thái không hợp lệ.',
    );
    validateProfile(body, validator);
    validator.throwIfInvalid();
    if (user.id === actor.id && (body.status !== 'ACTIVE' || body.role !== user.role)) {
      throw errors.conflict('Không thể tự khóa tài khoản hoặc đổi vai trò của chính mình.');
    }
    const updated = db.user.update({
      where: { id: { equals: user.id } },
      data: {
        fullName: body.fullName!.trim(),
        email: body.email!.trim(),
        phone: cleanText(body.phone),
        role: body.role!,
        status: body.status!,
        warehouseIds: [...new Set(body.warehouseIds ?? [])],
        updatedAt: nowIso(),
      },
    })!;
    if (updated.status === 'LOCKED' && user.status !== 'LOCKED') {
      revokeAllSessions(updated.id);
    }
    recordAudit({
      actor,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: updated.id,
      entityLabel: updated.username,
      summary: `Cập nhật người dùng ${updated.fullName}`,
      before: userSnapshot(user),
      after: userSnapshot(updated),
    });
    return HttpResponse.json(toUser(updated));
  }),

  http.delete(`${API}/users/:id`, ({ request, params }) => {
    const actor = authorize(request, 'user:write');
    const user = requireUser(String(params['id']));
    if (user.id === actor.id) {
      throw errors.conflict('Không thể xóa tài khoản đang đăng nhập.');
    }
    const hasData =
      db.goodsReceipt.getAll().some((doc) => doc.createdById === user.id) ||
      db.goodsIssue.getAll().some((doc) => doc.createdById === user.id) ||
      db.transfer.getAll().some((doc) => doc.createdById === user.id) ||
      db.stockMovement.getAll().some((movement) => movement.createdById === user.id);
    if (hasData) {
      throw errors.conflict('Người dùng đã phát sinh chứng từ — hãy khóa tài khoản thay vì xóa.');
    }
    revokeAllSessions(user.id);
    for (const session of db.session.getAll().filter((item) => item.user?.id === user.id)) {
      db.session.delete({ where: { id: { equals: session.id } } });
    }
    db.user.delete({ where: { id: { equals: user.id } } });
    recordAudit({
      actor,
      action: 'DELETE',
      entityType: 'USER',
      entityId: user.id,
      entityLabel: user.username,
      summary: `Xóa người dùng ${user.fullName}`,
      before: userSnapshot(user),
    });
    return noContent();
  }),

  http.post(`${API}/users/:id/reset-password`, async ({ request, params }) => {
    const actor = authorize(request, 'user:write');
    const user = requireUser(String(params['id']));
    const body = await readJson<ResetPasswordRequest>(request);
    if (!body.newPassword || body.newPassword.length < 8) {
      throw errors.validation({ newPassword: ['Mật khẩu tối thiểu 8 ký tự.'] });
    }
    db.user.update({
      where: { id: { equals: user.id } },
      data: { passwordHash: hashPassword(user.username, body.newPassword), updatedAt: nowIso() },
    });
    revokeAllSessions(user.id);
    recordAudit({
      actor,
      action: 'PASSWORD_RESET',
      entityType: 'USER',
      entityId: user.id,
      entityLabel: user.username,
      summary: `Đặt lại mật khẩu cho ${user.fullName} (thu hồi mọi phiên đăng nhập)`,
    });
    return noContent();
  }),

  // ── Vai trò & ma trận quyền ──
  http.get(`${API}/roles`, ({ request }) => {
    authorize(request, 'role:read');
    return HttpResponse.json(
      ROLES.map((role) => findById('roleDefinition', role))
        .filter((definition) => definition !== null)
        .map(toRoleDefinition),
    );
  }),

  http.put(`${API}/roles/:role/permissions`, async ({ request, params }) => {
    const actor = authorize(request, 'role:write');
    const role = String(params['role']) as Role;
    const definition = ROLES.includes(role) ? findById('roleDefinition', role) : null;
    if (!definition) {
      throw errors.notFound('Không tìm thấy vai trò.');
    }
    if (role === 'ADMIN') {
      throw errors.conflict('Vai trò Quản trị viên luôn có toàn quyền, không thể chỉnh sửa.');
    }
    const body = await readJson<RolePermissionsRequest>(request);
    const requested = Array.isArray(body.permissions) ? body.permissions : null;
    const valid = new Set<string>(ALL_PERMISSIONS);
    if (!requested || requested.some((permission) => !valid.has(permission))) {
      throw errors.validation({ permissions: ['Danh sách quyền không hợp lệ.'] });
    }
    const next = ALL_PERMISSIONS.filter((permission) =>
      requested.includes(permission),
    ) as Permission[];
    const previous = definition.permissions;
    const updated = db.roleDefinition.update({
      where: { id: { equals: role } },
      data: { permissions: next, updatedAt: nowIso(), updatedById: actor.id },
    })!;
    const added = next.filter((permission) => !previous.includes(permission));
    const removed = previous.filter((permission) => !next.includes(permission));
    const changes: AuditChange[] = [];
    if (added.length)
      changes.push({ field: 'permissions.added', from: null, to: added.join(', ') });
    if (removed.length)
      changes.push({ field: 'permissions.removed', from: removed.join(', '), to: null });
    recordAudit({
      actor,
      action: 'PERMISSION_CHANGE',
      entityType: 'ROLE',
      entityId: role,
      entityLabel: role,
      summary: `Cập nhật quyền vai trò ${role}: +${added.length} / −${removed.length}`,
      changes,
    });
    return HttpResponse.json(toRoleDefinition(updated));
  }),
];
