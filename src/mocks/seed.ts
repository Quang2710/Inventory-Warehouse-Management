import { fakerVI as faker } from '@faker-js/faker';

import type {
  AuditAction,
  AuditEntityType,
  CustomerType,
  DocumentStatus,
  IssueReason,
  Role,
} from '../app/core/api/schema';
import { MOCK_CONFIG } from './config';
import {
  CANCEL_REASONS,
  CATEGORY_TREE,
  ISSUE_RECEIVERS_INTERNAL,
  PAYMENT_TERMS,
  REJECT_REASONS,
  TRANSFER_NOTES,
  WAREHOUSE_SEEDS,
  ZONE_BIN_CAPACITY,
  type LeafCategorySeed,
} from './data/catalog';
import { DEMO_ACCOUNTS } from './data/demo-accounts';
import { DEFAULT_ROLE_PERMISSIONS, ROLES } from './data/rbac';
import {
  db,
  findById,
  type CategoryEntity,
  type CustomerEntity,
  type LocationEntity,
  type ProductEntity,
  type SupplierEntity,
  type UserEntity,
  type WarehouseEntity,
} from './db';
import { sellableQuantity } from './domain/allocation';
import { isExpired } from './domain/expiry';
import { recordAudit } from './domain/audit';
import { nextDocumentCode } from './domain/document-code';
import { availableQuantity, InsufficientStockError, lotsOf, SerialError } from './domain/inventory';
import { approveIssue, cancelIssue } from './domain/issues';
import { approveReceipt, cancelReceipt } from './domain/receipts';
import { approveStocktake, openStocktake, recordCount, stocktakeLines } from './domain/stocktakes';
import { cancelTransfer, receiveTransfer, shipTransfer, transferLines } from './domain/transfers';
import { addDays, addMinutes, atLocalTime, toLocalDate } from './utils/date';
import { hashPassword } from './utils/hash';
import { toUsername } from './utils/text';

/**
 * Sinh dữ liệu demo tái lập được (faker.seed cố định):
 * 12 người dùng (4 tài khoản demo), 3 kho với ~400 ô lưu trữ, 200 sản phẩm, nhà cung cấp,
 * khách hàng, vài trăm phiếu nhập/xuất, phiếu chuyển kho, phiên kiểm kê và nhật ký thao tác
 * trong `seedHistoryDays` ngày gần nhất.
 *
 * Mọi sự kiện trong ngày được xếp theo thời gian rồi xử lý qua đúng nghiệp vụ mà handler dùng
 * (`approveReceipt`, `approveIssue`, `shipTransfer`, `approveStocktake`…), nên tồn kho (theo kho,
 * ô, lô và serial) luôn khớp tổng movement, không bao giờ âm và số dư trên thẻ kho đúng thứ tự
 * thời gian. Xuất kho/chuyển kho theo FEFO; ~15% lô nhập có hạn ngắn để có hàng cận date/hết hạn.
 */
export interface SeedSummary {
  users: number;
  categories: number;
  products: number;
  warehouses: number;
  locations: number;
  suppliers: number;
  customers: number;
  goodsReceipts: number;
  goodsIssues: number;
  transfers: number;
  stocktakes: number;
  stockMovements: number;
  auditLogs: number;
  durationMs: number;
}

/** Mật khẩu chung của các người dùng sinh thêm (ngoài 4 tài khoản demo). */
export const SEEDED_USER_PASSWORD = 'Matkhau@123';

const SEED_CLIENTS = [
  { ipAddress: '10.20.1.15', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0' },
  {
    ipAddress: '10.20.1.32',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/18.0',
  },
  {
    ipAddress: '10.20.3.7',
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-A556E) Chrome/141.0 Mobile',
  },
  { ipAddress: '10.20.4.21', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6) Safari/604.1' },
] as const;

interface SeedUsers {
  all: UserEntity[];
  admin: UserEntity;
  manager: UserEntity;
  staff: UserEntity;
  accountant: UserEntity;
}

interface PlannedReceiptLine {
  product: ProductEntity;
  quantity: number;
  unitCost: number;
  lotNumber: string | null;
  expiryDate: string | null;
  serialNumbers: string[];
}

interface PlannedIssueLine {
  product: ProductEntity;
  quantity: number;
  unitPrice: number;
}

interface DayEvent {
  at: Date;
  run: () => void;
}

interface SeededDocument {
  id: string;
  code: string;
  status: DocumentStatus;
}

const roundTo = (value: number, step: number): number =>
  Math.max(step, Math.round(value / step) * step);

const iso = (date: Date): string => date.toISOString();

