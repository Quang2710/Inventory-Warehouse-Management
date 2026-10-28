import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { CameraScanner } from '../barcode-scanner/camera-scanner';

export interface SerialEntryData {
  /** "SKU — tên" hiển thị ở tiêu đề. */
  product: string;
  /** Số serial cần nhập (= số lượng của dòng). */
  quantity: number;
  serials: readonly string[];
  /** Phiếu xuất: các serial đang tồn có thể chọn; serial ngoài danh sách bị đánh dấu. */
  available?: readonly string[];
}

const SERIAL_PATTERN = /^[A-Za-z0-9._/-]{1,64}$/;

/** Nhập danh sách serial cho một dòng chứng từ: gõ, dán nhiều dòng, quét liên tục, chọn từ tồn. */
@Component({
  selector: 'app-serial-entry-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    TranslatePipe,
    CameraScanner,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'serials.entryTitle' | t: { product: data.product } }}</h2>
    <mat-dialog-content>
      <p class="count" [class.count--ok]="serials().length === data.quantity" role="status">
        {{ 'serials.entered' | t: { count: serials().length, quantity: data.quantity } }}
      </p>
      <form class="add" (submit)="$event.preventDefault(); addFromInput()">
        <mat-form-field class="add__field">
          <mat-label>{{ 'serials.inputLabel' | t }}</mat-label>
          <textarea
            matInput
            [formControl]="input"
            rows="2"
            (keydown.enter)="$event.preventDefault(); addFromInput()"
            [placeholder]="'serials.inputHint' | t"
          ></textarea>
        </mat-form-field>
        <button mat-stroked-button type="submit">{{ 'serials.add' | t }}</button>
        <button
          mat-icon-button
          type="button"
          (click)="camera.set(!camera())"
          [attr.aria-pressed]="camera()"
          [attr.aria-label]="'scanner.title' | t"
          [matTooltip]="'scanner.title' | t"
        >
          <mat-icon>photo_camera</mat-icon>
        </button>
      </form>
      @if (camera()) {
        <app-camera-scanner class="camera" (detected)="add([$event])" />
      }
      @if (problem(); as message) {
        <p class="problem" role="alert">{{ message }}</p>
      }
      <ul class="chips" [attr.aria-label]="'serials.title' | t">
        @for (serial of serials(); track serial) {
          <li [class.invalid]="!isAvailable(serial)">
            <span class="mono">{{ serial }}</span>
            <button
              mat-icon-button
              type="button"
              (click)="remove(serial)"
              [attr.aria-label]="'serials.remove' | t: { serial }"
            >
              <mat-icon>close</mat-icon>
            </button>
          </li>
        }
      </ul>
      @if (data.available?.length) {
        <details class="available">
          <summary>{{ 'serials.pickFromStock' | t: { count: data.available!.length } }}</summary>
          <div class="available__list">
            @for (serial of data.available; track serial) {
              <mat-checkbox [checked]="selected().has(serial)" (change)="toggle(serial)">
                <span class="mono">{{ serial }}</span>
              </mat-checkbox>
            }
          </div>
        </details>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        type="button"
        (click)="serials.set([])"
        [disabled]="serials().length === 0"
      >
        {{ 'serials.clear' | t }}
      </button>
      <button mat-button type="button" mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button type="button" (click)="ref.close(serials())">
        {{ 'common.confirm' | t }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .count {
      margin-top: 0;
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-error);
    }
    .count--ok {
      color: inherit;
    }
    .add {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .add__field {
      flex: 1;
    }
    .camera {
      display: block;
      max-width: 420px;
      margin-bottom: 8px;
    }
    .problem {
      color: var(--mat-sys-error);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chips li {
      display: inline-flex;
      align-items: center;
      padding-left: 8px;
      border-radius: var(--mat-sys-corner-small);
      background: var(--mat-sys-surface-container-high);
    }
    .chips li.invalid {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .available {
      margin-top: 12px;
    }
    .available__list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      max-height: 240px;
      overflow: auto;
    }
  `,
})
export class SerialEntryDialog {
  private readonly i18n = inject(I18nService);
  protected readonly data = inject<SerialEntryData>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<SerialEntryDialog, string[]>>(MatDialogRef);

  protected readonly input = new FormControl('', { nonNullable: true });
  protected readonly serials = signal<string[]>([...this.data.serials]);
  protected readonly selected = computed(() => new Set(this.serials()));
  protected readonly camera = signal(false);
  protected readonly problem = signal<string | null>(null);
  private readonly availableSet = this.data.available ? new Set(this.data.available) : null;

  protected isAvailable(serial: string): boolean {
    return !this.availableSet || this.availableSet.has(serial);
  }

  protected addFromInput(): void {
    this.add(this.input.value.split(/[\s,;]+/));
    this.input.setValue('');
  }

  protected add(values: readonly string[]): void {
    const current = new Set(this.serials());
    const invalid: string[] = [];
    let duplicate = 0;
    for (const raw of values) {
      const serial = raw.trim();
      if (!serial) continue;
      if (!SERIAL_PATTERN.test(serial)) invalid.push(serial);
      else if (current.has(serial)) duplicate++;
      else current.add(serial);
    }
    this.serials.set([...current]);
    const messages: string[] = [];
    if (invalid.length) {
      messages.push(this.i18n.t('serials.invalidValues', { values: invalid.join(', ') }));
    }
    if (duplicate) messages.push(this.i18n.t('serials.duplicates', { count: duplicate }));
    this.problem.set(messages.length ? messages.join(' · ') : null);
  }

  protected remove(serial: string): void {
    this.serials.update((list) => list.filter((item) => item !== serial));
  }

  protected toggle(serial: string): void {
    if (this.selected().has(serial)) this.remove(serial);
    else this.add([serial]);
  }
}
