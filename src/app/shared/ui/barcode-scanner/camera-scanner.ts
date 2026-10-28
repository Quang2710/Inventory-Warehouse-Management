import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BarcodeFormat } from '@zxing/library';
import { ZXingScannerModule } from '@zxing/ngx-scanner';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { BrowserStorage } from '../../../core/storage/browser-storage';

const CAMERA_KEY = 'iwm.scanner.camera';

/** Phản hồi khi quét được: rung (điện thoại) + tiếng bíp ngắn. */
function feedback(): void {
  try {
    navigator.vibrate?.(60);
  } catch {
    // trình duyệt không hỗ trợ rung
  }
  try {
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 1760;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    oscillator.onended = () => void context.close();
  } catch {
    // không có âm thanh — bỏ qua
  }
}

/**
 * Khung quét mã vạch / QR bằng camera (@zxing/ngx-scanner): chọn camera (ghi nhớ), bật đèn
 * flash nếu thiết bị hỗ trợ, chống đọc trùng trong `cooldownMs`. Chỉ phát mã ra ngoài.
 */
@Component({
  selector: 'app-camera-scanner',
  imports: [
    ZXingScannerModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (problem(); as key) {
      <p class="problem" role="alert">
        <mat-icon aria-hidden="true">no_photography</mat-icon>{{ key | t }}
      </p>
    } @else {
      <div class="frame" [class.frame--hit]="hit()">
        <zxing-scanner
          [enable]="active()"
          [device]="device()"
          [torch]="torch()"
          [formats]="formats"
          [tryHarder]="true"
          [timeBetweenScans]="250"
          (camerasFound)="onCameras($event)"
          (camerasNotFound)="problem.set('scanner.noCamera')"
          (permissionResponse)="!$event && problem.set('scanner.permissionDenied')"
          (torchCompatible)="torchAvailable.set($event)"
          (scanSuccess)="onScan($event)"
        />
        <span class="frame__guide" aria-hidden="true"></span>
      </div>
      <div class="controls">
        @if (cameras().length > 1) {
          <mat-select
            class="camera-select"
            [value]="device()?.deviceId"
            (valueChange)="selectCamera($event)"
            [attr.aria-label]="'scanner.camera' | t"
          >
            @for (camera of cameras(); track camera.deviceId) {
              <mat-option [value]="camera.deviceId">{{
                camera.label || ('scanner.camera' | t)
              }}</mat-option>
            }
          </mat-select>
        }
        @if (torchAvailable()) {
          <button
            mat-icon-button
            type="button"
            (click)="torch.set(!torch())"
            [attr.aria-pressed]="torch()"
            [attr.aria-label]="'scanner.torch' | t"
            [matTooltip]="'scanner.torch' | t"
          >
            <mat-icon>{{ torch() ? 'flashlight_off' : 'flashlight_on' }}</mat-icon>
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .frame {
      position: relative;
      overflow: hidden;
      border-radius: var(--mat-sys-corner-medium);
      background: #000;
      outline: 3px solid transparent;
      transition: outline-color 120ms;
    }
    .frame--hit {
      outline-color: var(--app-success, #2e7d32);
    }
    .frame__guide {
      position: absolute;
      inset: 30% 12%;
      border: 2px solid rgb(255 255 255 / 70%);
      border-radius: 8px;
      pointer-events: none;
    }
    zxing-scanner {
      display: block;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }
    .camera-select {
      flex: 1;
    }
    .problem {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-error);
    }
  `,
})
export class CameraScanner {
  private readonly storage = inject(BrowserStorage);

  readonly active = input(true);
  /** Bỏ qua cùng một mã quét lại trong khoảng này (ms). */
  readonly cooldownMs = input(1500);
  readonly detected = output<string>();

  protected readonly formats = [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
  ];
  protected readonly cameras = signal<MediaDeviceInfo[]>([]);
  private readonly selectedId = signal<string | null>(this.storage.get(CAMERA_KEY));
  protected readonly device = computed<MediaDeviceInfo | undefined>(() => {
    const cameras = this.cameras();
    return (
      cameras.find((camera) => camera.deviceId === this.selectedId()) ??
      // Ưu tiên camera sau trên điện thoại.
      cameras.find((camera) => /back|rear|environment|sau/i.test(camera.label)) ??
      cameras[0]
    );
  });
  protected readonly torch = signal(false);
  protected readonly torchAvailable = signal(false);
  protected readonly problem = signal<'scanner.noCamera' | 'scanner.permissionDenied' | null>(null);
  protected readonly hit = signal(false);
  private last: { code: string; at: number } | null = null;

  protected onCameras(cameras: MediaDeviceInfo[]): void {
    this.cameras.set(cameras);
  }

  protected selectCamera(deviceId: string): void {
    this.selectedId.set(deviceId);
    this.storage.set(CAMERA_KEY, deviceId);
  }

  protected onScan(raw: string): void {
    const code = raw.trim();
    const now = Date.now();
    if (!code || (this.last?.code === code && now - this.last.at < this.cooldownMs())) return;
    this.last = { code, at: now };
    feedback();
    this.hit.set(true);
    setTimeout(() => this.hit.set(false), 300);
    this.detected.emit(code);
  }
}
