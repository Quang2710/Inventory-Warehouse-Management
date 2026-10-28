import { ApplicationRef, DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { filter, first, interval } from 'rxjs';

import { I18nService } from '../i18n/i18n.service';

/** Sự kiện `beforeinstallprompt` (Chromium) — chưa có trong lib.dom. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Kiểm tra bản mới mỗi 6 giờ khi ứng dụng mở lâu (máy quầy, tablet kho). */
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

/**
 * PWA: báo có phiên bản mới (bấm "Tải lại"), cài ứng dụng lên màn hình chính, khôi phục khi
 * cache hỏng. Không làm gì nếu service worker bị tắt (dev server, trình duyệt không hỗ trợ).
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly updates = inject(SwUpdate);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);
  private readonly appRef = inject(ApplicationRef);
  private readonly document = inject(DOCUMENT);

  private installPrompt: InstallPromptEvent | null = null;
  /** Trình duyệt cho phép cài ứng dụng và người dùng chưa cài. */
  readonly installable = signal(false);

  init(): void {
    const window = this.document.defaultView;
    window?.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installPrompt = event as InstallPromptEvent;
      this.installable.set(true);
    });
    window?.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.installable.set(false);
    });

    if (!this.updates.isEnabled) return;
    this.updates.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => this.promptReload());
    this.updates.unrecoverable.subscribe(() => {
      this.snackBar
        .open(this.i18n.t('pwa.unrecoverable'), this.i18n.t('pwa.reload'), {
          panelClass: ['app-snackbar', 'app-snackbar--error'],
        })
        .onAction()
        .subscribe(() => this.document.location.reload());
    });
    // Chờ ứng dụng ổn định rồi mới kiểm tra định kỳ (không cản trở lần tải đầu).
    this.appRef.isStable.pipe(first((stable) => stable)).subscribe(() => {
      interval(UPDATE_CHECK_MS).subscribe(
        () => void this.updates.checkForUpdate().catch(() => false),
      );
    });
  }

  async install(): Promise<void> {
    const prompt = this.installPrompt;
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      this.installPrompt = null;
      this.installable.set(false);
    }
  }

  private promptReload(): void {
    this.snackBar
      .open(this.i18n.t('pwa.updateReady'), this.i18n.t('pwa.reload'), {
        panelClass: ['app-snackbar', 'app-snackbar--success'],
      })
      .onAction()
      .subscribe(() => {
        void this.updates.activateUpdate().finally(() => this.document.location.reload());
      });
  }
}
