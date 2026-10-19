import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import type { Permission, Role, RoleDefinition } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  PERMISSION_GROUPS,
  type PermissionGroup,
  permissionLabelKey,
} from '../../../core/auth/permission-catalog';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ROLE_LABEL_KEYS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import type { HasUnsavedChanges } from '../../../shared/forms/unsaved-changes.guard';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { StatePanel } from '../../../shared/ui/state-panel/state-panel';
import { UsersApi } from '../../users/data-access/users.api';

type Draft = Partial<Record<Role, ReadonlySet<Permission>>>;

/** Ma trận phân quyền: hàng = quyền (theo nhóm), cột = vai trò. */
@Component({
  selector: 'app-roles-page',
  imports: [
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeader,
    StatePanel,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './roles-page.html',
  styleUrl: './roles-page.scss',
})
export class RolesPage implements HasUnsavedChanges {
  private readonly api = inject(UsersApi);
  private readonly auth = inject(AuthStore);
  private readonly notifications = inject(NotificationService);
  protected readonly i18n = inject(I18nService);

  protected readonly groups = PERMISSION_GROUPS;
  protected readonly roleLabels = ROLE_LABEL_KEYS;
  protected readonly permissionLabel = permissionLabelKey;
  protected readonly canEdit = computed(() => this.auth.hasPermission('role:write'));

  protected readonly roles = signal<RoleDefinition[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<unknown>(null);
  private readonly draft = signal<Draft>({});

  protected readonly changeCount = computed(() =>
    this.roles().reduce((count, definition) => {
      const draft = this.draft()[definition.role];
      if (!draft) return count;
      const original = new Set(definition.permissions);
      const added = [...draft].filter((permission) => !original.has(permission)).length;
      const removed = definition.permissions.filter((permission) => !draft.has(permission)).length;
      return count + added + removed;
    }, 0),
  );

  constructor() {
    void this.load();
  }

  hasUnsavedChanges(): boolean {
    return this.changeCount() > 0;
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.roles.set(await firstValueFrom(this.api.roles()));
      this.draft.set({});
    } catch (error) {
      this.error.set(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected granted(definition: RoleDefinition): ReadonlySet<Permission> {
    return this.draft()[definition.role] ?? new Set(definition.permissions);
  }

  protected isChanged(definition: RoleDefinition, permission: Permission): boolean {
    return this.granted(definition).has(permission) !== definition.permissions.includes(permission);
  }

  protected groupState(
    definition: RoleDefinition,
    group: PermissionGroup,
  ): 'all' | 'some' | 'none' {
    const granted = this.granted(definition);
    const count = group.permissions.filter((permission) => granted.has(permission)).length;
    return count === 0 ? 'none' : count === group.permissions.length ? 'all' : 'some';
  }

  protected toggle(definition: RoleDefinition, permission: Permission): void {
    const next = new Set(this.granted(definition));
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    this.draft.update((draft) => ({ ...draft, [definition.role]: next }));
  }

  protected toggleGroup(definition: RoleDefinition, group: PermissionGroup): void {
    const next = new Set(this.granted(definition));
    const enable = this.groupState(definition, group) !== 'all';
    for (const permission of group.permissions) {
      if (enable) next.add(permission);
      else next.delete(permission);
    }
    this.draft.update((draft) => ({ ...draft, [definition.role]: next }));
  }

  protected discard(): void {
    this.draft.set({});
  }

  protected async save(): Promise<void> {
    const changed = this.roles().filter((definition) => {
      const draft = this.draft()[definition.role];
      return (
        draft &&
        (draft.size !== definition.permissions.length ||
          definition.permissions.some((p) => !draft.has(p)))
      );
    });
    if (changed.length === 0 || this.saving()) return;
    this.saving.set(true);
    try {
      const updated = await Promise.all(
        changed.map((definition) =>
          firstValueFrom(
            this.api.updateRolePermissions(definition.role, [...this.granted(definition)]),
          ),
        ),
      );
      const byRole = new Map(updated.map((definition) => [definition.role, definition]));
      this.roles.update((roles) =>
        roles.map((definition) => byRole.get(definition.role) ?? definition),
      );
      this.draft.set({});
      this.notifications.success('rolesPage.saved', { count: updated.length });
      void this.auth.refreshProfile(0);
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}
