import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/** Ô tìm kiếm có debounce 300ms dùng cho bộ lọc danh sách. */
@Component({
  selector: 'app-search-field',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field subscriptSizing="dynamic" class="field">
      <mat-icon matPrefix aria-hidden="true">search</mat-icon>
      <mat-label>{{ 'common.search' | t }}</mat-label>
      <input matInput type="search" [formControl]="control" [placeholder]="placeholder()" />
      @if (control.value) {
        <button
          mat-icon-button
          matSuffix
          type="button"
          (click)="control.setValue('')"
          [attr.aria-label]="'common.clearFilters' | t"
        >
          <mat-icon>close</mat-icon>
        </button>
      }
    </mat-form-field>
  `,
  styles: `
    :host {
      display: block;
      flex: 1 1 260px;
      max-width: 420px;
    }
    .field {
      width: 100%;
    }
  `,
})
export class SearchField {
  readonly value = input('');
  readonly placeholder = input('');
  readonly queryChange = output<string>();

  protected readonly control = new FormControl('', { nonNullable: true });

  constructor() {
    effect(() => {
      const value = this.value();
      if (value !== this.control.value.trim()) {
        this.control.setValue(value, { emitEvent: false });
      }
    });
    this.control.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((value) => this.queryChange.emit(value));
  }
}
