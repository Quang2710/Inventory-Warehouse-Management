import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';

import type { GoodsReceipt } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import { DOCUMENT_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { injectDocumentWorkflow } from '../../../shared/data-access/document-workflow';
import { ExportService, formatDateVn, formatMoney } from '../../../shared/export/export.service';
import { DocumentTimeline } from '../../../shared/ui/document-timeline/document-timeline';
import { ExpiryBadge } from '../../../shared/ui/expiry-badge/expiry-badge';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { GoodsReceiptsApi } from '../data-access/goods-receipts.api';

/** Số serial hiển thị trước khi thu gọn. */
const SERIAL_PREVIEW = 6;

@Component({
  selector: 'app-receipt-detail-page',
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    TranslatePipe,
    PageHeader,
    StatusChip,
    ExpiryBadge,
    DocumentTimeline,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './receipt-detail-page.html',
})
export class ReceiptDetailPage {
  private readonly api = inject(GoodsReceiptsApi);
  private readonly auth = inject(AuthStore);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  readonly receipt = input.required<GoodsReceipt>();
  protected readonly current = linkedSignal(() => this.receipt());
  protected readonly statusLabels = DOCUMENT_STATUS;
  protected readonly serialPreview = SERIAL_PREVIEW;
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly printing = signal(false);

  protected readonly workflow = injectDocumentWorkflow({
    api: this.api,
    current: this.current,
    listPath: '/goods-receipts',
    approveMessageKey: 'receipts.confirmApproveMessage',
    cancelHintKey: 'receipts.cancelHint',
  });

  private readonly inScope = computed(() =>
    this.auth.canAccessWarehouse(this.current().warehouseId),
  );
  private readonly canWrite = computed(
    () => this.inScope() && this.auth.hasPermission('goods-receipt:write'),
  );
  private readonly canApprove = computed(
    () => this.inScope() && this.auth.hasPermission('goods-receipt:approve'),
  );
  protected readonly editable = computed(
    () => this.canWrite() && ['DRAFT', 'REJECTED'].includes(this.current().status),
  );
  protected readonly deletable = computed(
    () => this.canWrite() && this.current().status === 'DRAFT',
  );
  protected readonly decidable = computed(
    () => this.canApprove() && this.current().status === 'PENDING',
  );
  protected readonly cancellable = computed(
    () => this.canApprove() && this.current().status === 'APPROVED',
  );
  protected readonly hasTracking = computed(() =>
    this.current().lines.some((line) => line.trackLot || line.trackExpiry || line.trackSerial),
  );

  protected toggleSerials(lineId: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  /** In phiếu nhập kho (PDF) — mẫu đơn giản có chữ ký người lập / thủ kho / người duyệt. */
  protected async print(): Promise<void> {
    const receipt = this.current();
    const t = (key: Parameters<I18nService['t']>[0]) => this.i18n.t(key);
    this.printing.set(true);
    try {
      await this.exporter.print(
        {
          content: [
            { text: t('receipts.printTitle'), style: 'title', alignment: 'center' },
            {
              text: `${receipt.code} · ${formatDateVn(receipt.receiptDate)}`,
              alignment: 'center',
              margin: [0, 0, 0, 12],
            },
            {
              columns: [
                [
                  `${t('receipts.fields.warehouse')}: ${receipt.warehouseName}`,
                  `${t('receipts.fields.supplier')}: ${receipt.supplierName}`,
                ],
                [
                  `${t('receipts.fields.referenceNo')}: ${receipt.referenceNo ?? '—'}`,
                  `${t('common.status')}: ${t(DOCUMENT_STATUS[receipt.status].labelKey)}`,
                ],
              ],
              margin: [0, 0, 0, 8],
            },
            {
              table: {
                headerRows: 1,
                widths: [18, '*', 70, 52, 34, 62, 72],
                body: [
                  [
                    '#',
                    t('documents.fields.product'),
                    t('lots.lotNumber'),
                    t('lots.expiryDate'),
                    t('common.quantity'),
                    t('receipts.fields.unitCost'),
                    t('documents.fields.amount'),
                  ].map((text) => ({ text, bold: true })),
                  ...receipt.lines.map((line, index) => [
                    String(index + 1),
                    {
                      stack: [
                        `${line.sku} — ${line.productName}`,
                        ...(line.serialNumbers?.length
                          ? [
                              {
                                text: `SN: ${line.serialNumbers.join(', ')}`,
                                fontSize: 7,
                                color: '#555555',
                              },
                            ]
                          : []),
                      ],
                    },
                    line.lotNumber ?? '',
                    formatDateVn(line.expiryDate),
                    { text: `${line.quantity} ${line.unit}`, alignment: 'right' as const },
                    { text: formatMoney(line.unitCost), alignment: 'right' as const },
                    { text: formatMoney(line.amount), alignment: 'right' as const },
                  ]),
                  [
                    { text: t('common.total'), colSpan: 4, bold: true },
                    '',
                    '',
                    '',
                    {
                      text: String(receipt.totalQuantity),
                      alignment: 'right' as const,
                      bold: true,
                    },
                    '',
                    {
                      text: formatMoney(receipt.totalAmount),
                      alignment: 'right' as const,
                      bold: true,
                    },
                  ],
                ],
              },
            },
            ...(receipt.note
              ? [
                  {
                    text: `${t('common.note')}: ${receipt.note}`,
                    margin: [0, 8, 0, 0] as [number, number, number, number],
                  },
                ]
              : []),
            {
              columns: [
                t('documents.signCreator'),
                t('documents.signKeeper'),
                t('documents.signApprover'),
              ].map((text) => ({ text, alignment: 'center' as const, bold: true })),
              margin: [0, 32, 0, 0],
            },
          ],
        },
        receipt.code,
      );
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.printing.set(false);
    }
  }
}
