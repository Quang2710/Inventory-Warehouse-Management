import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { CurrentUser } from '../../core/api';
import type { Language, TranslationKey } from '../../core/i18n/i18n.types';
import { LANGUAGE_LABEL_KEYS, ROLE_LABEL_KEYS } from '../../core/i18n/labels';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { THEME_MODES, type ThemeMode } from '../../core/theme/theme.service';

const THEME_OPTIONS: Readonly<Record<ThemeMode, { icon: string; labelKey: TranslationKey }>> = {
  light: { icon: 'light_mode', labelKey: 'header.themeLight' },
  dark: { icon: 'dark_mode', labelKey: 'header.themeDark' },
  system: { icon: 'brightness_auto', labelKey: 'header.themeSystem' },
};

/** Thanh tiêu đề: chỉ hiển thị dữ liệu được truyền vào và phát sự kiện cho layout xử lý. */
@Component({
  selector: 'app-header',
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  readonly user = input.required<CurrentUser>();
  readonly language = input.required<Language>();
  readonly languages = input.required<readonly Language[]>();
  readonly themeMode = input.required<ThemeMode>();
  readonly demoMode = input(false);

  readonly menuToggle = output<void>();
  readonly languageChange = output<Language>();
  readonly themeModeChange = output<ThemeMode>();
  readonly logout = output<void>();
  readonly demoReset = output<void>();

  protected readonly themeModes = THEME_MODES;
  protected readonly themeOptions = THEME_OPTIONS;
  protected readonly languageLabels = LANGUAGE_LABEL_KEYS;
  protected readonly roleLabel = computed(() => ROLE_LABEL_KEYS[this.user().role]);
  protected readonly initials = computed(() =>
    this.user()
      .fullName.split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join('')
      .toUpperCase(),
  );
}
