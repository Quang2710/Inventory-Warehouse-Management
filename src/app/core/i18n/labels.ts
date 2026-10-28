import type {
  AbcClass,
  AlertType,
  AuditAction,
  AuditEntityType,
  CustomerType,
  DocumentStatus,
  DocumentType,
  ExpiryStatus,
  IssueReason,
  LocationStatus,
  LocationType,
  MovementType,
  PartnerStatus,
  Role,
  SerialStatus,
  StockStatus,
  StocktakeStatus,
  TransferStatus,
  UserStatus,
  WarehouseStatus,
} from '../api';
import type { Language, TranslationKey } from './i18n.types';

/** Khóa dịch cho các giá trị enum — dùng trong template thay vì ghép chuỗi khóa. */
export const ROLE_LABEL_KEYS: Readonly<Record<Role, TranslationKey>> = {
  ADMIN: 'roles.ADMIN',
  WAREHOUSE_MANAGER: 'roles.WAREHOUSE_MANAGER',
  WAREHOUSE_STAFF: 'roles.WAREHOUSE_STAFF',
  ACCOUNTANT: 'roles.ACCOUNTANT',
};

export const LANGUAGE_LABEL_KEYS: Readonly<Record<Language, TranslationKey>> = {
  vi: 'languages.vi',
  en: 'languages.en',
};

/** Sắc thái hiển thị của chip trạng thái. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusLabel {
  labelKey: TranslationKey;
  tone: Tone;
}

export const WAREHOUSE_STATUS: Readonly<Record<WarehouseStatus | LocationStatus, StatusLabel>> = {
  ACTIVE: { labelKey: 'statuses.active', tone: 'success' },
  INACTIVE: { labelKey: 'statuses.inactive', tone: 'neutral' },
};

export const PARTNER_STATUS: Readonly<Record<PartnerStatus, StatusLabel>> = {
  ACTIVE: { labelKey: 'statuses.partnerActive', tone: 'success' },
  INACTIVE: { labelKey: 'statuses.partnerInactive', tone: 'neutral' },
};

export const USER_STATUS: Readonly<Record<UserStatus, StatusLabel>> = {
  ACTIVE: { labelKey: 'statuses.userActive', tone: 'success' },
  LOCKED: { labelKey: 'statuses.userLocked', tone: 'danger' },
};

export const TRANSFER_STATUS: Readonly<Record<TransferStatus, StatusLabel>> = {
  DRAFT: { labelKey: 'statuses.transferDraft', tone: 'neutral' },
  IN_TRANSIT: { labelKey: 'statuses.transferInTransit', tone: 'warning' },
  RECEIVED: { labelKey: 'statuses.transferReceived', tone: 'success' },
  CANCELLED: { labelKey: 'statuses.transferCancelled', tone: 'danger' },
};

export const STOCKTAKE_STATUS: Readonly<Record<StocktakeStatus, StatusLabel>> = {
  IN_PROGRESS: { labelKey: 'statuses.stocktakeInProgress', tone: 'info' },
  SUBMITTED: { labelKey: 'statuses.stocktakeSubmitted', tone: 'warning' },
  COMPLETED: { labelKey: 'statuses.stocktakeCompleted', tone: 'success' },
  CANCELLED: { labelKey: 'statuses.stocktakeCancelled', tone: 'danger' },
};

export const LOCATION_TYPE_LABEL_KEYS: Readonly<Record<LocationType, TranslationKey>> = {
  ZONE: 'locationTypes.ZONE',
  RACK: 'locationTypes.RACK',
  LEVEL: 'locationTypes.LEVEL',
  BIN: 'locationTypes.BIN',
};

export const CUSTOMER_TYPE_LABEL_KEYS: Readonly<Record<CustomerType, TranslationKey>> = {
  RETAIL: 'customerTypes.RETAIL',
  WHOLESALE: 'customerTypes.WHOLESALE',
  ONLINE: 'customerTypes.ONLINE',
};

export const AUDIT_ACTION_LABEL_KEYS = Object.fromEntries(
  (
    [
      'CREATE',
      'UPDATE',
      'DELETE',
      'SUBMIT',
      'APPROVE',
      'REJECT',
      'CANCEL',
      'SHIP',
      'RECEIVE',
      'COUNT',
      'REOPEN',
      'LOGIN',
      'LOGIN_FAILED',
      'LOGOUT',
      'PERMISSION_CHANGE',
      'PASSWORD_RESET',
      'DATA_RESET',
    ] as const satisfies readonly AuditAction[]
  ).map((action) => [action, `audit.actions.${action}` as TranslationKey]),
) as Readonly<Record<AuditAction, TranslationKey>>;

export const AUDIT_ENTITY_LABEL_KEYS = Object.fromEntries(
  (
    [
      'AUTH',
      'USER',
      'ROLE',
      'WAREHOUSE',
      'LOCATION',
      'PRODUCT',
      'CATEGORY',
      'SUPPLIER',
      'CUSTOMER',
      'GOODS_RECEIPT',
      'GOODS_ISSUE',
      'TRANSFER',
      'STOCKTAKE',
      'SYSTEM',
    ] as const satisfies readonly AuditEntityType[]
  ).map((entity) => [entity, `audit.entities.${entity}` as TranslationKey]),
) as Readonly<Record<AuditEntityType, TranslationKey>>;

/** Phiếu nhập / phiếu xuất. */
export const DOCUMENT_STATUS: Readonly<Record<DocumentStatus, StatusLabel>> = {
  DRAFT: { labelKey: 'statuses.documentDraft', tone: 'neutral' },
  PENDING: { labelKey: 'statuses.documentPending', tone: 'warning' },
  APPROVED: { labelKey: 'statuses.documentApproved', tone: 'success' },
  REJECTED: { labelKey: 'statuses.documentRejected', tone: 'danger' },
  CANCELLED: { labelKey: 'statuses.documentCancelled', tone: 'neutral' },
};

