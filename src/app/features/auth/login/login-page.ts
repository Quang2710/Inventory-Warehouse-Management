import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import type { Role } from '../../../core/api';
import { AuthStore, type SessionEndReason } from '../../../core/auth/auth.store';
import type { DemoAccount } from '../../../core/demo/demo.models';
import { DemoService } from '../../../core/demo/demo.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { Language, TranslationKey } from '../../../core/i18n/i18n.types';
import { LANGUAGE_LABEL_KEYS, ROLE_LABEL_KEYS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { THEME_MODES, ThemeService } from '../../../core/theme/theme.service';

const REASON_NOTICES: Readonly<Record<SessionEndReason, TranslationKey>> = {
  expired: 'auth.login.sessionExpired',
  logout: 'auth.login.loggedOut',
  'demo-reset': 'auth.login.demoReset',
};

const ROLE_ICONS: Readonly<Record<Role, string>> = {
  ADMIN: 'admin_panel_settings',
  WAREHOUSE_MANAGER: 'supervisor_account',
  WAREHOUSE_STAFF: 'forklift',
  ACCOUNTANT: 'calculate',
};

const THEME_ICONS = { light: 'light_mode', dark: 'dark_mode', system: 'brightness_auto' } as const;

/** Chỉ cho phép quay lại URL nội bộ (chống open redirect). */
function safeReturnUrl(url: string | undefined): string {
  const internal = !!url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
  return internal && !url.startsWith('/login') ? url : '/';
}

@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly demo = inject(DemoService);
  protected readonly i18n = inject(I18nService);
  protected readonly theme = inject(ThemeService);

  /** Query param (withComponentInputBinding): URL quay lại sau khi đăng nhập. */
  readonly returnUrl = input<string>();
  /** Query param: lý do về trang đăng nhập (hết phiên, đăng xuất, reset demo). */
  readonly reason = input<string>();

  protected readonly form = inject(NonNullableFormBuilder).group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  protected readonly submitting = signal(false);
  protected readonly passwordVisible = signal(false);
  private readonly loginError = signal<unknown>(null);
  protected readonly errorMessage = computed(() => {
    const error = this.loginError();
    return error ? this.i18n.errorMessage(error) : null;
  });
  protected readonly notice = computed(() => {
    const reason = this.reason();
    return reason && reason in REASON_NOTICES ? REASON_NOTICES[reason as SessionEndReason] : null;
  });

  protected readonly demoEnabled = this.demo.enabled;
  protected readonly demoAccounts = toSignal(
    this.demoEnabled
      ? this.demo.getAccounts().pipe(catchError(() => of<DemoAccount[]>([])))
      : of([]),
    { initialValue: [] as DemoAccount[] },
  );

  protected readonly roleLabels = ROLE_LABEL_KEYS;
  protected readonly roleIcons = ROLE_ICONS;
  protected readonly languageLabels = LANGUAGE_LABEL_KEYS;
  protected readonly themeIcon = computed(() => THEME_ICONS[this.theme.mode()]);

  private readonly usernameInput =
    viewChild.required<ElementRef<HTMLInputElement>>('usernameInput');

  constructor() {
    afterNextRender(() => this.usernameInput().nativeElement.focus());
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.loginError.set(null);
    try {
      await this.auth.login(this.form.getRawValue());
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (error) {
      this.loginError.set(error);
      this.form.controls.password.reset();
    } finally {
      this.submitting.set(false);
    }
  }

  protected loginAs(account: DemoAccount): void {
    this.form.setValue({ username: account.username, password: account.password });
    void this.submit();
  }

  protected changeLanguage(language: Language): void {
    void this.i18n.use(language);
  }

  protected cycleTheme(): void {
    const index = THEME_MODES.indexOf(this.theme.mode());
    this.theme.setMode(THEME_MODES[(index + 1) % THEME_MODES.length]);
  }
}
