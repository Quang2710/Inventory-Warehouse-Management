import type { CurrentUser, RoleDefinition, User } from '../../app/core/api/schema';
import { ALL_PERMISSIONS, permissionsOf } from '../data/rbac';
import { db, type EntityOf, type UserEntity } from '../db';
import { opt, userRef } from './common';

export function toCurrentUser(user: UserEntity): CurrentUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    permissions: permissionsOf(user.role),
    warehouseIds: [...user.warehouseIds],
  };
}

export function toUser(user: UserEntity): User {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    phone: opt(user.phone),
    role: user.role,
    status: user.status,
    warehouseIds: [...user.warehouseIds],
    lastLoginAt: opt(user.lastLoginAt),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toRoleDefinition(definition: EntityOf<'roleDefinition'>): RoleDefinition {
  const isAdmin = definition.id === 'ADMIN';
  return {
    role: definition.id,
    permissions: isAdmin ? [...ALL_PERMISSIONS] : [...definition.permissions],
    editable: !isAdmin,
    userCount: db.user.getAll().filter((user) => user.role === definition.id).length,
    updatedAt: definition.updatedAt,
    updatedBy: userRef(definition.updatedById),
  };
}
