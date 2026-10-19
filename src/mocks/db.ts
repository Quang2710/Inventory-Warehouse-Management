import { factory, nullable, oneOf, primaryKey } from '@mswjs/data';
import { DATABASE_INSTANCE } from '@mswjs/data/lib/glossary';

import type {
  AuditAction,
  AuditEntityType,
  CustomerType,
  DocumentStatus,
  DocumentType,
  IssueReason,
  LocationStatus,
  LocationType,
  MovementType,
  PartnerStatus,
  Permission,
  ProductStatus,
  Role,
  StocktakeStatus,
  TransferStatus,
  UserStatus,
  WarehouseStatus,
} from '../app/core/api/schema';

const uuid = (): string => crypto.randomUUID();

/**
 * Cơ sở dữ liệu giả có quan hệ (@mswjs/data).
 *
 * Quy ước:
 * - Thời điểm lưu dạng chuỗi ISO-8601 (UTC); ngày chứng từ dạng `YYYY-MM-DD`.
 * - Quan hệ trong dữ liệu danh mục (sản phẩm → danh mục, danh mục → cha, phiên → người dùng)
 *   dùng `oneOf`. Bảng khối lượng lớn (tồn kho, chứng từ, dòng hàng, biến động, vị trí, nhật ký)
 *   dùng KHÓA NGOẠI (`productId`, `warehouseId`, …): ở @mswjs/data 0.16 mỗi lần đọc thuộc tính
 *   quan hệ là một lần quét tuần tự model đích, đo thực tế làm seed/khôi phục chậm tới vài giây
 *   với ~2000 bản ghi. Handler join qua `findById` (O(1)).
 * - `stockItem` (theo kho) và `binStock` (theo ô) là bảng tổng hợp, CHỈ được cập nhật qua
 *   `domain/inventory.ts` cùng lúc ghi `stockMovement`.
 *   `stockItem.id` = `${productId}__${warehouseId}`, `binStock.id` = `${productId}__${locationId}`.
 * - Mảng giá trị nguyên thủy (vd `warehouseIds`) được hỗ trợ; mảng object lưu dạng chuỗi JSON.
 */
