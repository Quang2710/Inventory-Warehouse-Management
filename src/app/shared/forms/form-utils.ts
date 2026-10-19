import type { AbstractControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';

import { isApiError } from '../../core/http/api-error';

/** Số nguyên (bỏ qua giá trị rỗng — dùng kèm `Validators.required` nếu bắt buộc). */
export const integerValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  return value === null || value === '' || Number.isInteger(Number(value))
    ? null
    : { integer: true };
};

/**
 * Gắn lỗi theo field từ response 422 (`details`) vào form. Đường dẫn `lines.0.quantity`
 * khớp với FormArray `lines`; `mapPath` đổi tên trường contract → tên control nếu khác.
 * Trả `true` nếu có ít nhất một lỗi được gắn.
 */
export function applyServerErrors(
  form: FormGroup,
  error: unknown,
  mapPath: (path: string) => string = (path) => path,
): boolean {
  if (!isApiError(error) || error.status !== 422) {
    return false;
  }
  let applied = false;
  for (const [path, messages] of Object.entries(error.details)) {
    const control = form.get(mapPath(path));
    if (control && messages.length > 0) {
      control.setErrors({ ...control.errors, server: messages[0] });
      control.markAsTouched();
      applied = true;
    }
  }
  return applied;
}

/** Chuỗi rỗng → `undefined` (trường tùy chọn của contract). */
export function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
