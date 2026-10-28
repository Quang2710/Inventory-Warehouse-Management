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
import { firstValueFrom } from 'rxjs';

import type { GoodsIssue, StockPick } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { DOCUMENT_STATUS, ISSUE_REASON_LABEL_KEYS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { injectDocumentWorkflow } from '../../../shared/data-access/document-workflow';
import { ExportService, formatDateVn, formatMoney } from '../../../shared/export/export.service';
import { DocumentTimeline } from '../../../shared/ui/document-timeline/document-timeline';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { StockPicks } from '../../../shared/ui/stock-picks/stock-picks';
import { GoodsIssuesApi } from '../data-access/goods-issues.api';

interface PickingRow {
  locationCode: string;
  sku: string;
  productName: string;
  unit: string;
  lotNumber: string;
  expiryDate: string;
  quantity: number;
  serials: string;
}

@Component({
  selector: 'app-issue-detail-page',
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
    StockPicks,
    DocumentTimeline,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './issue-detail-page.html',
})
export class IssueDetailPage {
  private readonly api = inject(GoodsIssuesApi);
  private readonly auth = inject(AuthStore);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  readonly issue = input.required<GoodsIssue>();
  protected readonly current = linkedSignal(() => this.issue());
  protected readonly statusLabels = DOCUMENT_STATUS;
  protected readonly reasonLabels = ISSUE_REASON_LABEL_KEYS;
  protected readonly printing = signal(false);

  protected readonly workflow = injectDocumentWorkflow({
    api: this.api,
    current: this.current,
    listPath: '/goods-issues',
    approveMessageKey: 'issues.confirmApproveMessage',
    cancelHintKey: 'issues.cancelHint',
  });

  private readonly inScope = computed(() =>
    this.auth.canAccessWarehouse(this.current().warehouseId),
  );
  private readonly canWrite = computed(
    () => this.inScope() && this.auth.hasPermission('goods-issue:write'),
  );
  private readonly canApprove = computed(
    () => this.inScope() && this.auth.hasPermission('goods-issue:approve'),
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
  protected readonly canPick = computed(() =>
    ['DRAFT', 'PENDING', 'APPROVED'].includes(this.current().status),
  );
  protected readonly costTotal = computed(() =>
    this.current().lines.reduce((sum, line) => sum + line.quantity * (line.unitCost ?? 0), 0),
  );

  private t(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  /** Phiếu lấy hàng: phiếu đã duyệt dùng phần đã lấy; phiếu chưa duyệt dùng gợi ý FEFO hiện tại. */
  protected async printPickingList(): Promise<void> {
    const issue = this.current();
    this.printing.set(true);
    try {
      let picksByLine: StockPick[][];
      if (issue.status === 'APPROVED') {
        picksByLine = issue.lines.map((line) => line.picks);
      } else {
        const preview = await firstValueFrom(
          this.api.previewAllocation({
            warehouseId: issue.warehouseId,
            reason: issue.reason,
            lines: issue.lines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              lotNumber: line.lotNumber ?? null,
              ...(line.serialNumbers?.length ? { serialNumbers: line.serialNumbers } : {}),
            })),
          }),
        );
        picksByLine = preview.lines.map((line) => line.picks);
      }
      const rows: PickingRow[] = issue.lines
        .flatMap((line, index) =>
          (picksByLine[index] ?? []).map((pick) => ({
            locationCode: pick.locationCode ?? '—',
            sku: line.sku,
            productName: line.productName,
            unit: line.unit,
            lotNumber: pick.lotNumber ?? '',
            expiryDate: formatDateVn(pick.expiryDate),
            quantity: pick.quantity,
            serials: pick.serialNumbers?.join(', ') ?? '',
          })),
        )
        // Đi theo thứ tự ô trong kho để giảm quãng đường lấy hàng.
        .sort((a, b) => a.locationCode.localeCompare(b.locationCode, 'vi', { numeric: true }));
      await this.exporter.print(
        {
          content: [
            { text: this.t('issues.pickingTitle'), style: 'title' },
            {
              text: `${issue.code} · ${issue.warehouseName} · ${formatDateVn(issue.issueDate)} · ${issue.customerName}`,
              style: 'subtitle',
            },
            ...(issue.status !== 'APPROVED'
              ? [{ text: this.t('issues.pickingDraftNote'), style: 'subtitle', italics: true }]
              : []),
            { text: ' ', fontSize: 4 },
            {
              table: {
                headerRows: 1,
                widths: [60, '*', 64, 52, 40, 90, 36],
                body: [
                  [
                    this.t('documents.fields.location'),
                    this.t('documents.fields.product'),
                    this.t('lots.lotNumber'),
                    this.t('lots.expiryDate'),
                    this.t('common.quantity'),
                    this.t('serials.title'),
                    this.t('issues.pickedColumn'),
                  ].map((text) => ({ text, bold: true })),
                  ...rows.map((row) => [
                    { text: row.locationCode, bold: true },
                    `${row.sku} — ${row.productName}`,
                    row.lotNumber,
                    row.expiryDate,
                    { text: `${row.quantity} ${row.unit}`, alignment: 'right' as const },
                    { text: row.serials, fontSize: 7 },
                    '',
                  ]),
                ],
              },
            },
            {
              columns: [this.t('documents.signPicker'), this.t('documents.signKeeper')].map(
                (text) => ({
                  text,
                  alignment: 'center' as const,
                  bold: true,
                }),
              ),
              margin: [0, 32, 0, 0],
            },
          ],
        },
        `${issue.code}-lay-hang`,
      );
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.printing.set(false);
    }
  }

  protected async printIssue(): Promise<void> {
    const issue = this.current();
    this.printing.set(true);
    try {
      await this.exporter.print(
        {
          content: [
            { text: this.t('issues.printTitle'), style: 'title', alignment: 'center' },
            {
              text: `${issue.code} · ${formatDateVn(issue.issueDate)}`,
              alignment: 'center',
              margin: [0, 0, 0, 12],
            },
            {
              columns: [
                [
                  `${this.t('issues.fields.warehouse')}: ${issue.warehouseName}`,
                  `${this.t('issues.fields.customer')}: ${issue.customerName}`,
                ],
                [
                  `${this.t('issues.fields.reason')}: ${this.t(ISSUE_REASON_LABEL_KEYS[issue.reason])}`,
                  `${this.t('issues.fields.referenceNo')}: ${issue.referenceNo ?? '—'}`,
                ],
              ],
              margin: [0, 0, 0, 8],
            },
            {
              table: {
                headerRows: 1,
                widths: [18, '*', 110, 40, 62, 72],
                body: [
                  [
                    '#',
                    this.t('documents.fields.product'),
                    this.t('issues.fields.picks'),
                    this.t('common.quantity'),
                    this.t('issues.fields.unitPrice'),
                    this.t('documents.fields.amount'),
                  ].map((text) => ({ text, bold: true })),
                  ...issue.lines.map((line, index) => [
                    String(index + 1),
                    `${line.sku} — ${line.productName}`,
                    {
                      text: line.picks
                        .map((pick) =>
                          [
                            pick.lotNumber,
                            pick.expiryDate && formatDateVn(pick.expiryDate),
                            `×${pick.quantity}`,
                          ]
                            .filter(Boolean)
                            .join(' '),
                        )
                        .join('\n'),
                      fontSize: 7,
                    },
                    { text: `${line.quantity} ${line.unit}`, alignment: 'right' as const },
                    { text: formatMoney(line.unitPrice), alignment: 'right' as const },
                    { text: formatMoney(line.amount), alignment: 'right' as const },
                  ]),
                  [
                    { text: this.t('common.total'), colSpan: 3, bold: true },
                    '',
                    '',
                    { text: String(issue.totalQuantity), alignment: 'right' as const, bold: true },
                    '',
                    {
                      text: formatMoney(issue.totalAmount),
                      alignment: 'right' as const,
                      bold: true,
                    },
                  ],
                ],
              },
            },
            {
              columns: [
                this.t('documents.signCreator'),
                this.t('documents.signKeeper'),
                this.t('documents.signReceiver'),
              ].map((text) => ({ text, alignment: 'center' as const, bold: true })),
              margin: [0, 32, 0, 0],
            },
          ],
        },
        issue.code,
      );
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.printing.set(false);
    }
  }
}
