/** Bỏ dấu tiếng Việt + chữ thường để so khớp tìm kiếm ("Đường" ~ "duong"). */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Mọi từ trong `q` đều phải xuất hiện ở ít nhất một field. */
export function matchesQuery(q: string, fields: readonly (string | null | undefined)[]): boolean {
  const terms = normalizeText(q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return true;
  }
  const haystack = fields.map((field) => normalizeText(field)).join(' ');
  return terms.every((term) => haystack.includes(term));
}

/** "Trần Thị Hoa" → "tran.thi.hoa" */
export function toUsername(fullName: string): string {
  return normalizeText(fullName)
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join('.');
}
