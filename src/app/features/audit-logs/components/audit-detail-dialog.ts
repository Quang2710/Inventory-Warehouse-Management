import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

import type { AuditLog } from '../../../core/api';
import { AUDIT_ACTION_LABEL_KEYS, AUDIT_ENTITY_LABEL_KEYS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/** Chi tiết một bản ghi nhật ký kèm bảng thay đổi trước/sau. */
@Component({
  selector: 'app-audit-detail-dialog',
  imports: [DatePipe, MatDialogModule, MatButtonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'audit.detailTitle' | t }}</h2>
    <mat-dialog-content>
      <dl class="facts">
        <dt>{{ 'audit.fields.occurredAt' | t }}</dt>
        <dd>{{ entry.occurredAt | date: 'dd/MM/yyyy HH:mm:ss' }}</dd>
        <dt>{{ 'audit.fields.user' | t }}</dt>
        <dd>{{ entry.userName }}</dd>
        <dt>{{ 'audit.fields.action' | t }}</dt>
        <dd>{{ actionLabels[entry.action] | t }}</dd>
        <dt>{{ 'audit.fields.entityType' | t }}</dt>
        <dd>
          {{ entityLabels[entry.entityType] | t }}
          @if (entry.entityLabel) {
            · <span class="mono">{{ entry.entityLabel }}</span>
          }
        </dd>
        <dt>{{ 'audit.fields.summary' | t }}</dt>
        <dd>{{ entry.summary }}</dd>
        @if (entry.ipAddress) {
          <dt>{{ 'audit.fields.ipAddress' | t }}</dt>
          <dd class="mono">{{ entry.ipAddress }}</dd>
        }
        @if (entry.userAgent) {
          <dt>{{ 'audit.fields.userAgent' | t }}</dt>
          <dd class="agent">{{ entry.userAgent }}</dd>
        }
      </dl>

      <h3>{{ 'audit.fields.changes' | t }}</h3>
      @if (entry.changes.length === 0) {
        <p class="muted">{{ 'audit.noChanges' | t }}</p>
      } @else {
        <table class="changes">
          <thead>
            <tr>
              <th scope="col">{{ 'audit.fields.field' | t }}</th>
              <th scope="col">{{ 'audit.fields.before' | t }}</th>
              <th scope="col">{{ 'audit.fields.after' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (change of entry.changes; track change.field) {
              <tr>
                <th scope="row" class="mono">{{ change.field }}</th>
                <td class="before">{{ change.from ?? '—' }}</td>
                <td class="after">{{ change.to ?? '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">{{ 'common.close' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 16px;
      margin: 0 0 16px;
    }
    dt {
      color: var(--mat-sys-on-surface-variant);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .agent {
      font: var(--mat-sys-body-small);
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 8px 0;
    }
    .changes {
      width: 100%;
      border-collapse: collapse;
    }
    .changes th,
    .changes td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    .before {
      color: var(--mat-sys-error);
    }
    .after {
      color: var(--mat-sys-tertiary);
    }
  `,
})
export class AuditDetailDialog {
  protected readonly entry = inject<AuditLog>(MAT_DIALOG_DATA);
  protected readonly actionLabels = AUDIT_ACTION_LABEL_KEYS;
  protected readonly entityLabels = AUDIT_ENTITY_LABEL_KEYS;
}
