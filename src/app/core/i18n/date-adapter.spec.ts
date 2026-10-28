import { TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';

import { VN_DATE_FORMATS, provideVnDateAdapter } from './date-adapter';

describe('VnDateAdapter', () => {
  let adapter: DateAdapter<Date>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideVnDateAdapter()] });
    adapter = TestBed.inject(DateAdapter);
  });

  it('hiểu ngày gõ tay theo dd/MM/yyyy (kể cả năm 2 chữ số, dấu - hoặc .)', () => {
    for (const text of ['27/10/2026', '27-10-26', '27.10.2026', ' 7/1/2026 ']) {
      const date = adapter.parse(text, VN_DATE_FORMATS.parse.dateInput)!;
      expect(adapter.isValid(date)).toBe(true);
    }
    const date = adapter.parse('27/10/2026', VN_DATE_FORMATS.parse.dateInput)!;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 27]);
  });

  it('loại ngày không tồn tại và chuỗi sai định dạng', () => {
    expect(adapter.isValid(adapter.parse('31/02/2026', null)!)).toBe(false);
    expect(adapter.isValid(adapter.parse('2026-10-27x', null)!)).toBe(false);
    expect(adapter.parse('', null)).toBeNull();
  });

  it('hiển thị dd/MM/yyyy và tuần bắt đầu từ thứ Hai', () => {
    expect(adapter.format(new Date(2026, 0, 5), VN_DATE_FORMATS.display.dateInput)).toBe(
      '05/01/2026',
    );
    expect(adapter.getFirstDayOfWeek()).toBe(1);
  });
});
