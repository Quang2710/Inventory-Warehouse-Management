import { Injectable, inject } from '@angular/core';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { type Observable, firstValueFrom } from 'rxjs';

import type { Page } from '../../core/api';
import { AuthStore } from '../../core/auth/auth.store';
import { I18nService } from '../../core/i18n/i18n.service';

export type ExportCellType = 'text' | 'number' | 'money' | 'date' | 'datetime' | 'percent';
export type ExportFormat = 'xlsx' | 'pdf';
type CellValue = string | number | null | undefined;

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => CellValue;
  type?: ExportCellType;
  /** Độ rộng tương đối (ký tự) — dùng cho cột Excel và tỉ lệ cột PDF. */
  width?: number;
}

export interface ExportSpec<T> {
  /** Tên file không có phần mở rộng. */
  fileName: string;
  title: string;
  /** Các dòng mô tả bộ lọc đang áp dụng (kho, khoảng ngày…). */
  subtitle?: readonly string[];
  columns: readonly ExportColumn<T>[];
  rows: readonly T[];
  /** Dòng tổng cộng, căn theo cột (null = ô trống). */
  totals?: readonly CellValue[];
  orientation?: 'portrait' | 'landscape';
}

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const moneyFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const dateTimeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `YYYY-MM-DD` hoặc ISO → `dd/MM/yyyy` (`dd/MM/yyyy HH:mm`), giờ Việt Nam. */
export function formatDateVn(value: string | null | undefined, withTime = false): string {
  if (!value) return '';
  if (!withTime && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dateTimeParts.formatToParts(date).find((item) => item.type === type)?.value ?? '';
  const day = `${part('day')}/${part('month')}/${part('year')}`;
  return withTime ? `${day} ${part('hour')}:${part('minute')}` : day;
}

export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : `${moneyFormat.format(value)} ₫`;
}

/** Giá trị hiển thị (PDF) của một ô. */
function displayValue(value: CellValue, type: ExportCellType = 'text'): string {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'money':
      return typeof value === 'number' ? moneyFormat.format(value) : String(value);
    case 'number':
      return typeof value === 'number' ? numberFormat.format(value) : String(value);
    case 'percent':
      return typeof value === 'number' ? `${numberFormat.format(value)}%` : String(value);
    case 'date':
      return formatDateVn(String(value));
    case 'datetime':
      return formatDateVn(String(value), true);
    default:
      return String(value);
  }
}

