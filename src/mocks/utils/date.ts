/** Múi giờ nghiệp vụ. Việt Nam cố định UTC+7, không có giờ mùa hè. */
export const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const UTC_OFFSET = '+07:00';

const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Ngày theo giờ Việt Nam dạng `YYYY-MM-DD`. */
export function toLocalDate(date: Date): string {
  return localDateFormatter.format(date);
}

/** Thời điểm `HH:mm` của ngày `YYYY-MM-DD` theo giờ Việt Nam. */
export function atLocalTime(localDate: string, hours: number, minutes = 0): Date {
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return new Date(`${localDate}T${hh}:${mm}:00${UTC_OFFSET}`);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function nowIso(): string {
  return new Date().toISOString();
}
