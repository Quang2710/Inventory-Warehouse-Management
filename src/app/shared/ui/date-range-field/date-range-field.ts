import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { fromLocalDate, pickerDateToApi } from '../../forms/date-utils';

export interface DateRange {
  from: string | null;
  to: string | null;
}

/** Chọn khoảng ngày `dd/MM/yyyy`; phát `YYYY-MM-DD` (định dạng API) khi đủ hai đầu hoặc xóa. */
@Component({
  selector: 'app-date-range-field',
  imports: [MatFormFieldModule, MatInputModule, MatDatepickerModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field subscriptSizing="dynamic" class="field">
      <mat-label>{{ label() ?? ('common.dateRange' | t) }}</mat-label>
      <mat-date-range-input [rangePicker]="picker" [max]="max()">
        <input
          matStartDate
          [value]="start()"
          (dateChange)="pending.from = $event.value"
          [placeholder]="'common.fromDate' | t"
        />
        <input
          matEndDate
          [value]="end()"
          (dateChange)="emit($event.value)"
          [placeholder]="'common.toDate' | t"
        />
      </mat-date-range-input>
      <mat-datepicker-toggle matIconSuffix [for]="picker" />
      <mat-date-range-picker #picker />
    </mat-form-field>
  `,
  styles: `
    .field {
      width: 270px;
      max-width: 100%;
    }
  `,
})
export class DateRangeField {
  readonly from = input<string | null>(null);
  readonly to = input<string | null>(null);
  readonly label = input<string>();
  readonly maxDate = input<string | null>(null);
  readonly rangeChange = output<DateRange>();

  protected readonly start = computed(() => fromLocalDate(this.from()));
  protected readonly end = computed(() => fromLocalDate(this.to()));
  protected readonly max = computed(() => fromLocalDate(this.maxDate()));
  protected readonly pending: { from: Date | null } = { from: null };

  protected emit(end: Date | null): void {
    const start = this.pending.from ?? this.start();
    this.pending.from = null;
    if (!end && !start) {
      this.rangeChange.emit({ from: null, to: null });
    } else if (start && end) {
      this.rangeChange.emit({ from: pickerDateToApi(start), to: pickerDateToApi(end) });
    }
  }
}
