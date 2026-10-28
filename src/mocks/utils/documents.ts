import type { DocumentStatus } from '../../app/core/api/schema';
import { findById } from '../db';
import { InsufficientStockError, SerialError } from '../domain/inventory';
import { errors, type FieldErrors } from './http';

/** Quy trình chung của phiếu nhập / phiếu xuất. */
export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Bị từ chối',
  CANCELLED: 'Đã hủy',
};

export function requireDocumentStatus(
  document: { code: string; status: DocumentStatus },
  ...allowed: DocumentStatus[]
): void {
  if (!allowed.includes(document.status)) {
    throw errors.invalidState(
      `Phiếu ${document.code} đang ở trạng thái "${DOCUMENT_STATUS_LABEL[document.status]}", không thực hiện được thao tác này.`,
    );
  }
}

export const LOT_PATTERN = /^[A-Za-z0-9._/-]{1,50}$/;
export const SERIAL_PATTERN = /^[A-Za-z0-9._/-]{1,64}$/;
/** Giới hạn số serial trên một dòng — nhập serial theo từng đơn vị. */
export const MAX_SERIALS_PER_LINE = 500;

export function formatDate(localDate: string): string {
  const [year, month, day] = localDate.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Chuyển lỗi nghiệp vụ tồn kho thành 422 theo dòng chứng từ (`lines.{i}.quantity` /
 * `lines.{i}.serialNumbers`). Lỗi khác ném lại nguyên trạng.
 */
export function rethrowStockError(error: unknown, message: string): never {
  if (error instanceof InsufficientStockError) {
    const details: FieldErrors = {};
    for (const shortage of error.shortages) {
      const location = findById('location', shortage.locationId)?.code;
      const where = [
        shortage.lotNumber ? `lô ${shortage.lotNumber}` : null,
        location && `ô ${location}`,
      ]
        .filter(Boolean)
        .join(', ');
      (details[`lines.${shortage.index}.quantity`] ??= []).push(
        `${shortage.sku}${where ? ` (${where})` : ''}: chỉ còn ${shortage.available}, cần ${shortage.requested}.`,
      );
    }
    throw errors.insufficientStock(details, message);
  }
  if (error instanceof SerialError) {
    const details: FieldErrors = {};
    for (const problem of error.problems) {
      (details[`lines.${problem.index}.serialNumbers`] ??= []).push(problem.message);
    }
    throw errors.validation(details, 'Số serial không hợp lệ.');
  }
  throw error;
}
