import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import type { DocumentAudit } from '../../../core/api';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

interface TimelineEntry {
  labelKey: TranslationKey;
  icon: string;
  at: string;
  by?: string;
  note?: string;
}

/** Lịch sử xử lý chứng từ: tạo → gửi duyệt → duyệt / từ chối → hủy. */
@Component({
  selector: 'app-document-timeline',
  imports: [DatePipe, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'doc-card doc-timeline' },
  template: `
    <h2>{{ 'documents.timeline.title' | t }}</h2>
    <ol>
      @for (entry of entries(); track entry.labelKey) {
        <li>
          <mat-icon aria-hidden="true">{{ entry.icon }}</mat-icon>
          <div>
            <strong>{{ entry.labelKey | t }}</strong>
            <span class="doc-muted"
              >{{ entry.at | date: 'dd/MM/yyyy HH:mm' }}{{ entry.by ? ' · ' + entry.by : '' }}</span
            >
            @if (entry.note) {
              <span class="note">{{ entry.note }}</span>
            }
          </div>
        </li>
      }
    </ol>
  `,
})
export class DocumentTimeline {
  readonly document = input.required<DocumentAudit>();

  protected readonly entries = computed<TimelineEntry[]>(() => {
    const doc = this.document();
    const entries: TimelineEntry[] = [
      {
        labelKey: 'documents.timeline.created',
        icon: 'edit_note',
        at: doc.createdAt,
        by: doc.createdBy.fullName,
      },
    ];
    if (doc.submittedAt) {
      entries.push({ labelKey: 'documents.timeline.submitted', icon: 'send', at: doc.submittedAt });
    }
    if (doc.rejectedAt) {
      entries.push({
        labelKey: 'documents.timeline.rejected',
        icon: 'block',
        at: doc.rejectedAt,
        by: doc.rejectedBy?.fullName,
        note: doc.rejectedReason,
      });
    }
    if (doc.approvedAt) {
      entries.push({
        labelKey: 'documents.timeline.approved',
        icon: 'task_alt',
        at: doc.approvedAt,
        by: doc.approvedBy?.fullName,
      });
    }
    if (doc.cancelledAt) {
      entries.push({
        labelKey: 'documents.timeline.cancelled',
        icon: 'cancel',
        at: doc.cancelledAt,
        by: doc.cancelledBy?.fullName,
        note: doc.cancelReason,
      });
    }
    return entries;
  });
}