function ean13(prefix12: string): string {
  const digits = prefix12.split('').map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${prefix12}${(10 - (sum % 10)) % 10}`;
}

/** Số lượng giao dịch điển hình theo giá trị hàng. */
function typicalQuantity(costPrice: number): readonly [number, number] {
  if (costPrice < 20_000) return [30, 200];
  if (costPrice < 100_000) return [10, 80];
  if (costPrice < 500_000) return [5, 30];
  return [2, 12];
}

function seedAudit(
  actor: UserEntity | null,
  action: AuditAction,
  entityType: AuditEntityType,
  entity: { id: string; label: string } | null,
  summary: string,
  at: Date,
): void {
  const client = faker.helpers.arrayElement(SEED_CLIENTS);
  recordAudit({
    actor,
    action,
    entityType,
    entityId: entity?.id ?? null,
    entityLabel: entity?.label ?? null,
    summary,
    occurredAt: iso(at),
    ipAddress: client.ipAddress,
    userAgent: client.userAgent,
  });
}

// ───────────────────────────── Dữ liệu danh mục ─────────────────────────────

function seedUsers(createdAt: string): UserEntity[] {
  const demo = DEMO_ACCOUNTS.map((account) =>
    db.user.create({
      id: faker.string.uuid(),
      username: account.username,
      passwordHash: hashPassword(account.username, account.password),
      fullName: account.fullName,
      email: account.email,
      phone: account.phone,
      role: account.role,
      status: 'ACTIVE',
      warehouseIds: [],
      lastLoginAt: null,
      createdAt,
      updatedAt: createdAt,
    }),
  );

  const usedUsernames = new Set(demo.map((user) => user.username));
  const extraRoles: Role[] = [
    'WAREHOUSE_MANAGER',
    'WAREHOUSE_MANAGER',
    'WAREHOUSE_STAFF',
    'WAREHOUSE_STAFF',
    'WAREHOUSE_STAFF',
    'WAREHOUSE_STAFF',
    'ACCOUNTANT',
    'WAREHOUSE_STAFF',
  ];
  const extra = extraRoles.map((role, index) => {
    const fullName = faker.person.fullName();
    let username = toUsername(fullName);
    while (usedUsernames.has(username)) {
      username = `${toUsername(fullName)}${faker.number.int({ min: 1, max: 99 })}`;
    }
    usedUsernames.add(username);
    return db.user.create({
      id: faker.string.uuid(),
      username,
      passwordHash: hashPassword(username, SEEDED_USER_PASSWORD),
      fullName,
      email: `${username}@example.com`,
      phone: `09${faker.string.numeric(8)}`,
      role,
      status: index === extraRoles.length - 1 ? 'LOCKED' : 'ACTIVE',
      warehouseIds: [],
      lastLoginAt: null,
      createdAt,
      updatedAt: createdAt,
    });
  });
  return [...demo, ...extra];
}

function seedRoles(updatedAt: string): void {
  for (const role of ROLES) {
    db.roleDefinition.create({
      id: role,
      permissions: [...DEFAULT_ROLE_PERMISSIONS[role]],
      updatedAt,
      updatedById: null,
    });
  }
}

/**
 * Phạm vi kho: tài khoản demo `nhanvien` chỉ ở kho Hà Nội để minh họa phân quyền theo kho;
 * người dùng sinh thêm được phân về từng kho.
 */
function assignWarehouseScopes(
  users: readonly UserEntity[],
  warehouses: readonly WarehouseEntity[],
): SeedUsers {
  const [hn, hcm, dn] = warehouses;
  const plan: string[][] = [
    [],
    [],
    [hn.id],
    [],
    [hcm.id],
    [dn.id],
    [hn.id],
    [hcm.id],
    [hcm.id],
    [dn.id],
    [],
    [hn.id],
  ];
  const all = users.map((user, index) =>
    db.user.update({
      where: { id: { equals: user.id } },
      data: { warehouseIds: plan[index] ?? [] },
    })!,
  );
  const [admin, manager, staff, accountant] = all;
  return { all, admin, manager, staff, accountant };
}

function seedCategories(createdAt: string): { entity: CategoryEntity; seed: LeafCategorySeed }[] {
  const leaves: { entity: CategoryEntity; seed: LeafCategorySeed }[] = [];
  for (const root of CATEGORY_TREE) {
    const parent = db.category.create({
      id: faker.string.uuid(),
      code: root.code,
      name: root.name,
      parent: null,
      description: root.description,
      createdAt,
      updatedAt: createdAt,
    });
    for (const child of root.children ?? []) {
      const entity = db.category.create({
        id: faker.string.uuid(),
        code: child.code,
        name: child.name,
        parent,
        description: child.description,
        createdAt,
        updatedAt: createdAt,
      });
      leaves.push({ entity, seed: child });
    }
  }
  return leaves;
}

function seedWarehouses(createdAt: string, users: readonly UserEntity[]): WarehouseEntity[] {
  const managers = users.filter((user) => user.role === 'WAREHOUSE_MANAGER');
  return WAREHOUSE_SEEDS.map((seed, index) =>
    db.warehouse.create({
      id: faker.string.uuid(),
      code: seed.code,
      name: seed.name,
      address: seed.address,
      phone: seed.phone,
      managerName: managers[index % managers.length]?.fullName ?? null,
      status: 'ACTIVE',
      createdAt,
      updatedAt: createdAt,
    }),
  );
}

type WarehouseLayout = (typeof WAREHOUSE_SEEDS)[number]['layout'];

/** Khu › kệ › tầng › ô. Mã: A · A-01 · A-01-1 (tầng 1 sát sàn) · A-01-1-01. Trả các ô theo mã. */
function seedLocations(
  warehouse: WarehouseEntity,
  layout: WarehouseLayout,
  createdAt: string,
): LocationEntity[] {
  const bins: LocationEntity[] = [];
  const create = (
    data: Pick<LocationEntity, 'parentId' | 'type' | 'code' | 'name' | 'capacity' | 'sortOrder'>,
  ) =>
    db.location.create({
      id: faker.string.uuid(),
      warehouseId: warehouse.id,
      status: 'ACTIVE',
      createdAt,
      updatedAt: createdAt,
      ...data,
    });

  for (let z = 0; z < layout.zones; z++) {
    const zoneCode = String.fromCharCode(65 + z);
    const zone = create({
      parentId: null,
      type: 'ZONE',
      code: zoneCode,
      name: `Khu ${zoneCode}`,
      capacity: null,
      sortOrder: z + 1,
    });
    for (let r = 1; r <= layout.racksPerZone; r++) {
      const rackCode = `${zoneCode}-${String(r).padStart(2, '0')}`;
      const rack = create({
        parentId: zone.id,
        type: 'RACK',
        code: rackCode,
        name: `Kệ ${rackCode}`,
        capacity: null,
        sortOrder: r,
      });
      for (let l = 1; l <= layout.levels; l++) {
        const levelCode = `${rackCode}-${l}`;
        const level = create({
          parentId: rack.id,
          type: 'LEVEL',
          code: levelCode,
          name: `Tầng ${l}`,
          capacity: null,
          sortOrder: l,
        });
        for (let b = 1; b <= layout.binsPerLevel; b++) {
          const binNo = String(b).padStart(2, '0');
          bins.push(
            create({
              parentId: level.id,
              type: 'BIN',
              code: `${levelCode}-${binNo}`,
              name: `Ô ${binNo}`,
              capacity: ZONE_BIN_CAPACITY[z] ?? 600,
              sortOrder: b,
            }),
          );
        }
      }
    }
  }
  return bins.sort((a, b) => a.code.localeCompare(b.code));
}

function seedProducts(
  leaves: readonly { entity: CategoryEntity; seed: LeafCategorySeed }[],
  historyStart: Date,
): ProductEntity[] {
  const products: ProductEntity[] = [];
  for (const { entity: category, seed } of leaves) {
    let index = 0;
    for (const baseName of seed.products) {
      const basePrice = faker.number.int({ min: seed.basePrice[0], max: seed.basePrice[1] });
      for (const variant of seed.variants) {
        index++;
        const costPrice = roundTo(basePrice * variant.priceFactor, 100);
        const salePrice = roundTo(costPrice * faker.number.float({ min: 1.12, max: 1.45 }), 500);
        const createdAt = iso(addDays(historyStart, -faker.number.int({ min: 1, max: 60 })));
        const [, maxQty] = typicalQuantity(costPrice);
        const minStock = Math.max(
          2,
          Math.round(maxQty * faker.number.float({ min: 0.25, max: 0.45 })),
        );
        products.push(
          db.product.create({
            id: faker.string.uuid(),
            sku: `${seed.code}-${String(index).padStart(3, '0')}`,
            barcode: ean13(`893${faker.string.numeric(9)}`),
            name: `${baseName} ${variant.label}`,
            category,
            unit: variant.unit,
            costPrice,
            salePrice,
            minStock,
            maxStock: minStock * faker.number.int({ min: 4, max: 8 }),
            trackLot: seed.trackLot,
            trackExpiry: seed.trackExpiry,
            trackSerial: seed.trackSerial ?? false,
            status: faker.number.float() < 0.03 ? 'INACTIVE' : 'ACTIVE',
            description: `${baseName} (${variant.label}) — ${category.name}`,
            imageUrl: null,
            createdAt,
            updatedAt: createdAt,
          }),
        );
      }
    }
  }
  return products;
}

function seedSuppliers(createdAt: string): SupplierEntity[] {
  return faker.helpers
    .uniqueArray(() => faker.company.name(), 12)
    .map((name, index) =>
      db.supplier.create({
        id: faker.string.uuid(),
        code: `NCC-${String(index + 1).padStart(3, '0')}`,
        name,
        taxCode: faker.string.numeric({ length: 10, allowLeadingZeros: false }),
        contactName: faker.person.fullName(),
        phone: `02${faker.string.numeric(9)}`,
        email: `ncc${index + 1}@example.com`,
        address: `${faker.location.streetAddress()}, ${faker.location.city()}`,
        paymentTermDays: faker.helpers.arrayElement(PAYMENT_TERMS),
        status: index === 11 ? 'INACTIVE' : 'ACTIVE',
        note: null,
        createdAt,
        updatedAt: createdAt,
      }),
    );
}

function seedCustomers(createdAt: string): CustomerEntity[] {
  const walkIn = db.customer.create({
    id: faker.string.uuid(),
    code: 'KH-0001',
    name: 'Khách lẻ',
    type: 'RETAIL',
    taxCode: null,
    contactName: null,
    phone: null,
    email: null,
    address: null,
    status: 'ACTIVE',
    note: 'Khách mua lẻ tại quầy, không lưu thông tin',
    createdAt,
    updatedAt: createdAt,
  });
  const named = faker.helpers
    .uniqueArray(() => faker.company.name(), 20)
    .map((name, index) => {
      const type = faker.helpers.weightedArrayElement<CustomerType>([
        { weight: 5, value: 'WHOLESALE' },
        { weight: 3, value: 'RETAIL' },
        { weight: 2, value: 'ONLINE' },
      ]);
      return db.customer.create({
        id: faker.string.uuid(),
        code: `KH-${String(index + 2).padStart(4, '0')}`,
        name,
        type,
        taxCode:
          type === 'WHOLESALE'
            ? faker.string.numeric({ length: 10, allowLeadingZeros: false })
            : null,
        contactName: faker.person.fullName(),
        phone: `09${faker.string.numeric(8)}`,
        email: `kh${index + 2}@example.com`,
        address: `${faker.location.streetAddress()}, ${faker.location.city()}`,
        status: 'ACTIVE',
        note: null,
        createdAt,
        updatedAt: createdAt,
      });
    });
  return [walkIn, ...named];
}

// ───────────────────────────── Chứng từ theo dòng thời gian ─────────────────────────────

function pickStatus(daysAgo: number): DocumentStatus {
  if (daysAgo <= 1) {
    return faker.helpers.weightedArrayElement<DocumentStatus>([
      { weight: 30, value: 'DRAFT' },
      { weight: 45, value: 'PENDING' },
      { weight: 25, value: 'APPROVED' },
    ]);
  }
  if (daysAgo <= 6) {
    return faker.helpers.weightedArrayElement<DocumentStatus>([
      { weight: 8, value: 'DRAFT' },
      { weight: 15, value: 'PENDING' },
      { weight: 7, value: 'REJECTED' },
      { weight: 70, value: 'APPROVED' },
    ]);
  }
  return faker.helpers.weightedArrayElement<DocumentStatus>([
    { weight: 2, value: 'DRAFT' },
    { weight: 5, value: 'REJECTED' },
    { weight: 93, value: 'APPROVED' },
  ]);
}

interface DocumentTimes {
  createdAt: Date;
  submittedAt: Date | null;
  decidedAt: Date | null;
}

function documentTimes(createdAt: Date, status: DocumentStatus): DocumentTimes {
  const submittedAt =
    status === 'DRAFT' ? null : addMinutes(createdAt, faker.number.int({ min: 5, max: 30 }));
  const decided = status === 'APPROVED' || status === 'REJECTED';
  const decidedAt =
    decided && submittedAt ? addMinutes(submittedAt, faker.number.int({ min: 10, max: 45 })) : null;
  return { createdAt, submittedAt, decidedAt };
}

function auditFields(
  times: DocumentTimes,
  status: DocumentStatus,
  creator: UserEntity,
  approver: UserEntity,
  rejectedReason: string | null,
) {
  const approved = status === 'APPROVED';
  const rejected = status === 'REJECTED';
  const decidedAt = times.decidedAt ? iso(times.decidedAt) : null;
  return {
    status,
    createdById: creator.id,
    createdAt: iso(times.createdAt),
    updatedAt: iso(times.decidedAt ?? times.submittedAt ?? times.createdAt),
    submittedAt: times.submittedAt ? iso(times.submittedAt) : null,
    approvedById: approved ? approver.id : null,
    approvedAt: approved ? decidedAt : null,
    rejectedById: rejected ? approver.id : null,
    rejectedAt: rejected ? decidedAt : null,
    rejectedReason: rejected ? rejectedReason : null,
    cancelledById: null,
    cancelledAt: null,
    cancelReason: null,
  };
}

class TimelineSeeder {
  /** Sự kiện hẹn trước (hủy chứng từ, hàng chuyển kho đến nơi) theo ngày. */
  private readonly scheduled = new Map<number, DayEvent[]>();
  private readonly activeProducts: ProductEntity[];
  private readonly productById: Map<string, ProductEntity>;
  /** Ô "nhà" của sản phẩm trong từng kho — sản phẩm cùng nhóm hàng nằm gần nhau. */
  private readonly homeBin = new Map<string, string>();
  /** Tải hiện tại của từng ô — để cất sang ô khác khi ô nhà đã đầy. */
  private readonly binLoad = new Map<string, number>();
  private readonly capacity = new Map<string, number>();
  private readonly nextId = () => faker.string.uuid();
  /** Số thứ tự serial đã cấp theo sản phẩm. */
  private readonly serialSeq = new Map<string, number>();

  constructor(
    private readonly users: SeedUsers,
    private readonly warehouses: readonly WarehouseEntity[],
    products: readonly ProductEntity[],
    private readonly bins: ReadonlyMap<string, LocationEntity[]>,
    private readonly suppliers: readonly SupplierEntity[],
    private readonly customers: readonly CustomerEntity[],
    private readonly historyStart: Date,
  ) {
    this.activeProducts = products.filter((product) => product.status === 'ACTIVE');
    this.productById = new Map(products.map((product) => [product.id, product]));
    for (const warehouse of warehouses) {
      const warehouseBins = bins.get(warehouse.id) ?? [];
      warehouseBins.forEach((bin) => this.capacity.set(bin.id, bin.capacity ?? 600));
      products.forEach((product, index) => {
        const bin = warehouseBins[Math.floor((index * warehouseBins.length) / products.length)];
        this.homeBin.set(`${product.id}__${warehouse.id}`, bin.id);
      });
    }
  }

  // ── tiện ích ──

  private dayAt(day: number, hours: number, minutes = 0): Date {
    return atLocalTime(toLocalDate(addDays(this.historyStart, day)), hours, minutes);
  }

  private schedule(day: number, at: Date, run: () => void): void {
    const list = this.scheduled.get(day) ?? [];
    list.push({ at, run });
    this.scheduled.set(day, list);
  }

  private usersFor(warehouseId: string, ...roles: Role[]): UserEntity[] {
    const candidates = this.users.all.filter(
      (user) =>
        user.status === 'ACTIVE' &&
        roles.includes(user.role) &&
        (user.warehouseIds.length === 0 || user.warehouseIds.includes(warehouseId)),
    );
    return candidates.length > 0 ? candidates : [this.users.admin];
  }

  private approverFor(warehouseId: string): UserEntity {
    return faker.helpers.arrayElement(this.usersFor(warehouseId, 'WAREHOUSE_MANAGER', 'ADMIN'));
  }

  /**
   * Đồng bộ tải ô sau khi nghiệp vụ ghi movement của chứng từ.
   * @param onlyCancel chỉ tính bút toán đảo (hủy chứng từ đã được tính tải trước đó)
   */
  private trackDocumentLoad(documentId: string, onlyCancel = false): void {
    const cancelTypes = new Set(['RECEIPT_CANCEL', 'ISSUE_CANCEL']);
    for (const movement of db.stockMovement.getAll()) {
      if (
        movement.documentId === documentId &&
        movement.locationId &&
        (!onlyCancel || cancelTypes.has(movement.type))
      ) {
        this.binLoad.set(
          movement.locationId,
          (this.binLoad.get(movement.locationId) ?? 0) + movement.quantity,
        );
      }
    }
  }

  /** Ô cất hàng: ô nhà nếu còn chỗ, nếu không thì ô còn trống nhiều nhất cùng kho. */
  private putaway(product: ProductEntity, warehouse: WarehouseEntity, quantity: number): string {
    const home = this.homeBin.get(`${product.id}__${warehouse.id}`)!;
    const free = (id: string) => (this.capacity.get(id) ?? 600) - (this.binLoad.get(id) ?? 0);
    if (free(home) >= quantity) {
      return home;
    }
    let best = home;
    for (const bin of this.bins.get(warehouse.id) ?? []) {
      if (free(bin.id) > free(best)) {
        best = bin.id;
      }
    }
    return best;
  }

  private planReceiptLine(
    product: ProductEntity,
    localDate: string,
    multiplier: number,
  ): PlannedReceiptLine {
    const [min, max] = typicalQuantity(product.costPrice);
    const receivedOn = new Date(`${localDate}T00:00:00+07:00`);
    const quantity = Math.max(1, Math.round(faker.number.int({ min, max }) * multiplier));
    // ~15% lô "cận date" (hạn ngắn) để có hàng sắp hết hạn / đã hết hạn cho cảnh báo & FEFO.
    const shelfLife =
      faker.number.float() < 0.15
        ? faker.number.int({ min: 25, max: 110 })
        : faker.number.int({ min: 120, max: 540 });
    return {
      product,
      quantity,
      unitCost: roundTo(product.costPrice * faker.number.float({ min: 0.95, max: 1.05 }), 100),
      lotNumber: product.trackLot
        ? `L${localDate.replace(/-/g, '').slice(2)}-${faker.string.numeric(3)}`
        : null,
      expiryDate: product.trackExpiry ? toLocalDate(addDays(receivedOn, shelfLife)) : null,
      serialNumbers: product.trackSerial ? this.nextSerials(product, quantity) : [],
    };
  }

  private nextSerials(product: ProductEntity, count: number): string[] {
    const start = this.serialSeq.get(product.id) ?? 0;
    this.serialSeq.set(product.id, start + count);
    const prefix = product.sku.replace(/-/g, '');
    return Array.from(
      { length: count },
      (_, index) => `${prefix}${String(start + index + 1).padStart(5, '0')}`,
    );
  }

  // ── dòng thời gian ──

  run(now: Date, days: number): void {
    this.seedOpeningBalance();
    const stocktakes = this.stocktakePlan(days);

    for (let day = 1; day <= days; day++) {
      const daysAgo = days - day;
      const events: DayEvent[] = [...(this.scheduled.get(day) ?? [])];

      const receiptCount = faker.helpers.weightedArrayElement([
        { weight: 30, value: 0 },
        { weight: 40, value: 1 },
        { weight: 25, value: 2 },
        { weight: 5, value: 3 },
      ]);
      const issueCount = faker.helpers.weightedArrayElement([
        { weight: 20, value: 1 },
        { weight: 40, value: 2 },
        { weight: 30, value: 3 },
        { weight: 10, value: 4 },
      ]);
      const kinds = faker.helpers.shuffle([
        ...Array<'receipt'>(receiptCount).fill('receipt'),
        ...Array<'issue'>(issueCount).fill('issue'),
      ]);
      const slotMinutes = Math.floor(540 / Math.max(1, kinds.length));
      kinds.forEach((kind, slot) => {
        const minuteOfDay = slot * slotMinutes + faker.number.int({ min: 0, max: 20 });
        const at = this.dayAt(day, 8 + Math.floor(minuteOfDay / 60), minuteOfDay % 60);
        const status = pickStatus(daysAgo);
        events.push({
          at,
          run: () =>
            kind === 'receipt'
              ? this.seedReceipt(at, status, day, days)
              : this.seedIssue(at, status, day, days),
        });
      });

      if (day % 4 === 2 || daysAgo <= 2) {
        const at = this.dayAt(day, 13, 15 + faker.number.int({ min: 0, max: 30 }));
        events.push({ at, run: () => this.seedTransfer(at, day, daysAgo) });
      }

      const stocktake = stocktakes.get(day);
      if (stocktake) {
        const at = this.dayAt(day, 17, 30);
        events.push({ at, run: () => stocktake(at) });
      }

      events
        .filter((event) => event.at <= now)
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .forEach((event) => event.run());
    }
  }

  private seedOpeningBalance(): void {
    const localDate = toLocalDate(this.historyStart);
    this.warehouses.forEach((warehouse, index) => {
      const lines = this.activeProducts
        .filter(() => faker.number.float() < 0.75)
        .map((product) =>
          this.planReceiptLine(product, localDate, faker.number.float({ min: 2, max: 4 })),
        );
      this.createReceipt({
        warehouse,
        supplier: null,
        supplierName: 'Tồn đầu kỳ',
        referenceNo: 'OPENING',
        note: 'Nhập tồn đầu kỳ khi khởi tạo hệ thống',
        createdAt: atLocalTime(localDate, 8, index * 20),
        status: 'APPROVED',
        creator: this.users.accountant,
        approver: this.users.manager,
        lines,
      });
    });
  }

  private seedReceipt(createdAt: Date, status: DocumentStatus, day: number, days: number): void {
    const warehouse = faker.helpers.arrayElement(this.warehouses);
    const localDate = toLocalDate(createdAt);
    const lowStock = this.activeProducts.filter(
      (product) => availableQuantity(product.id, warehouse.id) < product.minStock,
    );
    const lineCount = faker.number.int({ min: 1, max: 8 });
    const fromLow = faker.helpers.arrayElements(
      lowStock,
      Math.min(lowStock.length, Math.ceil(lineCount * 0.6)),
    );
    const others = faker.helpers.arrayElements(
      this.activeProducts.filter((product) => !fromLow.includes(product)),
      Math.max(1, lineCount - fromLow.length),
    );
    const supplier = faker.helpers.arrayElement(
      this.suppliers.filter((item) => item.status === 'ACTIVE'),
    );
    const period = localDate.slice(0, 7).replace('-', '');
    const receipt = this.createReceipt({
      warehouse,
      supplier,
      supplierName: supplier.name,
      referenceNo: faker.number.float() < 0.85 ? `PO-${period}-${faker.string.numeric(4)}` : null,
      note:
        faker.number.float() < 0.2 ? 'Đã kiểm đếm đủ số lượng, hàng nguyên đai nguyên kiện' : null,
      createdAt,
      status,
      creator: faker.helpers.arrayElement(
        this.usersFor(warehouse.id, 'WAREHOUSE_STAFF', 'ACCOUNTANT'),
      ),
      approver: this.approverFor(warehouse.id),
      lines: [...fromLow, ...others].map((product) =>
        this.planReceiptLine(product, localDate, faker.number.float({ min: 1, max: 2.5 })),
      ),
    });
    this.maybeScheduleCancellation('receipt', receipt, warehouse, day, days);
  }

  private seedIssue(createdAt: Date, status: DocumentStatus, day: number, days: number): void {
    const warehouse = faker.helpers.arrayElement(this.warehouses);
    const reason = faker.helpers.weightedArrayElement<IssueReason>([
      { weight: 82, value: 'SALE' },
      { weight: 6, value: 'INTERNAL_USE' },
      { weight: 5, value: 'DAMAGED' },
      { weight: 4, value: 'RETURN_TO_SUPPLIER' },
      { weight: 3, value: 'OTHER' },
    ]);
    const asOf = toLocalDate(createdAt);
    // Xuất hủy ưu tiên mặt hàng có lô đã hết hạn; các lý do khác chỉ lấy tồn còn hạn.
    const expiredStock = (product: ProductEntity) =>
      lotsOf(product.id, warehouse.id)
        .filter((lot) => isExpired(lot.expiryDate, asOf))
        .reduce((sum, lot) => sum + lot.quantity, 0);
    const availableFor = (product: ProductEntity) =>
      reason === 'DAMAGED'
        ? availableQuantity(product.id, warehouse.id)
        : sellableQuantity(product, warehouse.id, asOf);
    const withExpired =
      reason === 'DAMAGED' ? this.activeProducts.filter((p) => expiredStock(p) > 0) : [];
    const inStock =
      withExpired.length > 0
        ? withExpired
        : this.activeProducts.filter((product) => availableFor(product) > 0);
    if (inStock.length === 0) {
      return;
    }
    const maxLines = reason === 'SALE' ? 6 : 2;
    const picked = faker.helpers.arrayElements(
      inStock,
      faker.number.int({ min: 1, max: Math.min(maxLines, inStock.length) }),
    );
    const lines: PlannedIssueLine[] = picked.map((product) => {
      const available =
        withExpired.length > 0 ? Math.max(1, expiredStock(product)) : availableFor(product);
      const [min, max] = typicalQuantity(product.costPrice);
      const wanted =
        reason === 'SALE'
          ? faker.number.int({ min, max })
          : withExpired.length > 0
            ? available
            : faker.number.int({ min: 1, max: Math.max(1, min) });
      const unitPrice =
        reason === 'SALE'
          ? product.salePrice
          : reason === 'RETURN_TO_SUPPLIER'
            ? product.costPrice
            : 0;
      return { product, quantity: Math.max(1, Math.min(available, wanted)), unitPrice };
    });

    let customer: CustomerEntity | null = null;
    let customerName: string;
    if (reason === 'SALE') {
      customer = faker.helpers.arrayElement(this.customers);
      customerName = customer.name;
    } else if (reason === 'RETURN_TO_SUPPLIER') {
      customerName = faker.helpers.arrayElement(this.suppliers).name;
    } else if (reason === 'INTERNAL_USE') {
      customerName = faker.helpers.arrayElement(ISSUE_RECEIVERS_INTERNAL);
    } else {
      customerName = reason === 'DAMAGED' ? 'Hủy hàng hỏng, hết hạn' : 'Xuất khác';
    }
    const period = toLocalDate(createdAt).slice(0, 7).replace('-', '');
    const issue = this.createIssue({
      warehouse,
      customer,
      customerName,
      reason,
      referenceNo:
        reason === 'SALE' && faker.number.float() < 0.8
          ? `SO-${period}-${faker.string.numeric(4)}`
          : null,
      createdAt,
      status,
      creator: faker.helpers.arrayElement(this.usersFor(warehouse.id, 'WAREHOUSE_STAFF')),
      approver: this.approverFor(warehouse.id),
      lines,
    });
    this.maybeScheduleCancellation('issue', issue, warehouse, day, days);
  }

  private createReceipt(args: {
    warehouse: WarehouseEntity;
    supplier: SupplierEntity | null;
    supplierName: string;
    referenceNo: string | null;
    note: string | null;
    createdAt: Date;
    status: DocumentStatus;
    creator: UserEntity;
    approver: UserEntity;
    lines: PlannedReceiptLine[];
  }): SeededDocument {
    const localDate = toLocalDate(args.createdAt);
    const times = documentTimes(args.createdAt, args.status);
    const code = nextDocumentCode('PN', localDate);
    const rejectedReason =
      args.status === 'REJECTED' ? faker.helpers.arrayElement(REJECT_REASONS) : null;
    const receipt = db.goodsReceipt.create({
      id: faker.string.uuid(),
      code,
      warehouseId: args.warehouse.id,
      supplierId: args.supplier?.id ?? null,
      supplierName: args.supplierName,
      referenceNo: args.referenceNo,
      receiptDate: localDate,
      note: args.note,
      ...auditFields(times, args.status, args.creator, args.approver, rejectedReason),
    });
    args.lines.forEach((line, index) =>
      db.goodsReceiptLine.create({
        id: faker.string.uuid(),
        goodsReceiptId: receipt.id,
        lineNo: index + 1,
        productId: line.product.id,
        quantity: line.quantity,
        unitCost: line.unitCost,
        lotNumber: line.lotNumber,
        expiryDate: line.expiryDate,
        serialNumbers: line.serialNumbers,
        // Phiếu đã duyệt: cất theo ô "nhà" của sản phẩm (seed theo dõi tải từng ô).
        locationId:
          args.status === 'APPROVED'
            ? this.putaway(line.product, args.warehouse, line.quantity)
            : null,
      }),
    );
    const entity = { id: receipt.id, label: code };
    seedAudit(
      args.creator,
      'CREATE',
      'GOODS_RECEIPT',
      entity,
      `Tạo phiếu nhập ${code} — ${args.warehouse.name}`,
      times.createdAt,
    );
    if (times.submittedAt) {
      seedAudit(
        args.creator,
        'SUBMIT',
        'GOODS_RECEIPT',
        entity,
        `Gửi duyệt phiếu nhập ${code}`,
        times.submittedAt,
      );
    }
    if (args.status === 'REJECTED' && times.decidedAt) {
      seedAudit(
        args.approver,
        'REJECT',
        'GOODS_RECEIPT',
        entity,
        `Từ chối phiếu nhập ${code}: ${rejectedReason}`,
        times.decidedAt,
      );
    }
    if (args.status === 'APPROVED' && times.decidedAt) {
      approveReceipt(receipt, {
        actor: args.approver,
        occurredAt: iso(times.decidedAt),
        nextId: this.nextId,
      });
      this.trackDocumentLoad(receipt.id);
      seedAudit(
        args.approver,
        'APPROVE',
        'GOODS_RECEIPT',
        entity,
        `Duyệt phiếu nhập ${code}, cộng tồn ${args.lines.length} dòng`,
        times.decidedAt,
      );
    }
    return { id: receipt.id, code, status: args.status };
  }

  private createIssue(args: {
    warehouse: WarehouseEntity;
    customer: CustomerEntity | null;
    customerName: string;
    reason: IssueReason;
    referenceNo: string | null;
    createdAt: Date;
    status: DocumentStatus;
    creator: UserEntity;
    approver: UserEntity;
    lines: PlannedIssueLine[];
  }): SeededDocument {
    const localDate = toLocalDate(args.createdAt);
    const times = documentTimes(args.createdAt, args.status);
    const approved = args.status === 'APPROVED';
    const code = nextDocumentCode('PX', localDate);
    const rejectedReason =
      args.status === 'REJECTED' ? faker.helpers.arrayElement(REJECT_REASONS) : null;
    const issue = db.goodsIssue.create({
      id: faker.string.uuid(),
      code,
      warehouseId: args.warehouse.id,
      customerId: args.customer?.id ?? null,
      customerName: args.customerName,
      reason: args.reason,
      referenceNo: args.referenceNo,
      issueDate: localDate,
      note: null,
      ...auditFields(times, args.status, args.creator, args.approver, rejectedReason),
    });
    args.lines.forEach((line, index) =>
      db.goodsIssueLine.create({
        id: faker.string.uuid(),
        goodsIssueId: issue.id,
        lineNo: index + 1,
        productId: line.product.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitCost: null,
        lotNumber: null,
        serialNumbers: [],
        picks: '[]',
      }),
    );
    const entity = { id: issue.id, label: code };
    seedAudit(
      args.creator,
      'CREATE',
      'GOODS_ISSUE',
      entity,
      `Tạo phiếu xuất ${code} — ${args.warehouse.name}`,
      times.createdAt,
    );
    if (times.submittedAt) {
      seedAudit(
        args.creator,
        'SUBMIT',
        'GOODS_ISSUE',
        entity,
        `Gửi duyệt phiếu xuất ${code}`,
        times.submittedAt,
      );
    }
    if (args.status === 'REJECTED' && times.decidedAt) {
      seedAudit(
        args.approver,
        'REJECT',
        'GOODS_ISSUE',
        entity,
        `Từ chối phiếu xuất ${code}: ${rejectedReason}`,
        times.decidedAt,
      );
    }
    if (approved && times.decidedAt) {
      approveIssue(issue, {
        actor: args.approver,
        occurredAt: iso(times.decidedAt),
        nextId: this.nextId,
      });
      this.trackDocumentLoad(issue.id);
      seedAudit(
        args.approver,
        'APPROVE',
        'GOODS_ISSUE',
        entity,
        `Duyệt phiếu xuất ${code}, trừ tồn ${args.lines.length} dòng`,
        times.decidedAt,
      );
    }
    return { id: issue.id, code, status: args.status };
  }

  private maybeScheduleCancellation(
    kind: 'receipt' | 'issue',
    document: SeededDocument,
    warehouse: WarehouseEntity,
    day: number,
    days: number,
  ): void {
    if (document.status !== 'APPROVED' || days - day <= 10 || faker.number.float() >= 0.03) {
      return;
    }
    const cancelDay = day + faker.number.int({ min: 1, max: 4 });
    const canceller = this.approverFor(warehouse.id);
    const reason = faker.helpers.arrayElement(CANCEL_REASONS);
    const at = this.dayAt(cancelDay, 18, 30);
    this.schedule(cancelDay, at, () => this.cancelDocument(kind, document, canceller, reason, at));
  }

  /** Hủy chứng từ đã duyệt: đảo đúng các movement đã ghi (đúng ô, đúng giá vốn). */
  private cancelDocument(
    kind: 'receipt' | 'issue',
    document: SeededDocument,
    canceller: UserEntity,
    reason: string,
    at: Date,
  ): void {
    const context = { actor: canceller, occurredAt: iso(at), nextId: this.nextId };
    const before = db.stockMovement.count();
    try {
      if (kind === 'receipt') {
        cancelReceipt(findById('goodsReceipt', document.id)!, reason, context);
      } else {
        cancelIssue(findById('goodsIssue', document.id)!, reason, context);
      }
    } catch (error) {
      // Hàng của phiếu nhập đã được xuất bớt / serial đã bán → không thể hủy (đúng nghiệp vụ).
      if (error instanceof InsufficientStockError || error instanceof SerialError) return;
      throw error;
    }
    if (db.stockMovement.count() > before) {
      this.trackDocumentLoad(document.id, true);
    }
    seedAudit(
      canceller,
      'CANCEL',
      kind === 'receipt' ? 'GOODS_RECEIPT' : 'GOODS_ISSUE',
      { id: document.id, label: document.code },
      `Hủy phiếu ${document.code} bằng bút toán đảo: ${reason}`,
      at,
    );
  }

  // ── chuyển kho ──

  private seedTransfer(at: Date, day: number, daysAgo: number): void {
    const [from, to] = faker.helpers.shuffle([...this.warehouses]);
    const asOf = toLocalDate(at);
    const sellable = new Map(
      this.activeProducts.map((product) => [product.id, sellableQuantity(product, from.id, asOf)]),
    );
    const candidates = this.activeProducts.filter(
      (product) => sellable.get(product.id)! >= product.minStock * 2,
    );
    if (candidates.length === 0) return;
    const creator = faker.helpers.arrayElement(
      this.usersFor(from.id, 'WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER'),
    );
    const localDate = toLocalDate(at);
    const code = nextDocumentCode('CK', localDate);
    const createdAt = iso(at);
    const transfer = db.transfer.create({
      id: faker.string.uuid(),
      code,
      fromWarehouseId: from.id,
      toWarehouseId: to.id,
      status: 'DRAFT',
      transferDate: localDate,
      expectedDate: toLocalDate(addDays(at, 2)),
      note: faker.helpers.arrayElement(TRANSFER_NOTES),
      receiveNote: null,
      createdById: creator.id,
      createdAt,
      updatedAt: createdAt,
      shippedById: null,
      shippedAt: null,
      receivedById: null,
      receivedAt: null,
      cancelledById: null,
      cancelledAt: null,
      cancelReason: null,
    });
    faker.helpers
      .arrayElements(candidates, faker.number.int({ min: 2, max: 5 }))
      .forEach((product, index) =>
        db.transferLine.create({
          id: faker.string.uuid(),
          transferId: transfer.id,
          lineNo: index + 1,
          productId: product.id,
          quantity: Math.max(
            1,
            Math.round(sellable.get(product.id)! * faker.number.float({ min: 0.2, max: 0.35 })),
          ),
          fromLocationId: null,
          picks: '[]',
          unitCost: null,
          receivedQuantity: null,
          toLocationId: null,
        }),
      );
    const entity = { id: transfer.id, label: code };
    seedAudit(
      creator,
      'CREATE',
      'TRANSFER',
      entity,
      `Tạo phiếu chuyển kho ${code}: ${from.name} → ${to.name}`,
      at,
    );

    if (daysAgo === 1) {
      return; // phiếu nháp tạo hôm qua, chưa xuất
    }
    const shippedAt = addMinutes(at, 40);
    shipTransfer(transfer, { actor: creator, occurredAt: iso(shippedAt), nextId: this.nextId });
    this.trackDocumentLoad(transfer.id);
    seedAudit(creator, 'SHIP', 'TRANSFER', entity, `Xuất hàng đi cho phiếu ${code}`, shippedAt);
    if (daysAgo <= 2) {
      return; // hàng đang trên đường — để demo luồng nhận hàng
    }

    const arrivalDay = day + faker.number.int({ min: 1, max: 2 });
    const arrivalAt = this.dayAt(arrivalDay, 15, 0);
    const cancel = daysAgo > 10 && faker.number.float() < 0.08;
    const receiver = faker.helpers.arrayElement(
      this.usersFor(to.id, 'WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER'),
    );
    const shortLine = !cancel && faker.number.float() < 0.15;
    const shortBy = faker.number.int({ min: 1, max: 3 });
    this.schedule(arrivalDay, arrivalAt, () => {
      const current = findById('transfer', transfer.id)!;
      const before = new Set(
        db.stockMovement
          .getAll()
          .filter((m) => m.documentId === transfer.id)
          .map((m) => m.id),
      );
      if (cancel) {
        const reason = 'Xe vận chuyển gặp sự cố, hàng quay đầu về kho đi';
        cancelTransfer(current, reason, {
          actor: creator,
          occurredAt: iso(arrivalAt),
          nextId: this.nextId,
        });
        seedAudit(
          creator,
          'CANCEL',
          'TRANSFER',
          entity,
          `Hủy phiếu ${code} đang vận chuyển: ${reason}`,
          arrivalAt,
        );
      } else {
        const lines = transferLines(transfer.id);
        const receipts = lines.map((line, index) => ({
          lineId: line.id,
          receivedQuantity:
            shortLine && index === 0 ? Math.max(0, line.quantity - shortBy) : line.quantity,
          toLocationId: this.putaway(this.productById.get(line.productId)!, to, line.quantity),
        }));
        const note = shortLine ? 'Thiếu hàng do bể vỡ trong vận chuyển, đã lập biên bản' : null;
        receiveTransfer(current, receipts, note, {
          actor: receiver,
          occurredAt: iso(arrivalAt),
          nextId: this.nextId,
        });
        seedAudit(
          receiver,
          'RECEIVE',
          'TRANSFER',
          entity,
          `Nhận hàng phiếu ${code} tại ${to.name}`,
          arrivalAt,
        );
      }
      for (const movement of db.stockMovement.getAll()) {
        if (
          movement.documentId === transfer.id &&
          !before.has(movement.id) &&
          movement.locationId
        ) {
          this.binLoad.set(
            movement.locationId,
            (this.binLoad.get(movement.locationId) ?? 0) + movement.quantity,
          );
        }
      }
    });
  }

  // ── kiểm kê ──

  private stocktakePlan(days: number): Map<number, (at: Date) => void> {
    const [hn, hcm, dn] = this.warehouses;
    const zone = (warehouse: WarehouseEntity, code: string): string =>
      db.location
        .getAll()
        .find(
          (location) =>
            location.warehouseId === warehouse.id &&
            location.type === 'ZONE' &&
            location.code === code,
        )!.id;
    return new Map<number, (at: Date) => void>([
      [
        40,
        (at) =>
          this.seedStocktake(
            at,
            hn,
            [zone(hn, 'A')],
            false,
            'Kiểm kê định kỳ khu A',
            'COMPLETED',
            1,
          ),
      ],
      [
        80,
        (at) => this.seedStocktake(at, hcm, [], true, 'Kiểm kê toàn kho (đếm mù)', 'COMPLETED', 1),
      ],
      [
        days - 2,
        (at) =>
          this.seedStocktake(
            at,
            dn,
            [zone(dn, 'A')],
            false,
            'Kiểm kê đột xuất khu A',
            'SUBMITTED',
            1,
          ),
      ],
      [
        days - 1,
        (at) =>
          this.seedStocktake(
            at,
            hn,
            [zone(hn, 'B')],
            false,
            'Kiểm kê định kỳ khu B',
            'IN_PROGRESS',
            0.5,
          ),
      ],
    ]);
  }

  private seedStocktake(
    at: Date,
    warehouse: WarehouseEntity,
    zoneIds: string[],
    blind: boolean,
    name: string,
    finalStatus: 'COMPLETED' | 'SUBMITTED' | 'IN_PROGRESS',
    countRatio: number,
  ): void {
    const manager = this.approverFor(warehouse.id);
    const stocktake = openStocktake({
      id: faker.string.uuid(),
      warehouse,
      name,
      zoneIds,
      blind,
      note: null,
      actor: manager,
      occurredAt: iso(at),
      nextLineId: this.nextId,
    });
    const entity = { id: stocktake.id, label: stocktake.code };
    seedAudit(
      manager,
      'CREATE',
      'STOCKTAKE',
      entity,
      `Mở phiên kiểm kê ${stocktake.code} — ${warehouse.name}`,
      at,
    );

    // Phiên đang đếm dở ở kho Hà Nội do tài khoản demo `nhanvien` đếm.
    const counter =
      finalStatus === 'IN_PROGRESS'
        ? this.users.staff
        : faker.helpers.arrayElement(this.usersFor(warehouse.id, 'WAREHOUSE_STAFF'));
    let counted = 0;
    stocktakeLines(stocktake.id).forEach((line, index) => {
      if (faker.number.float() >= countRatio) return;
      const variance = faker.number.float() < 0.1 ? faker.number.int({ min: -4, max: 3 }) : 0;
      recordCount(line, {
        countedQuantity: Math.max(0, line.expectedQuantity + variance),
        countedAt: iso(addMinutes(at, 5 + Math.floor(index / 5))),
        actor: counter,
        clientId: faker.string.uuid(),
        note: variance < 0 ? 'Thiếu so với hệ thống' : variance > 0 ? 'Thừa so với hệ thống' : null,
      });
      counted++;
    });
    const countedAt = addMinutes(at, 50);
    seedAudit(counter, 'COUNT', 'STOCKTAKE', entity, `Ghi nhận số đếm ${counted} dòng`, countedAt);
    if (finalStatus === 'IN_PROGRESS') return;

    const submittedAt = addMinutes(at, 55);
    db.stocktake.update({
      where: { id: { equals: stocktake.id } },
      data: {
        status: 'SUBMITTED',
        submittedById: counter.id,
        submittedAt: iso(submittedAt),
        updatedAt: iso(submittedAt),
      },
    });
    seedAudit(
      counter,
      'SUBMIT',
      'STOCKTAKE',
      entity,
      `Gửi duyệt kết quả kiểm kê ${stocktake.code}`,
      submittedAt,
    );
    if (finalStatus === 'SUBMITTED') return;

    const approvedAt = addMinutes(at, 70);
    approveStocktake(findById('stocktake', stocktake.id)!, {
      actor: manager,
      occurredAt: iso(approvedAt),
      nextId: this.nextId,
    });
    this.trackDocumentLoad(stocktake.id);
    seedAudit(
      manager,
      'APPROVE',
      'STOCKTAKE',
      entity,
      `Duyệt kiểm kê ${stocktake.code}, điều chỉnh tồn theo chênh lệch`,
      approvedAt,
    );
  }
}

function seedLogins(users: SeedUsers, now: Date): void {
  for (const user of [users.admin, users.manager, users.staff, users.accountant]) {
    for (let daysAgo = 30; daysAgo >= 1; daysAgo--) {
      if (faker.number.float() < 0.35) continue;
      const at = atLocalTime(
        toLocalDate(addDays(now, -daysAgo)),
        7,
        faker.number.int({ min: 40, max: 59 }),
      );
      if (faker.number.float() < 0.06) {
        seedAudit(
          null,
          'LOGIN_FAILED',
          'AUTH',
          null,
          `Đăng nhập thất bại với tên "${user.username}" (sai mật khẩu)`,
          addMinutes(at, -1),
        );
      }
      seedAudit(
        user,
        'LOGIN',
        'AUTH',
        { id: user.id, label: user.username },
        'Đăng nhập thành công',
        at,
      );
    }
  }
}

export function seedDatabase(now: Date = new Date()): SeedSummary {
  const startedAt = performance.now();
  faker.seed(MOCK_CONFIG.seed);

  const days = MOCK_CONFIG.seedHistoryDays;
  const historyStart = atLocalTime(toLocalDate(addDays(now, -days)), 8);
  const setupDate = addDays(historyStart, -90);
  const setupAt = iso(setupDate);

  const createdUsers = seedUsers(setupAt);
  seedRoles(setupAt);
  const leaves = seedCategories(setupAt);
  const warehouses = seedWarehouses(setupAt, createdUsers);
  const users = assignWarehouseScopes(createdUsers, warehouses);

  const bins = new Map<string, LocationEntity[]>();
  warehouses.forEach((warehouse, index) =>
    bins.set(warehouse.id, seedLocations(warehouse, WAREHOUSE_SEEDS[index].layout, setupAt)),
  );
  const products = seedProducts(leaves, historyStart);
  const suppliers = seedSuppliers(setupAt);
  const customers = seedCustomers(setupAt);

  for (const user of users.all.slice(1)) {
    seedAudit(
      users.admin,
      'CREATE',
      'USER',
      { id: user.id, label: user.username },
      `Tạo người dùng ${user.fullName}`,
      setupDate,
    );
  }
  for (const warehouse of warehouses) {
    seedAudit(
      users.admin,
      'CREATE',
      'WAREHOUSE',
      { id: warehouse.id, label: warehouse.code },
      `Khai báo ${warehouse.name} và sơ đồ vị trí`,
      setupDate,
    );
  }

  new TimelineSeeder(users, warehouses, products, bins, suppliers, customers, historyStart).run(
    now,
    days,
  );
  seedLogins(users, now);

  return {
    users: db.user.count(),
    categories: db.category.count(),
    products: db.product.count(),
    warehouses: db.warehouse.count(),
    locations: db.location.count(),
    suppliers: db.supplier.count(),
    customers: db.customer.count(),
    goodsReceipts: db.goodsReceipt.count(),
    goodsIssues: db.goodsIssue.count(),
    transfers: db.transfer.count(),
    stocktakes: db.stocktake.count(),
    stockMovements: db.stockMovement.count(),
    auditLogs: db.auditLog.count(),
    durationMs: Math.round(performance.now() - startedAt),
  };
}
