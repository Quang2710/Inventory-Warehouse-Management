import { parseListQuery, toPage } from './query';

interface Row {
  name: string;
  qty: number;
}

const rows: Row[] = [
  { name: 'Đường cát trắng', qty: 5 },
  { name: 'Bánh quy bơ', qty: 12 },
  { name: 'Ánh dương', qty: 1 },
  { name: 'Cà phê rang xay', qty: 30 },
];

const options = {
  sortable: ['name', 'qty'] as const,
  searchIn: (row: Row) => [row.name],
};

const query = (search: string) => parseListQuery(new URL(`http://localhost/api/x?${search}`));

describe('mock list query', () => {
  it('phân trang 1-based và trả total theo bộ lọc', () => {
    const page = toPage(rows, query('page=2&size=3&sort=qty,asc'), options);
    expect(page).toEqual({
      items: [{ name: 'Cà phê rang xay', qty: 30 }],
      total: 4,
      page: 2,
      size: 3,
    });
  });

  it('tìm kiếm không phân biệt dấu và hoa thường', () => {
    expect(toPage(rows, query('q=duong cat'), options).items.map((row) => row.name)).toEqual([
      'Đường cát trắng',
    ]);
    expect(toPage(rows, query('q=CA PHE'), options).total).toBe(1);
  });

  it('sắp xếp chuỗi theo collation tiếng Việt', () => {
    const names = toPage(rows, query('sort=name,asc'), options).items.map((row) => row.name);
    expect(names).toEqual(['Ánh dương', 'Bánh quy bơ', 'Cà phê rang xay', 'Đường cát trắng']);
  });

  it('trả 422 khi tham số sai hoặc sort field không được phép', async () => {
    expect(() => query('page=0')).toThrow(Response);
    expect(() => query('size=1000')).toThrow(Response);
    let thrown: unknown;
    try {
      toPage(rows, query('sort=password,asc'), options);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(
      expect.objectContaining({ code: 'VALIDATION_ERROR', details: expect.any(Object) }),
    );
  });
});
