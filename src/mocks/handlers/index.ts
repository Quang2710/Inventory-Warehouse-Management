import { auditHandlers } from './audit.handlers';
import { authHandlers } from './auth.handlers';
import { catalogHandlers } from './catalog.handlers';
import { demoHandlers } from './demo.handlers';
import { latencyAndChaosHandler, notImplementedHandler } from './middleware.handlers';
import { partnerHandlers } from './partners.handlers';
import { stocktakeHandlers } from './stocktakes.handlers';
import { transferHandlers } from './transfers.handlers';
import { userHandlers } from './users.handlers';
import { warehouseHandlers } from './warehouses.handlers';

/**
 * Thứ tự quan trọng: middleware (trễ + lỗi ngẫu nhiên) → nghiệp vụ theo module → 404 dự phòng.
 * Thêm handler của module mới vào giữa.
 */
export const handlers = [
  latencyAndChaosHandler,
  ...authHandlers,
  ...demoHandlers,
  ...userHandlers,
  ...catalogHandlers,
  ...warehouseHandlers,
  ...transferHandlers,
  ...stocktakeHandlers,
  ...partnerHandlers,
  ...auditHandlers,
  notImplementedHandler,
];
