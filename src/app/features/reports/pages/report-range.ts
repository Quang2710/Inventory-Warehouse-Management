import type { DateRange } from '../../../shared/ui/date-range-field/date-range-field';
import { today } from '../../../shared/forms/date-utils';

/** `days` ngày gần nhất tính tới hôm nay (giờ Việt Nam). */
export function defaultRange(days: number): DateRange {
  const to = today();
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { from: start.toISOString().slice(0, 10), to };
}

/** Từ đầu tháng hiện tại tới hôm nay. */
export function monthToDate(): DateRange {
  const to = today();
  return { from: `${to.slice(0, 8)}01`, to };
}
