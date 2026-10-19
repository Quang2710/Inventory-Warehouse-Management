import { http, HttpResponse } from 'msw';

import type {
  GenerateRackRequest,
  LocationRequest,
  LocationStatus,
  LocationType,
  LocationUpdateRequest,
  WarehouseRequest,
  WarehouseStatus,
} from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { db, findById, type LocationEntity, type UserEntity, type WarehouseEntity } from '../db';
import { recordAudit } from '../domain/audit';
import { descendantIds, locationsOf, locationTotals } from '../domain/locations';
import { toLocations, toWarehouse, toWarehouseMap } from '../mappers/warehouse.mapper';
import { authorize } from '../utils/auth';
import { nowIso } from '../utils/date';
import { cleanText, errors, noContent, readJson, Validator } from '../utils/http';
import { matchesFilter, parseListQuery, toPage } from '../utils/query';
import { assertWarehouseAccess, canAccessWarehouse } from '../utils/scope';

const API = MOCK_CONFIG.apiUrl;
const WAREHOUSE_CODE = /^[A-Z0-9_-]{2,20}$/;
const LOCATION_CODE = /^[A-Z0-9-]{1,20}$/;
const PARENT_TYPE: Record<LocationType, LocationType | null> = {
  ZONE: null,
  RACK: 'ZONE',
  LEVEL: 'RACK',
  BIN: 'LEVEL',
};
const STATUSES: readonly WarehouseStatus[] = ['ACTIVE', 'INACTIVE'];

function requireWarehouse(id: string, user: UserEntity): WarehouseEntity {
  const warehouse = findById('warehouse', id);
  if (!warehouse) {
    throw errors.notFound('Không tìm thấy kho.');
  }
  assertWarehouseAccess(user, warehouse.id);
  return warehouse;
}

function requireLocation(id: string, user: UserEntity): LocationEntity {
  const location = findById('location', id);
  if (!location) {
    throw errors.notFound('Không tìm thấy vị trí.');
  }
  assertWarehouseAccess(user, location.warehouseId);
  return location;
}

function validateWarehouse(body: Partial<WarehouseRequest>, currentId: string | null): void {
  const validator = new Validator()
    .require('code', body.code, 'Vui lòng nhập mã kho.')
    .require('name', body.name, 'Vui lòng nhập tên kho.')
    .require('address', body.address, 'Vui lòng nhập địa chỉ.');
  if (body.code && !WAREHOUSE_CODE.test(body.code)) {
    validator.add('code', 'Mã kho gồm 2–20 ký tự in hoa, số, "-" hoặc "_".');
  }
  if (
    body.code &&
    db.warehouse.getAll().some((item) => item.code === body.code && item.id !== currentId)
  ) {
    validator.add('code', 'Mã kho đã tồn tại.');
  }
  if (!body.status || !STATUSES.includes(body.status)) {
    validator.add('status', 'Trạng thái không hợp lệ.');
  }
  validator.throwIfInvalid();
}

function warehouseSnapshot(warehouse: WarehouseEntity) {
  const { code, name, address, phone, managerName, status } = warehouse;
  return { code, name, address, phone, managerName, status };
}

function locationQuantity(location: LocationEntity): number {
  const totals = locationTotals(location.warehouseId);
  return totals.get(location.id)?.quantity ?? 0;
}

function codeTaken(warehouseId: string, code: string, exceptId?: string): boolean {
  return locationsOf(warehouseId).some(
    (location) => location.code === code && location.id !== exceptId,
  );
}

