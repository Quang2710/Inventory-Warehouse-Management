import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { FieldErrorPipe } from '../../forms/field-error.pipe';

export interface PromptDialogData {
  title: string;
  message?: string;
  label: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
  /** Mặc định ô nhiều dòng; `password` cho nhập mật khẩu. */
  inputType?: 'multiline' | 'password';
  minLength?: number;
}

/** Hộp thoại nhập một nội dung bắt buộc (vd lý do hủy). Trả về chuỗi hoặc `undefined` nếu bỏ qua. */
@Component({
  selector: 'app-prompt-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    FieldErrorPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form (submit)="$event.preventDefault(); submit()">
      <mat-dialog-content>
        @if (data.message) {
          <p>{{ data.message }}</p>
        }
        <mat-form-field class="field">
          <mat-label>{{ data.label }}</mat-label>
          @if (data.inputType === 'password') {
            <input
              matInput
              type="password"
              autocomplete="new-password"
              [formControl]="value"
              cdkFocusInitial
            />
          } @else {
            <textarea matInput [formControl]="value" rows="3" cdkFocusInitial></textarea>
          }
          <mat-error>{{ value | fieldError }}</mat-error>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>{{ data.cancelText }}</button>
        <button mat-flat-button type="submit" [class.destructive]="data.destructive">
          {{ data.confirmText }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .field {
      width: 100%;
    }
    .destructive {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class PromptDialog {
  protected readonly data = inject<PromptDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<PromptDialog, string>>(MatDialogRef);
  protected readonly value = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.maxLength(500),
      Validators.minLength(this.data.minLength ?? 0),
    ],
  });

  protected submit(): void {
    if (!this.value.value.trim()) {
      this.value.setErrors({ required: true });
    }
    if (this.value.invalid) {
      this.value.markAsTouched();
      return;
    }
    this.ref.close(this.value.value.trim());
  }
}
