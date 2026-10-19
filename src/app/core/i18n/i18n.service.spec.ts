import { TestBed } from '@angular/core/testing';

import { ApiError } from '../http/api-error';
import { I18nService } from './i18n.service';

describe('I18nService', () => {
  let i18n: I18nService;

  beforeEach(() => {
    localStorage.clear();
    i18n = TestBed.inject(I18nService);
  });

  it('mặc định tiếng Việt, hỗ trợ tham số nội suy', async () => {
    await i18n.init();
    TestBed.tick();
    expect(i18n.language()).toBe('vi');
    expect(document.documentElement.lang).toBe('vi');
    expect(i18n.t('dashboard.greeting', { name: 'An' })).toBe('Xin chào, An!');
  });

  it('đổi sang tiếng Anh (nạp lười) và ghi nhớ lựa chọn', async () => {
    await i18n.use('en');
    TestBed.tick();
    expect(i18n.t('auth.login.title')).toBe('Sign in');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('iwm.language')).toBe('en');
  });

  it('khóa động không tồn tại → trả lại chính khóa', () => {
    expect(i18n.translate('khong.ton.tai')).toBe('khong.ton.tai');
  });

  it('thông điệp lỗi: ưu tiên bản dịch theo mã lỗi, rồi thông điệp server, rồi theo HTTP status', async () => {
    expect(i18n.errorMessage(new ApiError(401, 'INVALID_CREDENTIALS', 'server message'))).toBe(
      'Tên đăng nhập hoặc mật khẩu không đúng.',
    );
    expect(i18n.errorMessage(new ApiError(409, 'CUSTOM_RULE', 'Mã SKU đã tồn tại'))).toBe(
      'Mã SKU đã tồn tại',
    );
    expect(
      i18n.errorMessage(new ApiError(502, 'BAD_GATEWAY', 'Http failure response for /api: 502')),
    ).toBe('Hệ thống đang gặp sự cố. Vui lòng thử lại sau.');

    await i18n.use('en');
    expect(i18n.errorMessage(new ApiError(0, 'NETWORK_ERROR', ''))).toContain('Cannot reach');
  });
});