export const ISSUE_REASON_LABEL_KEYS: Readonly<Record<IssueReason, TranslationKey>> = {
  SALE: 'issueReasons.SALE',
  RETURN_TO_SUPPLIER: 'issueReasons.RETURN_TO_SUPPLIER',
  INTERNAL_USE: 'issueReasons.INTERNAL_USE',
  DAMAGED: 'issueReasons.DAMAGED',
  OTHER: 'issueReasons.OTHER',
};

export const EXPIRY_STATUS: Readonly<Record<ExpiryStatus, StatusLabel>> = {
  NO_EXPIRY: { labelKey: 'expiry.NO_EXPIRY', tone: 'neutral' },
  VALID: { labelKey: 'expiry.VALID', tone: 'success' },
  EXPIRING: { labelKey: 'expiry.EXPIRING', tone: 'warning' },
  EXPIRED: { labelKey: 'expiry.EXPIRED', tone: 'danger' },
};

export const SERIAL_STATUS: Readonly<Record<SerialStatus, StatusLabel>> = {
  IN_STOCK: { labelKey: 'serials.statuses.IN_STOCK', tone: 'success' },
  IN_TRANSIT: { labelKey: 'serials.statuses.IN_TRANSIT', tone: 'warning' },
  ISSUED: { labelKey: 'serials.statuses.ISSUED', tone: 'info' },
  WRITTEN_OFF: { labelKey: 'serials.statuses.WRITTEN_OFF', tone: 'danger' },
};

export const ALERT_TYPE: Readonly<Record<AlertType, StatusLabel & { icon: string }>> = {
  OUT_OF_STOCK: {
    labelKey: 'alerts.types.OUT_OF_STOCK',
    tone: 'danger',
    icon: 'remove_shopping_cart',
  },
  LOW_STOCK: { labelKey: 'alerts.types.LOW_STOCK', tone: 'warning', icon: 'trending_down' },
  EXPIRED: { labelKey: 'alerts.types.EXPIRED', tone: 'danger', icon: 'event_busy' },
  EXPIRING: { labelKey: 'alerts.types.EXPIRING', tone: 'warning', icon: 'schedule' },
};

export const MOVEMENT_TYPE_LABEL_KEYS: Readonly<Record<MovementType, TranslationKey>> = {
  RECEIPT: 'movementTypes.RECEIPT',
  RECEIPT_CANCEL: 'movementTypes.RECEIPT_CANCEL',
  ISSUE: 'movementTypes.ISSUE',
  ISSUE_CANCEL: 'movementTypes.ISSUE_CANCEL',
  TRANSFER_OUT: 'movementTypes.TRANSFER_OUT',
  TRANSFER_IN: 'movementTypes.TRANSFER_IN',
  TRANSFER_CANCEL: 'movementTypes.TRANSFER_CANCEL',
  ADJUSTMENT: 'movementTypes.ADJUSTMENT',
};

/** Đường dẫn màn hình chi tiết của chứng từ (liên kết từ thẻ kho, serial…). */
export const DOCUMENT_ROUTES: Readonly<Record<DocumentType, string | null>> = {
  GOODS_RECEIPT: '/goods-receipts',
  GOODS_ISSUE: '/goods-issues',
  TRANSFER: '/transfers',
  STOCKTAKE: '/stocktakes',
  ADJUSTMENT: null,
};

export const ABC_CLASS: Readonly<Record<AbcClass, StatusLabel>> = {
  A: { labelKey: 'reports.abc.classA', tone: 'danger' },
  B: { labelKey: 'reports.abc.classB', tone: 'warning' },
  C: { labelKey: 'reports.abc.classC', tone: 'neutral' },
};

export const STOCK_STATUS: Readonly<Record<StockStatus, StatusLabel>> = {
  IN_STOCK: { labelKey: 'stock.statuses.IN_STOCK', tone: 'success' },
  LOW_STOCK: { labelKey: 'stock.statuses.LOW_STOCK', tone: 'warning' },
  OUT_OF_STOCK: { labelKey: 'stock.statuses.OUT_OF_STOCK', tone: 'danger' },
};
