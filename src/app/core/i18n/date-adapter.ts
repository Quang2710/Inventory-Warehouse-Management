import { Injectable, type Provider } from '@angular/core';
import {
  DateAdapter,
  MAT_DATE_FORMATS,
  MAT_DATE_LOCALE,
  NativeDateAdapter,
} from '@angular/material/core';

const DMY = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\s*$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Datepicker theo định dạng nghiệp vụ Việt Nam `dd/MM/yyyy` (cả khi giao diện tiếng Anh):
 * gõ tay "27/10/2026", "27-10-26" hay "27.10.2026" đều hiểu; ngày không tồn tại (31/02) bị loại.
 */
@Injectable()
export class VnDateAdapter extends NativeDateAdapter {
  override parse(value: unknown): Date | null {
    if (typeof value === 'string') {
      if (value.trim() === '') return null;
      const match = DMY.exec(value);
      if (!match) return this.invalid();
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        ? date
        : this.invalid();
    }
    return super.parse(value);
  }

  override format(date: Date, displayFormat: object): string {
    if (displayFormat === VN_DATE_FORMATS.display.dateInput) {
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    }
    return super.format(date, displayFormat);
  }

  override getFirstDayOfWeek(): number {
    return 1; // Thứ Hai
  }
}

export const VN_DATE_FORMATS = {
  parse: { dateInput: 'dd/MM/yyyy' },
  display: {
    dateInput: { day: '2-digit', month: '2-digit', year: 'numeric' },
    monthYearLabel: { month: 'short', year: 'numeric' },
    dateA11yLabel: { day: 'numeric', month: 'long', year: 'numeric' },
    monthYearA11yLabel: { month: 'long', year: 'numeric' },
  },
};

export function provideVnDateAdapter(): Provider[] {
  return [
    { provide: MAT_DATE_LOCALE, useValue: 'vi-VN' },
    { provide: DateAdapter, useClass: VnDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: VN_DATE_FORMATS },
  ];
}