export const warehouseHandlers = [
  http.get(`${API}/warehouses`, ({ request }) => {
    const user = authorize(request, 'warehouse:read');
    const query = parseListQuery(new URL(request.url));
    const status = query.params.get('status');
    const all = query.params.get('scope') === 'all';
    const items = db.warehouse
      .getAll()
      .filter((warehouse) => all || canAccessWarehouse(user, warehouse.id))
      .filter((warehouse) => matchesFilter(warehouse.status, status))
      .map(toWarehouse);
    return HttpResponse.json(
      toPage(items, query, {
        sortable: ['code', 'name', 'status', 'skuCount', 'totalQuantity', 'totalValue', 'binCount'],
        defaultSort: 'code,asc',
        searchIn: (warehouse) => [
          warehouse.code,
          warehouse.name,
          warehouse.address,
          warehouse.managerName,
        ],
      }),
    );
  }),

  http.post(`${API}/warehouses`, async ({ request }) => {
    const user = authorize(request, 'warehouse:write');
    if (user.warehouseIds.length > 0) {
      throw errors.forbidden('Chỉ người dùng được phân quyền mọi kho mới tạo được kho mới.');
    }
    const body = await readJson<WarehouseRequest>(request);
    validateWarehouse(body, null);
    const now = nowIso();
    const warehouse = db.warehouse.create({
      code: body.code!,
      name: body.name!.trim(),
      address: body.address!.trim(),
      phone: cleanText(body.phone),
      managerName: cleanText(body.managerName),
      status: body.status!,
      createdAt: now,
      updatedAt: now,
    });
    recordAudit({
      actor: user,
      action: 'CREATE',
      entityType: 'WAREHOUSE',
      entityId: warehouse.id,
      entityLabel: warehouse.code,
      summary: `Tạo kho ${warehouse.name}`,
      after: warehouseSnapshot(warehouse),
    });
    return HttpResponse.json(toWarehouse(warehouse), { status: 201 });
  }),

  http.get(`${API}/warehouses/:id`, ({ request, params }) => {
    const user = authorize(request, 'warehouse:read');
    return HttpResponse.json(toWarehouse(requireWarehouse(String(params['id']), user)));
  }),

  http.put(`${API}/warehouses/:id`, async ({ request, params }) => {
    const user = authorize(request, 'warehouse:write');
    const warehouse = requireWarehouse(String(params['id']), user);
    const body = await readJson<WarehouseRequest>(request);
    validateWarehouse(body, warehouse.id);
    if (body.status === 'INACTIVE' && toWarehouse(warehouse).totalQuantity > 0) {
      throw errors.conflict('Kho còn tồn hàng — không thể ngừng hoạt động.');
    }
    const updated = db.warehouse.update({
      where: { id: { equals: warehouse.id } },
      data: {
        code: body.code!,
        name: body.name!.trim(),
        address: body.address!.trim(),
        phone: cleanText(body.phone),
        managerName: cleanText(body.managerName),
        status: body.status!,
        updatedAt: nowIso(),
      },
    })!;
    recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'WAREHOUSE',
      entityId: updated.id,
      entityLabel: updated.code,
      summary: `Cập nhật kho ${updated.name}`,
      before: warehouseSnapshot(warehouse),
      after: warehouseSnapshot(updated),
    });
    return HttpResponse.json(toWarehouse(updated));
  }),

  http.delete(`${API}/warehouses/:id`, ({ request, params }) => {
    const user = authorize(request, 'warehouse:write');
    const warehouse = requireWarehouse(String(params['id']), user);
    const hasDocuments =
      db.stockMovement.getAll().some((movement) => movement.warehouseId === warehouse.id) ||
      db.goodsReceipt.getAll().some((receipt) => receipt.warehouseId === warehouse.id) ||
      db.goodsIssue.getAll().some((issue) => issue.warehouseId === warehouse.id) ||
      db.transfer
        .getAll()
        .some(
          (transfer) =>
            transfer.fromWarehouseId === warehouse.id || transfer.toWarehouseId === warehouse.id,
        );
    if (hasDocuments) {
      throw errors.conflict('Kho đã phát sinh chứng từ — chỉ có thể chuyển sang Ngừng hoạt động.');
    }
    for (const location of locationsOf(warehouse.id)) {
      db.location.delete({ where: { id: { equals: location.id } } });
    }
    db.warehouse.delete({ where: { id: { equals: warehouse.id } } });
    recordAudit({
      actor: user,
      action: 'DELETE',
      entityType: 'WAREHOUSE',
      entityId: warehouse.id,
      entityLabel: warehouse.code,
      summary: `Xóa kho ${warehouse.name}`,
      before: warehouseSnapshot(warehouse),
    });
    return noContent();
  }),

  // ── Vị trí ──

  http.get(`${API}/warehouses/:id/locations`, ({ request, params }) => {
    const user = authorize(request, 'warehouse:read');
    const warehouse = requireWarehouse(String(params['id']), user);
    const type = new URL(request.url).searchParams.get('type') as LocationType | null;
    const all = toLocations(warehouse.id);
    return HttpResponse.json(type ? all.filter((location) => location.type === type) : all);
  }),

  http.post(`${API}/warehouses/:id/locations`, async ({ request, params }) => {
    const user = authorize(request, 'warehouse:write');
    const warehouse = requireWarehouse(String(params['id']), user);
    const body = await readJson<LocationRequest>(request);
    const validator = new Validator()
      .require('type', body.type, 'Vui lòng chọn cấp vị trí.')
      .require('code', body.code, 'Vui lòng nhập mã vị trí.')
      .require('name', body.name, 'Vui lòng nhập tên vị trí.');
    if (body.type && !(body.type in PARENT_TYPE)) {
      validator.add('type', 'Cấp vị trí không hợp lệ.');
    }
    if (body.code && !LOCATION_CODE.test(body.code)) {
      validator.add('code', 'Mã gồm 1–20 ký tự in hoa, số hoặc "-".');
    } else if (body.code && codeTaken(warehouse.id, body.code)) {
      validator.add('code', 'Mã vị trí đã tồn tại trong kho.');
    }
    const parent = body.parentId ? findById('location', body.parentId) : null;
    const expectedParent = body.type ? PARENT_TYPE[body.type] : null;
    if (
      expectedParent &&
      (!parent || parent.warehouseId !== warehouse.id || parent.type !== expectedParent)
    ) {
      validator.add('parentId', 'Vị trí cha không hợp lệ (khu › kệ › tầng › ô).');
    }
    if (!expectedParent && body.parentId) {
      validator.add('parentId', 'Khu là cấp cao nhất, không có vị trí cha.');
    }
    if (body.type === 'BIN' && !(typeof body.capacity === 'number' && body.capacity >= 1)) {
      validator.add('capacity', 'Ô lưu trữ cần sức chứa ≥ 1.');
    }
    validator.throwIfInvalid();

    const now = nowIso();
    const siblings = locationsOf(warehouse.id).filter(
      (location) => location.parentId === (parent?.id ?? null),
    );
    const location = db.location.create({
      warehouseId: warehouse.id,
      parentId: parent?.id ?? null,
      type: body.type!,
      code: body.code!,
      name: body.name!.trim(),
      capacity: body.type === 'BIN' ? (body.capacity ?? null) : null,
      status: 'ACTIVE',
      sortOrder: body.sortOrder ?? siblings.length + 1,
      createdAt: now,
      updatedAt: now,
    });
    recordAudit({
      actor: user,
      action: 'CREATE',
      entityType: 'LOCATION',
      entityId: location.id,
      entityLabel: `${warehouse.code}/${location.code}`,
      summary: `Tạo vị trí ${location.code} (${location.name}) tại ${warehouse.name}`,
    });
    return HttpResponse.json(
      toLocations(warehouse.id).find((item) => item.id === location.id)!,
      { status: 201 },
    );
  }),

  http.post(`${API}/warehouses/:id/locations/generate`, async ({ request, params }) => {
    const user = authorize(request, 'warehouse:write');
    const warehouse = requireWarehouse(String(params['id']), user);
    const body = await readJson<GenerateRackRequest>(request);
    const zone = body.zoneId ? findById('location', body.zoneId) : null;
    const validator = new Validator()
      .check(
        !!zone && zone.warehouseId === warehouse.id && zone.type === 'ZONE',
        'zoneId',
        'Vui lòng chọn khu hợp lệ.',
      )
      .check(
        typeof body.rackCode === 'string' && /^[A-Z0-9-]{1,12}$/.test(body.rackCode),
        'rackCode',
        'Mã kệ gồm 1–12 ký tự in hoa, số hoặc "-".',
      )
      .check(
        Number.isInteger(body.levels) && body.levels! >= 1 && body.levels! <= 10,
        'levels',
        'Số tầng từ 1 đến 10.',
      )
      .check(
        Number.isInteger(body.binsPerLevel) && body.binsPerLevel! >= 1 && body.binsPerLevel! <= 20,
        'binsPerLevel',
        'Số ô mỗi tầng từ 1 đến 20.',
      )
      .check(
        Number.isInteger(body.binCapacity) && body.binCapacity! >= 1,
        'binCapacity',
        'Sức chứa mỗi ô ≥ 1.',
      );
    if (body.rackCode && codeTaken(warehouse.id, body.rackCode)) {
      validator.add('rackCode', 'Mã kệ đã tồn tại trong kho.');
    }
    validator.throwIfInvalid();

    const now = nowIso();
    const rackCode = body.rackCode!;
    const createdIds: string[] = [];
    const rackSiblings = locationsOf(warehouse.id).filter(
      (location) => location.parentId === zone!.id,
    );
    const rack = db.location.create({
      warehouseId: warehouse.id,
      parentId: zone!.id,
      type: 'RACK',
      code: rackCode,
      name: cleanText(body.rackName) ?? `Kệ ${rackCode}`,
      capacity: null,
      status: 'ACTIVE',
      sortOrder: rackSiblings.length + 1,
      createdAt: now,
      updatedAt: now,
    });
    createdIds.push(rack.id);
    for (let levelNo = 1; levelNo <= body.levels!; levelNo++) {
      const level = db.location.create({
        warehouseId: warehouse.id,
        parentId: rack.id,
        type: 'LEVEL',
        code: `${rackCode}-${levelNo}`,
        name: `Tầng ${levelNo}`,
        capacity: null,
        status: 'ACTIVE',
        sortOrder: levelNo,
        createdAt: now,
        updatedAt: now,
      });
      createdIds.push(level.id);
      for (let binNo = 1; binNo <= body.binsPerLevel!; binNo++) {
        const suffix = String(binNo).padStart(2, '0');
        const bin = db.location.create({
          warehouseId: warehouse.id,
          parentId: level.id,
          type: 'BIN',
          code: `${rackCode}-${levelNo}-${suffix}`,
          name: `Ô ${suffix}`,
          capacity: body.binCapacity!,
          status: 'ACTIVE',
          sortOrder: binNo,
          createdAt: now,
          updatedAt: now,
        });
        createdIds.push(bin.id);
      }
    }
    recordAudit({
      actor: user,
      action: 'CREATE',
      entityType: 'LOCATION',
      entityId: rack.id,
      entityLabel: `${warehouse.code}/${rackCode}`,
      summary: `Tạo kệ ${rackCode}: ${body.levels} tầng × ${body.binsPerLevel} ô tại ${zone!.name}`,
    });
    const ids = new Set(createdIds);
    return HttpResponse.json(
      toLocations(warehouse.id).filter((location) => ids.has(location.id)),
      { status: 201 },
    );
  }),

  http.get(`${API}/warehouses/:id/map`, ({ request, params }) => {
    const user = authorize(request, 'warehouse:read');
    return HttpResponse.json(toWarehouseMap(requireWarehouse(String(params['id']), user)));
  }),

  http.put(`${API}/locations/:id`, async ({ request, params }) => {
    const user = authorize(request, 'warehouse:write');
    const location = requireLocation(String(params['id']), user);
    const body = await readJson<LocationUpdateRequest>(request);
    const statuses: readonly LocationStatus[] = ['ACTIVE', 'INACTIVE'];
    const validator = new Validator()
      .require('name', body.name, 'Vui lòng nhập tên vị trí.')
      .check(!!body.status && statuses.includes(body.status), 'status', 'Trạng thái không hợp lệ.');
    if (
      location.type === 'BIN' &&
      body.capacity !== undefined &&
      !(Number.isInteger(body.capacity) && body.capacity >= 1)
    ) {
      validator.add('capacity', 'Sức chứa phải ≥ 1.');
    }
    validator.throwIfInvalid();
    if (
      body.status === 'INACTIVE' &&
      location.status === 'ACTIVE' &&
      locationQuantity(location) > 0
    ) {
      throw errors.conflict('Vị trí còn hàng — hãy chuyển hết hàng trước khi ngừng sử dụng.');
    }
    const updated = db.location.update({
      where: { id: { equals: location.id } },
      data: {
        name: body.name!.trim(),
        capacity: location.type === 'BIN' ? (body.capacity ?? location.capacity) : null,
        status: body.status!,
        sortOrder: body.sortOrder ?? location.sortOrder,
        updatedAt: nowIso(),
      },
    })!;
    recordAudit({
      actor: user,
      action: 'UPDATE',
      entityType: 'LOCATION',
      entityId: updated.id,
      entityLabel: updated.code,
      summary: `Cập nhật vị trí ${updated.code}`,
      before: { name: location.name, capacity: location.capacity, status: location.status },
      after: { name: updated.name, capacity: updated.capacity, status: updated.status },
    });
    return HttpResponse.json(
      toLocations(updated.warehouseId).find((item) => item.id === updated.id)!,
    );
  }),

  http.delete(`${API}/locations/:id`, ({ request, params }) => {
    const user = authorize(request, 'warehouse:write');
    const location = requireLocation(String(params['id']), user);
    const all = locationsOf(location.warehouseId);
    if (all.some((item) => item.parentId === location.id)) {
      throw errors.conflict('Vị trí còn vị trí con — hãy xóa vị trí con trước.');
    }
    const ids = descendantIds(location.id, all);
    if (db.binStock.getAll().some((bin) => ids.has(bin.locationId) && bin.quantity > 0)) {
      throw errors.conflict('Vị trí còn hàng — không thể xóa.');
    }
    if (db.stockMovement.getAll().some((movement) => movement.locationId === location.id)) {
      throw errors.conflict('Vị trí đã phát sinh biến động tồn — chỉ có thể ngừng sử dụng.');
    }
    db.location.delete({ where: { id: { equals: location.id } } });
    recordAudit({
      actor: user,
      action: 'DELETE',
      entityType: 'LOCATION',
      entityId: location.id,
      entityLabel: location.code,
      summary: `Xóa vị trí ${location.code} (${location.name})`,
    });
    return noContent();
  }),
];
