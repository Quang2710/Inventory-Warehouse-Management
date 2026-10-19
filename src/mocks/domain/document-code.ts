import { db } from '../db';

export type DocumentPrefix = 'PN' | 'PX' | 'CK' | 'KK';

/**
 * Cấp số chứng từ tăng dần theo tháng: `PN-202610-0001`.
 * @param localDate ngày chứng từ `YYYY-MM-DD`
 */
export function nextDocumentCode(prefix: DocumentPrefix, localDate: string): string {
  const period = localDate.slice(0, 7).replace('-', '');
  const counterId = `${prefix}-${period}`;
  const counter = db.counter.findFirst({ where: { id: { equals: counterId } } });
  const value = (counter?.value ?? 0) + 1;
  if (counter) {
    db.counter.update({ where: { id: { equals: counterId } }, data: { value } });
  } else {
    db.counter.create({ id: counterId, value });
  }
  return `${counterId}-${String(value).padStart(4, '0')}`;
}
