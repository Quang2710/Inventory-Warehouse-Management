import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BlankPage, loginAs, provideCoreTesting, testUser } from '../../../testing/core-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermissionDirective } from './has-permission.directive';
import { HasRoleDirective } from './has-role.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HasRoleDirective, HasPermissionDirective],
  template: `
    <span *hasRole="'ADMIN'" id="admin">admin</span>
    <span *hasRole="['WAREHOUSE_MANAGER', 'ADMIN']; else readOnly" id="manager">manage</span>
    <ng-template #readOnly><span id="read-only">read only</span></ng-template>
    <button *hasPermission="['goods-receipt:read', 'goods-receipt:approve']" id="approve">
      approve
    </button>
  `,
})
class Host {}

describe('*hasRole / *hasPermission', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: provideCoreTesting([{ path: 'login', component: BlankPage }]),
    });
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('chưa đăng nhập: ẩn hết, hiện nhánh else', async () => {
    const element = await render();
    expect(element.querySelector('#admin')).toBeNull();
    expect(element.querySelector('#manager')).toBeNull();
    expect(element.querySelector('#read-only')).not.toBeNull();
    expect(element.querySelector('#approve')).toBeNull();
  });

  it('quản lý kho: thấy khối quản lý và nút duyệt (đủ CẢ HAI quyền), không thấy khối admin', async () => {
    await loginAs(testUser('WAREHOUSE_MANAGER', ['goods-receipt:read', 'goods-receipt:approve']));
    const element = await render();
    expect(element.querySelector('#admin')).toBeNull();
    expect(element.querySelector('#manager')).not.toBeNull();
    expect(element.querySelector('#read-only')).toBeNull();
    expect(element.querySelector('#approve')).not.toBeNull();
  });

  it('thiếu một trong các quyền → ẩn; cập nhật ngay khi đăng xuất', async () => {
    await loginAs(testUser('WAREHOUSE_STAFF', ['goods-receipt:read']));
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#approve')).toBeNull();
    expect(element.querySelector('#read-only')).not.toBeNull();

    await loginAs(testUser('ADMIN', ['goods-receipt:read', 'goods-receipt:approve']));
    await fixture.whenStable();
    expect(element.querySelector('#admin')).not.toBeNull();
    expect(element.querySelector('#approve')).not.toBeNull();

    await TestBed.inject(AuthStore).endSession('logout');
    await fixture.whenStable();
    expect(element.querySelector('#admin')).toBeNull();
  });
});