const NUMERIC: ReadonlySet<ExportCellType> = new Set(['number', 'money', 'percent']);

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * Xuất bảng ra Excel (SheetJS) / PDF (pdfmake, font Roboto có đủ dấu tiếng Việt).
 * Thư viện chỉ được tải khi người dùng bấm xuất (dynamic import → chunk riêng).
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthStore);

  async export<T>(spec: ExportSpec<T>, format: ExportFormat): Promise<void> {
    if (format === 'xlsx') await this.toExcel(spec);
    else await this.toPdf(spec);
  }

  async toExcel<T>(spec: ExportSpec<T>): Promise<void> {
    const XLSX = await import('xlsx');
    const header = spec.columns.map((column) => column.header);
    const body = spec.rows.map((row) =>
      spec.columns.map((column) => {
        const value = column.value(row);
        if (value === null || value === undefined) return null;
        if (column.type === 'date' || column.type === 'datetime') {
          return displayValue(value, column.type);
        }
        return value;
      }),
    );
    const meta = [
      [spec.title],
      ...(spec.subtitle ?? []).map((line) => [line]),
      [this.footerText()],
      [],
    ];
    const rows: CellValue[][] = [...meta, header, ...body];
    if (spec.totals) rows.push([...spec.totals]);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = spec.columns.map((column) => ({
      wch: column.width ?? Math.max(10, column.header.length + 2),
    }));
    // Định dạng số cho cột tiền / số lượng.
    const firstDataRow = meta.length + 1;
    spec.columns.forEach((column, columnIndex) => {
      if (!column.type || !NUMERIC.has(column.type)) return;
      const format =
        column.type === 'money' ? '#,##0' : column.type === 'percent' ? '0.00"%"' : '#,##0.##';
      for (let rowIndex = firstDataRow; rowIndex < rows.length; rowIndex++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
        if (cell && cell.t === 'n') cell.z = format;
      }
    });
    sheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: meta.length, c: 0 },
        e: { r: meta.length + body.length, c: spec.columns.length - 1 },
      }),
    };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, spec.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    XLSX.writeFile(book, `${spec.fileName}-${timestamp()}.xlsx`, { compression: true });
  }

  async toPdf<T>(spec: ExportSpec<T>): Promise<void> {
    const widths = spec.columns.map((column) => column.width ?? 10);
    const total = widths.reduce((sum, width) => sum + width, 0);
    const cell = (value: string, type: ExportCellType = 'text', bold = false) => ({
      text: value,
      alignment: NUMERIC.has(type) ? ('right' as const) : ('left' as const),
      bold,
    });
    const table: Content = {
      table: {
        headerRows: 1,
        widths: widths.map((width) => `${((width / total) * 100).toFixed(2)}%`),
        body: [
          spec.columns.map((column) => cell(column.header, column.type, true)),
          ...spec.rows.map((row) =>
            spec.columns.map((column) =>
              cell(displayValue(column.value(row), column.type), column.type),
            ),
          ),
          ...(spec.totals
            ? [
                spec.columns.map((column, index) =>
                  cell(displayValue(spec.totals![index], column.type), column.type, true),
                ),
              ]
            : []),
        ],
      },
      layout: {
        fillColor: (rowIndex: number) =>
          rowIndex === 0 ? '#e8eaf0' : rowIndex % 2 === 0 ? '#f8f9fb' : null,
        hLineColor: () => '#d0d4dc',
        vLineColor: () => '#d0d4dc',
      },
    };
    await this.print(
      {
        pageOrientation: spec.orientation ?? (spec.columns.length > 7 ? 'landscape' : 'portrait'),
        content: [
          { text: spec.title, style: 'title' },
          ...(spec.subtitle ?? []).map((line) => ({ text: line, style: 'subtitle' })),
          { text: ' ', fontSize: 4 },
          table,
        ],
      },
      spec.fileName,
    );
  }

  /** In / tải một tài liệu PDF tùy biến (phiếu nhập, phiếu lấy hàng…). */
  async print(definition: TDocumentDefinitions, fileName: string): Promise<void> {
    const [pdfModule, fontsModule] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]);
    const pdfMake = unwrapDefault(pdfModule) as typeof pdfModule;
    const fonts = unwrapDefault(fontsModule) as Record<string, unknown>;
    // vfs_fonts 0.2.x xuất thẳng object font (CommonJS); bản typings mô tả dạng { vfs }.
    const vfs = (('vfs' in fonts ? fonts['vfs'] : fonts) ?? {}) as Record<string, string>;
    const footer = this.footerText();
    pdfMake
      .createPdf(
        {
          pageSize: 'A4',
          pageMargins: [28, 32, 28, 40],
          defaultStyle: { font: 'Roboto', fontSize: 8.5 },
          styles: {
            title: { fontSize: 14, bold: true, margin: [0, 0, 0, 4] },
            subtitle: { fontSize: 9, color: '#555555' },
            ...definition.styles,
          },
          footer: (currentPage, pageCount) => ({
            columns: [
              { text: footer, fontSize: 7, color: '#777777' },
              {
                text: this.i18n.t('exports.page', { current: currentPage, total: pageCount }),
                alignment: 'right',
                fontSize: 7,
                color: '#777777',
              },
            ],
            margin: [28, 12, 28, 0],
          }),
          ...definition,
        },
        undefined,
        undefined,
        vfs,
      )
      .download(`${fileName}-${timestamp()}.pdf`);
  }

  private footerText(): string {
    return this.i18n.t('exports.generatedBy', {
      user: this.auth.user()?.fullName ?? '',
      time: formatDateVn(new Date().toISOString(), true),
    });
  }
}

function unwrapDefault(module: object): unknown {
  return 'default' in module && module.default ? module.default : module;
}

/**
 * Lấy toàn bộ bản ghi khớp bộ lọc hiện tại (lặp qua các trang, tối đa `limit`) để xuất file.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, size: number) => Observable<Page<T>>,
  limit = 10_000,
): Promise<T[]> {
  const size = 200;
  const items: T[] = [];
  for (let page = 1; items.length < limit; page++) {
    const result = await firstValueFrom(fetchPage(page, size));
    items.push(...result.items);
    if (items.length >= result.total || result.items.length < size) break;
  }
  return items.slice(0, limit);
}
