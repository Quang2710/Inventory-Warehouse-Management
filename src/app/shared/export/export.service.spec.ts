import { of } from 'rxjs';

import { fetchAllPages, formatDateVn, formatMoney } from './export.service';

describe('export helpers', () => {
  it('định dạng ngày theo dd/MM/yyyy, giờ Việt Nam', () => {
    expect(formatDateVn('2026-10-27')).toBe('27/10/2026');
    // 17:30 UTC = 00:30 ngày hôm sau ở Việt Nam.
    expect(formatDateVn('2026-10-27T17:30:00Z')).toBe('28/10/2026');
    expect(formatDateVn('2026-10-27T17:30:00Z', true)).toBe('28/10/2026 00:30');
    expect(formatDateVn(null)).toBe('');
  });

  it('định dạng tiền VND không có số lẻ', () => {
    expect(formatMoney(1234567)).toBe('1.234.567 ₫');
    expect(formatMoney(undefined)).toBe('');
  });

  it('lấy hết các trang theo bộ lọc cho tới đủ total', async () => {
    const all = Array.from({ length: 450 }, (_, index) => index);
    const requested: number[] = [];
    const rows = await fetchAllPages((page, size) => {
      requested.push(page);
      return of({
        items: all.slice((page - 1) * size, page * size),
        total: all.length,
        page,
        size,
      });
    });
    expect(rows).toEqual(all);
    expect(requested).toEqual([1, 2, 3]);
  });

  it('dừng ở giới hạn số bản ghi', async () => {
    const rows = await fetchAllPages(
      (page, size) =>
        of({ items: Array.from({ length: size }, () => page), total: 10_000, page, size }),
      300,
    );
    expect(rows.length).toBe(300);
  });
});