export const db = factory({
  user: {
    id: primaryKey(uuid),
    username: String,
    passwordHash: String,
    fullName: String,
    email: String,
    phone: nullable(String),
    role: (): Role => 'WAREHOUSE_STAFF',
    status: (): UserStatus => 'ACTIVE',
    /** Kho được phép thao tác; rỗng = mọi kho. */
    warehouseIds: (): string[] => [],
    lastLoginAt: nullable(String),
    createdAt: String,
    updatedAt: String,
  },
  /** Ma trận quyền theo vai trò (id = mã vai trò). Admin sửa được qua `/roles`. */
  roleDefinition: {
    id: primaryKey((): Role => 'WAREHOUSE_STAFF'),
    permissions: (): Permission[] => [],
    updatedAt: String,
    updatedById: nullable(String),
  },
  /** Refresh token đang lưu hành (id = jti của token). */
  session: {
    id: primaryKey(uuid),
    user: oneOf('user'),
    expiresAt: String,
    revoked: Boolean,
    createdAt: String,
  },
  category: {
    id: primaryKey(uuid),
    code: String,
    name: String,
    parent: nullable(oneOf('category')),
    description: nullable(String),
    createdAt: String,
    updatedAt: String,
  },
  warehouse: {
    id: primaryKey(uuid),
    code: String,
    name: String,
    address: String,
    phone: nullable(String),
    managerName: nullable(String),
    status: (): WarehouseStatus => 'ACTIVE',
    createdAt: String,
    updatedAt: String,
  },
  /** Vị trí trong kho: khu › kệ › tầng › ô. Chỉ ô (BIN) chứa hàng. */
  location: {
    id: primaryKey(uuid),
    warehouseId: String,
    parentId: nullable(String),
    type: (): LocationType => 'BIN',
    /** Mã đầy đủ, duy nhất trong kho (vd A-01-2-03). */
    code: String,
    name: String,
    capacity: nullable(Number),
    status: (): LocationStatus => 'ACTIVE',
    sortOrder: Number,
    createdAt: String,
    updatedAt: String,
  },
  product: {
    id: primaryKey(uuid),
    sku: String,
    barcode: nullable(String),
    name: String,
    category: oneOf('category'),
    unit: String,
    costPrice: Number,
    salePrice: Number,
    minStock: Number,
    maxStock: nullable(Number),
    trackLot: Boolean,
    trackExpiry: Boolean,
    status: (): ProductStatus => 'ACTIVE',
    description: nullable(String),
    imageUrl: nullable(String),
    createdAt: String,
    updatedAt: String,
  },
  supplier: {
    id: primaryKey(uuid),
    code: String,
    name: String,
    taxCode: nullable(String),
    contactName: nullable(String),
    phone: nullable(String),
    email: nullable(String),
    address: nullable(String),
    paymentTermDays: Number,
    status: (): PartnerStatus => 'ACTIVE',
    note: nullable(String),
    createdAt: String,
    updatedAt: String,
  },
  customer: {
    id: primaryKey(uuid),
    code: String,
    name: String,
    type: (): CustomerType => 'RETAIL',
    taxCode: nullable(String),
    contactName: nullable(String),
    phone: nullable(String),
    email: nullable(String),
    address: nullable(String),
    status: (): PartnerStatus => 'ACTIVE',
    note: nullable(String),
    createdAt: String,
    updatedAt: String,
  },
  stockItem: {
    id: primaryKey(String),
    productId: String,
    warehouseId: String,
    quantity: Number,
    averageCost: Number,
    lastMovementAt: nullable(String),
  },
  binStock: {
    id: primaryKey(String),
    productId: String,
    warehouseId: String,
    locationId: String,
    quantity: Number,
    updatedAt: String,
  },
  goodsReceipt: {
    id: primaryKey(uuid),
    code: String,
    warehouseId: String,
    supplierId: nullable(String),
    supplierName: String,
    referenceNo: nullable(String),
    receiptDate: String,
    note: nullable(String),
    status: (): DocumentStatus => 'DRAFT',
    createdById: String,
    createdAt: String,
    updatedAt: String,
    submittedAt: nullable(String),
    approvedById: nullable(String),
    approvedAt: nullable(String),
    rejectedById: nullable(String),
    rejectedAt: nullable(String),
    rejectedReason: nullable(String),
    cancelledById: nullable(String),
    cancelledAt: nullable(String),
    cancelReason: nullable(String),
  },
  goodsReceiptLine: {
    id: primaryKey(uuid),
    goodsReceiptId: String,
    lineNo: Number,
    productId: String,
    quantity: Number,
    unitCost: Number,
    lotNumber: nullable(String),
    expiryDate: nullable(String),
  },
  goodsIssue: {
    id: primaryKey(uuid),
    code: String,
    warehouseId: String,
    customerId: nullable(String),
    customerName: String,
    reason: (): IssueReason => 'SALE',
    referenceNo: nullable(String),
    issueDate: String,
    note: nullable(String),
    status: (): DocumentStatus => 'DRAFT',
    createdById: String,
    createdAt: String,
    updatedAt: String,
    submittedAt: nullable(String),
    approvedById: nullable(String),
    approvedAt: nullable(String),
    rejectedById: nullable(String),
    rejectedAt: nullable(String),
    rejectedReason: nullable(String),
    cancelledById: nullable(String),
    cancelledAt: nullable(String),
    cancelReason: nullable(String),
  },
  goodsIssueLine: {
    id: primaryKey(uuid),
    goodsIssueId: String,
    lineNo: Number,
    productId: String,
    quantity: Number,
    unitPrice: Number,
    /** Giá vốn chốt tại thời điểm duyệt. */
    unitCost: nullable(Number),
  },
  transfer: {
    id: primaryKey(uuid),
    code: String,
    fromWarehouseId: String,
    toWarehouseId: String,
    status: (): TransferStatus => 'DRAFT',
    transferDate: String,
    expectedDate: nullable(String),
    note: nullable(String),
    receiveNote: nullable(String),
    createdById: String,
    createdAt: String,
    updatedAt: String,
    shippedById: nullable(String),
    shippedAt: nullable(String),
    receivedById: nullable(String),
    receivedAt: nullable(String),
    cancelledById: nullable(String),
    cancelledAt: nullable(String),
    cancelReason: nullable(String),
  },
  transferLine: {
    id: primaryKey(uuid),
    transferId: String,
    lineNo: Number,
    productId: String,
    quantity: Number,
    fromLocationId: nullable(String),
    /** JSON `{ locationId, quantity }[]` — các ô đã lấy hàng khi xuất đi. */
    picks: String,
    /** Giá vốn bình quân của kho đi tại thời điểm xuất — dùng khi nhập kho đến / hoàn trả. */
    unitCost: nullable(Number),
    receivedQuantity: nullable(Number),
    toLocationId: nullable(String),
  },
  stocktake: {
    id: primaryKey(uuid),
    code: String,
    warehouseId: String,
    name: String,
    status: (): StocktakeStatus => 'IN_PROGRESS',
    blind: Boolean,
    zoneIds: (): string[] => [],
    note: nullable(String),
    createdById: String,
    createdAt: String,
    updatedAt: String,
    submittedById: nullable(String),
    submittedAt: nullable(String),
    approvedById: nullable(String),
    approvedAt: nullable(String),
    cancelledById: nullable(String),
    cancelledAt: nullable(String),
    cancelReason: nullable(String),
  },
  stocktakeLine: {
    id: primaryKey(uuid),
    stocktakeId: String,
    locationId: String,
    productId: String,
    /** Tồn hệ thống của ô lúc mở phiên. */
    expectedQuantity: Number,
    countedQuantity: nullable(Number),
    /** Tồn hệ thống của ô tại thời điểm ghi nhận số đếm — gốc tính chênh lệch. */
    systemQuantityAtCount: nullable(Number),
    countedById: nullable(String),
    countedAt: nullable(String),
    note: nullable(String),
    unexpected: Boolean,
    lastClientId: nullable(String),
  },
  stockMovement: {
    id: primaryKey(uuid),
    occurredAt: String,
    type: (): MovementType => 'RECEIPT',
    productId: String,
    warehouseId: String,
    locationId: nullable(String),
    /** Số lượng có dấu: + nhập, − xuất. */
    quantity: Number,
    balanceAfter: Number,
    unitCost: Number,
    documentType: (): DocumentType => 'GOODS_RECEIPT',
    documentId: String,
    documentCode: String,
    createdById: String,
    note: nullable(String),
  },
  auditLog: {
    id: primaryKey(uuid),
    occurredAt: String,
    userId: nullable(String),
    userName: String,
    action: (): AuditAction => 'UPDATE',
    entityType: (): AuditEntityType => 'SYSTEM',
    entityId: nullable(String),
    entityLabel: nullable(String),
    summary: String,
    /** JSON `{ field, from, to }[]`. */
    changes: String,
    ipAddress: nullable(String),
    userAgent: nullable(String),
  },
  /** Bộ đếm số chứng từ theo tiền tố + tháng, vd `PN-202610`. */
  counter: {
    id: primaryKey(String),
    value: Number,
  },
});

