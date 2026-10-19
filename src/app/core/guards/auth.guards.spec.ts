import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { BlankPage, loginAs, provideCoreTesting, testUser } from '../../../testing/core-testing';
import { routeAccess } from '../auth/route-access';
import { accessGuard, authGuard, guestGuard } from './auth.guards';

describe('route guards', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: provideCoreTesting([
        { path: 'login', canMatch: [guestGuard], component: BlankPage },
        {
          path: '',
          canMatch: [authGuard],
          children: [
            { path: 'home', component: BlankPage },
            {
              path: 'users',
              component: BlankPage,
              canActivate: [accessGuard],
              data: routeAccess({ roles: ['ADMIN'], permissions: ['user:read'] }),
            },
            { path: 'forbidden', component: BlankPage },
          ],
        },
      ]),
    });
  });

  async function navigate(url: string): Promise<string> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return TestBed.inject(Router).url;
  }

  it('chưa đăng nhập → /login kèm returnUrl', async () => {
    expect(await navigate('/users?tab=roles')).toBe('/login?returnUrl=%2Fusers%3Ftab%3Droles');
  });

  it('thiếu vai trò/quyền → /forbidden', async () => {
    await loginAs(testUser('WAREHOUSE_STAFF', ['user:read']));
    expect(await navigate('/users')).toBe('/forbidden');
  });

  it('đủ vai trò và quyền → vào được trang', async () => {
    await loginAs(testUser('ADMIN', ['user:read']));
    expect(await navigate('/users')).toBe('/users');
  });

  it('đã đăng nhập mà mở /login → về trang chủ', async () => {
    await loginAs(testUser('ACCOUNTANT'));
    expect(await navigate('/login')).not.toContain('/login');
  });
});
