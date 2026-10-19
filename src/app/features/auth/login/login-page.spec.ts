import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { environment } from '../../../../environments/environment';
import { BlankPage, provideCoreTesting, testUser } from '../../../../testing/core-testing';
import { APP_ENVIRONMENT } from '../../../core/config/app-config';
import { LoginPage } from './login-page';

async function settle(harness: RouterTestingHarness): Promise<HTMLElement> {
  await harness.fixture.whenStable();
  return harness.routeNativeElement!;
}

function type(element: HTMLElement, selector: string, value: string): void {
  const input = element.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('LoginPage', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        ...provideCoreTesting([
          { path: 'login', component: LoginPage },
          { path: 'stock', component: BlankPage },
          { path: '', component: BlankPage },
        ]),
        { provide: APP_ENVIRONMENT, useValue: { ...environment, useMock: true } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('hiện tài khoản demo; bấm để đăng nhập nhanh rồi quay về returnUrl', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login?returnUrl=%2Fstock');
    backend.expectOne('/api/__demo/accounts').flush([
      {
        username: 'quanly',
        password: 'Quanly@123',
        fullName: 'Trần Thị Bình',
        role: 'WAREHOUSE_MANAGER',
      },
    ]);
    const element = await settle(harness);

    const account = element.querySelector<HTMLButtonElement>('.demo__account')!;
    expect(account.textContent).toContain('Quản lý kho');
    account.click();

    const login = backend.expectOne('/api/auth/login');
    expect(login.request.body).toEqual({ username: 'quanly', password: 'Quanly@123' });
    login.flush({
      accessToken: 'a',
      refreshToken: 'r',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: testUser('WAREHOUSE_MANAGER'),
    });
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/stock');
  });

  it('báo lỗi bắt buộc bằng tiếng Việt và hiện lỗi đăng nhập từ server', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login');
    backend.expectOne('/api/__demo/accounts').flush([]);
    let element = await settle(harness);

    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    element = await settle(harness);
    expect(element.textContent).toContain('Vui lòng nhập tên đăng nhập.');
    expect(element.textContent).toContain('Vui lòng nhập mật khẩu.');
    backend.expectNone('/api/auth/login');

    type(element, 'input[formcontrolname=username]', 'admin');
    type(element, 'input[formcontrolname=password]', 'sai-mat-khau');
    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    backend
      .expectOne('/api/auth/login')
      .flush(
        { code: 'INVALID_CREDENTIALS', message: 'Sai thông tin' },
        { status: 401, statusText: 'Unauthorized' },
      );
    element = await settle(harness);

    expect(element.querySelector('[role=alert]')?.textContent).toContain(
      'Tên đăng nhập hoặc mật khẩu không đúng.',
    );
    expect(element.querySelector<HTMLInputElement>('input[formcontrolname=password]')!.value).toBe(
      '',
    );
  });

  it('hiện thông báo khi phiên hết hạn', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login?reason=expired');
    backend.expectOne('/api/__demo/accounts').flush([]);
    const element = await settle(harness);
    expect(element.querySelector('[role=status]')?.textContent).toContain(
      'Phiên đăng nhập đã hết hạn',
    );
  });
});
