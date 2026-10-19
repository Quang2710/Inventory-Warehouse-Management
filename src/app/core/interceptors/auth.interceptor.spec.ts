import { HttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { BlankPage, loginAs, provideCoreTesting, testUser } from '../../../testing/core-testing';
import { AuthStore } from '../auth/auth.store';
import { TokenStorage } from '../auth/token-storage';
import { isApiError } from '../http/api-error';

const unauthorized = { status: 401, statusText: 'Unauthorized' };
const expiredBody = { code: 'TOKEN_EXPIRED', message: 'Phiên làm việc đã hết hạn.' };

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let tokens: TokenStorage;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: provideCoreTesting([{ path: 'login', component: BlankPage }]),
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(TokenStorage);
  });

  afterEach(() => backend.verify());

  it('gắn Bearer token cho request tới API, không gắn cho domain khác', () => {
    tokens.save({ accessToken: 'a1', refreshToken: 'r1' });

    http.get('/api/products').subscribe();
    http.get('https://cdn.example.com/data.json').subscribe();

    expect(backend.expectOne('/api/products').request.headers.get('Authorization')).toBe(
      'Bearer a1',
    );
    expect(
      backend.expectOne('https://cdn.example.com/data.json').request.headers.has('Authorization'),
    ).toBe(false);
  });

  it('401 → refresh MỘT lần cho các request đồng thời rồi gửi lại với token mới', () => {
    tokens.save({ accessToken: 'expired', refreshToken: 'r1' });
    const results: unknown[] = [];

    http.get('/api/a').subscribe((body) => results.push(body));
    http.get('/api/b').subscribe((body) => results.push(body));
    backend.expectOne('/api/a').flush(expiredBody, unauthorized);
    backend.expectOne('/api/b').flush(expiredBody, unauthorized);

    const refresh = backend.expectOne('/api/auth/refresh');
    expect(refresh.request.body).toEqual({ refreshToken: 'r1' });
    refresh.flush({
      accessToken: 'fresh',
      refreshToken: 'r2',
      tokenType: 'Bearer',
      expiresIn: 900,
    });

    const retries = backend.match((request) => ['/api/a', '/api/b'].includes(request.url));
    expect(retries).toHaveLength(2);
    for (const retry of retries) {
      expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh');
      retry.flush({ ok: true });
    }
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(tokens.refreshToken).toBe('r2');
  });

  it('refresh thất bại → xóa phiên, về /login?reason=expired, trả lỗi gốc dạng ApiError', async () => {
    await loginAs(testUser('WAREHOUSE_STAFF', ['stock:read']));
    const auth = TestBed.inject(AuthStore);
    let failure: unknown;

    http.get('/api/stock').subscribe({ error: (error: unknown) => (failure = error) });
    backend.expectOne('/api/stock').flush(expiredBody, unauthorized);
    backend
      .expectOne('/api/auth/refresh')
      .flush({ code: 'INVALID_REFRESH_TOKEN', message: 'Hết phiên' }, unauthorized);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(isApiError(failure) && failure.code).toBe('TOKEN_EXPIRED');
    expect(auth.isAuthenticated()).toBe(false);
    expect(tokens.refreshToken).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/login?reason=expired');
  });

  it('không tự refresh cho request đánh dấu SKIP_AUTH (vd đăng nhập sai)', async () => {
    const auth = TestBed.inject(AuthStore);
    const pending = auth.login({ username: 'admin', password: 'sai' });
    backend
      .expectOne('/api/auth/login')
      .flush({ code: 'INVALID_CREDENTIALS', message: 'Sai mật khẩu' }, unauthorized);

    await expect(pending).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    backend.expectNone('/api/auth/refresh');
  });
});
