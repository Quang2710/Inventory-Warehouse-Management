import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatSidenavModule } from '@angular/material/sidenav';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom, map } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { MODULE_ACCESS } from '../../core/auth/module-access';
import { DemoService } from '../../core/demo/demo.service';
import { I18nService } from '../../core/i18n/i18n.service';
import type { Language } from '../../core/i18n/i18n.types';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { NotificationService } from '../../core/notification/notification.service';
import { PwaService } from '../../core/pwa/pwa.service';
import { ThemeService, type ThemeMode } from '../../core/theme/theme.service';
import { AlertsStore } from '../../features/alerts/data-access/alerts.store';
import { ConfirmService } from '../../shared/ui/confirm-dialog/confirm.service';
import { Breadcrumb, buildBreadcrumbs } from '../breadcrumb/breadcrumb';
import { Header } from '../header/header';
import { visibleNavigation } from '../../core/navigation/navigation';
import { Sidebar } from '../sidebar/sidebar';

/** Khung ứng dụng sau đăng nhập: sidebar + header + breadcrumb + nội dung trang. */
@Component({
  selector: 'app-main-layout',
  imports: [MatSidenavModule, RouterOutlet, Header, Sidebar, Breadcrumb, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  private readonly demo = inject(DemoService);
  protected readonly auth = inject(AuthStore);
  protected readonly i18n = inject(I18nService);
  protected readonly theme = inject(ThemeService);
  protected readonly pwa = inject(PwaService);
  private readonly alerts = inject(AlertsStore);

  private readonly canSeeAlerts = computed(() => this.auth.canAccess(MODULE_ACCESS.alerts));
  protected readonly canScan = computed(() => this.auth.canAccess(MODULE_ACCESS.scan));
  protected readonly alertCount = computed(() =>
    this.canSeeAlerts() ? this.alerts.total() : null,
  );
  protected readonly alertCritical = this.alerts.critical;

  protected readonly demoMode = this.demo.enabled;

  constructor() {
    // Theo dõi cảnh báo khi người dùng có quyền xem tồn (đổi quyền → dừng / chạy lại).
    effect(() => {
      if (this.canSeeAlerts()) this.alerts.start();
      else this.alerts.stop();
    });
  }

  protected readonly isHandset = toSignal(
    inject(BreakpointObserver)
      .observe([Breakpoints.XSmall, Breakpoints.Small])
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  /** Trạng thái mở menu trên desktop (trên di động menu là lớp phủ, mặc định đóng). */
  private readonly desktopMenuOpen = signal(true);
  private readonly mobileMenuOpen = signal(false);
  protected readonly menuOpen = computed(() =>
    this.isHandset() ? this.mobileMenuOpen() : this.desktopMenuOpen(),
  );

  protected readonly navigation = computed(() =>
    visibleNavigation((access) => this.auth.canAccess(access)),
  );

  protected readonly breadcrumbs = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => buildBreadcrumbs(this.router.routerState.snapshot.root)),
    ),
    { initialValue: buildBreadcrumbs(this.router.routerState.snapshot.root) },
  );

  protected toggleMenu(): void {
    if (this.isHandset()) {
      this.mobileMenuOpen.update((open) => !open);
    } else {
      this.desktopMenuOpen.update((open) => !open);
    }
  }

  protected onMenuClosed(): void {
    this.mobileMenuOpen.set(false);
  }

  protected onNavigate(): void {
    if (this.isHandset()) {
      this.mobileMenuOpen.set(false);
    }
  }

  protected changeLanguage(language: Language): void {
    void this.i18n.use(language);
  }

  protected changeTheme(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }

  protected logout(): void {
    void this.auth.logout();
  }

  protected async resetDemo(): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t('demo.resetConfirmTitle'),
      message: this.i18n.t('demo.resetConfirmMessage'),
      confirmText: this.i18n.t('demo.resetConfirm'),
      cancelText: this.i18n.t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await firstValueFrom(this.demo.reset());
      // Dữ liệu (kể cả phiên đăng nhập) đã được tạo lại → đăng nhập lại.
      await this.auth.endSession('demo-reset');
    } catch (error) {
      this.notifications.error(error);
    }
  }
}
