import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import type { ExportFormat } from '../../export/export.service';

/** Nút "Xuất file" (Excel / PDF) theo bộ lọc hiện tại của màn hình. */
@Component({
  selector: 'app-export-menu',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatProgressSpinnerModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      mat-stroked-button
      type="button"
      [matMenuTriggerFor]="menu"
      [disabled]="busy() || disabled()"
      [attr.aria-busy]="busy()"
    >
      @if (busy()) {
        <mat-progress-spinner mode="indeterminate" diameter="18" />
      } @else {
        <mat-icon>download</mat-icon>
      }
      {{ (busy() ? 'exports.exporting' : 'exports.export') | t }}
    </button>
    <mat-menu #menu="matMenu">
      <button mat-menu-item type="button" (click)="export.emit('xlsx')">
        <mat-icon>table_view</mat-icon>
        <span>{{ 'exports.excel' | t }}</span>
      </button>
      <button mat-menu-item type="button" (click)="export.emit('pdf')">
        <mat-icon>picture_as_pdf</mat-icon>
        <span>{{ 'exports.pdf' | t }}</span>
      </button>
    </mat-menu>
  `,
  styles: `
    mat-progress-spinner {
      display: inline-block;
      margin-right: 8px;
      vertical-align: middle;
    }
  `,
})
export class ExportMenu {
  readonly busy = input(false);
  readonly disabled = input(false);
  readonly export = output<ExportFormat>();
}
