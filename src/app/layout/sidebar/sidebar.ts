import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { NavSection } from '../../core/navigation/navigation';

@Component({
  selector: 'app-sidebar',
  imports: [MatListModule, MatIconModule, RouterLink, RouterLinkActive, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  /** Menu đã được lọc theo quyền. */
  readonly sections = input.required<readonly NavSection[]>();
  /** Phát ra khi chọn một mục (để đóng menu trên di động). */
  readonly navigate = output<void>();
}
