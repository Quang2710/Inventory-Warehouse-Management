import type {
  AuditAction,
  AuditEntityType,
  CustomerType,
  LocationStatus,
  LocationType,
  PartnerStatus,
  Role,
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