const database = db[DATABASE_INSTANCE];

// @mswjs/data mặc định bật đồng bộ đa tab qua BroadcastChannel; cơ chế này serialize quan hệ
// thành object thường và làm hỏng db ở tab còn lại. Tắt đi — dữ liệu được lưu bền bằng IndexedDB
// và đồng bộ giữa các tab theo snapshot (xem persistence.ts).
database.events.removeAllListeners();

export type Db = typeof db;
export type ModelName = Extract<keyof Db, string>;
export type EntityOf<M extends ModelName> = ReturnType<Db[M]['create']>;

/**
 * Tra cứu O(1) theo khóa chính. Dùng thay `findFirst({ where: { id } })` — hàm đó quét toàn bộ model.
 */
export function findById<M extends ModelName>(
  model: M,
  id: string | null | undefined,
): EntityOf<M> | null {
  if (!id) {
    return null;
  }
  return (database.getModel(model).get(id) as EntityOf<M> | undefined) ?? null;
}

export type UserEntity = EntityOf<'user'>;
export type SessionEntity = EntityOf<'session'>;
export type CategoryEntity = EntityOf<'category'>;
export type WarehouseEntity = EntityOf<'warehouse'>;
export type LocationEntity = EntityOf<'location'>;
export type ProductEntity = EntityOf<'product'>;
export type SupplierEntity = EntityOf<'supplier'>;
export type CustomerEntity = EntityOf<'customer'>;
export type StockItemEntity = EntityOf<'stockItem'>;
export type BinStockEntity = EntityOf<'binStock'>;
export type GoodsReceiptEntity = EntityOf<'goodsReceipt'>;
export type GoodsReceiptLineEntity = EntityOf<'goodsReceiptLine'>;
export type GoodsIssueEntity = EntityOf<'goodsIssue'>;
export type GoodsIssueLineEntity = EntityOf<'goodsIssueLine'>;
export type TransferEntity = EntityOf<'transfer'>;
export type TransferLineEntity = EntityOf<'transferLine'>;
export type StocktakeEntity = EntityOf<'stocktake'>;
export type StocktakeLineEntity = EntityOf<'stocktakeLine'>;
export type StockMovementEntity = EntityOf<'stockMovement'>;
export type AuditLogEntity = EntityOf<'auditLog'>;
