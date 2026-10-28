/** Ngày theo giờ Việt Nam dạng `YYYY-MM-DD` (định dạng ngày của API). */
export function toLocalDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** `YYYY-MM-DD` → Date (nửa đêm giờ địa phương của trình duyệt, dùng cho datepicker). */
export function fromLocalDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function today(): string {
  return toLocalDate(new Date());
}

/**
 * Date của datepicker (nửa đêm giờ trình duyệt) → `YYYY-MM-DD` theo ngày người dùng đã chọn.
 * Không dùng `toLocalDate` cho giá trị datepicker: trình duyệt ở múi giờ khác UTC+7 sẽ lệch ngày.
 */
export function pickerDateToApi(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
