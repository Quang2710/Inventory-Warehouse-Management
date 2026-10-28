import { MODULE_ACCESS } from '../auth/module-access';
import type { RouteAccess } from '../auth/route-access';
import type { TranslationKey } from '../i18n/i18n.types';

export interface NavItem {
  labelKey: TranslationKey;
  /** Tên icon Material Symbols. */
  icon: string;
  path: string;
  access: RouteAccess;
}

export interface NavSection {
  titleKey: TranslationKey;
  items: readonly NavItem[];
}

/** Menu chính. Mục hiển thị theo quyền của người dùng (`MODULE_ACCESS`). */
export const NAVIGATION: readonly NavSection[] = [
  {
    titleKey: 'nav.sections.overview',
    items: [
      {
        labelKey: 'nav.dashboard',
        icon: 'space_dashboard',
        path: '/dashboard',
        access: MODULE_ACCESS.dashboard,
      },
      {
        labelKey: 'nav.alerts',
        icon: 'notifications',
        path: '/alerts',
        access: MODULE_ACCESS.alerts,
      },
    ],
  },
  {
    titleKey: 'nav.sections.catalog',
    items: [
      {
        labelKey: 'nav.products',
        icon: 'inventory_2',
        path: '/products',
        access: MODULE_ACCESS.products,
      },
      {
        labelKey: 'nav.categories',
        icon: 'category',
        path: '/categories',
        access: MODULE_ACCESS.categories,
      },
    ],
  },
  {
    titleKey: 'nav.sections.operations',
    items: [
      { labelKey: 'nav.scan', icon: 'barcode_scanner', path: '/scan', access: MODULE_ACCESS.scan },
      {
        labelKey: 'nav.warehouses',
        icon: 'warehouse',
        path: '/warehouses',
        access: MODULE_ACCESS.warehouses,
      },
      { labelKey: 'nav.stock', icon: 'stacks', path: '/stock', access: MODULE_ACCESS.stock },
      {
        labelKey: 'nav.goodsReceipts',
        icon: 'move_to_inbox',
        path: '/goods-receipts',
        access: MODULE_ACCESS.goodsReceipts,
      },
      {
        labelKey: 'nav.goodsIssues',
        icon: 'outbox',
        path: '/goods-issues',
        access: MODULE_ACCESS.goodsIssues,
      },
      {
        labelKey: 'nav.transfers',
        icon: 'local_shipping',
        path: '/transfers',
        access: MODULE_ACCESS.transfers,
      },
      {
        labelKey: 'nav.stocktakes',
        icon: 'fact_check',
        path: '/stocktakes',
        access: MODULE_ACCESS.stocktakes,
      },
    ],
  },
  {
    titleKey: 'nav.sections.reports',
    items: [
      {
        labelKey: 'nav.stockMovements',
        icon: 'swap_vert',
        path: '/stock-movements',
        access: MODULE_ACCESS.stockMovements,
      },
      {
        labelKey: 'nav.inventorySummary',
        icon: 'table_chart',
        path: '/reports/inventory-summary',
        access: MODULE_ACCESS.reports,
      },
      {
        labelKey: 'nav.stockValue',
        icon: 'payments',
        path: '/reports/stock-value',
        access: MODULE_ACCESS.reports,
      },
      {
        labelKey: 'nav.abc',
        icon: 'leaderboard',
        path: '/reports/abc',
        access: MODULE_ACCESS.reports,
      },
    ],
  },
  {
    titleKey: 'nav.sections.partners',
    items: [
      {
        labelKey: 'nav.suppliers',
        icon: 'factory',
        path: '/suppliers',
        access: MODULE_ACCESS.suppliers,
      },
      {
        labelKey: 'nav.customers',
        icon: 'storefront',
        path: '/customers',
        access: MODULE_ACCESS.customers,
      },
    ],
  },
  {
    titleKey: 'nav.sections.system',
    items: [
      {
        labelKey: 'nav.users',
        icon: 'manage_accounts',
        path: '/users',
        access: MODULE_ACCESS.users,
      },
      {
        labelKey: 'nav.roles',
        icon: 'admin_panel_settings',
        path: '/roles',
        access: MODULE_ACCESS.roles,
      },
      {
        labelKey: 'nav.auditLogs',
        icon: 'history',
        path: '/audit-logs',
        access: MODULE_ACCESS.auditLogs,
      },
    ],
  },
];

/** Lọc menu theo quyền; bỏ nhóm không còn mục nào. */
export function visibleNavigation(canAccess: (access: RouteAccess) => boolean): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccess(item.access)),
  })).filter((section) => section.items.length > 0);
}
