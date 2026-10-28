import type { Role } from '../src/app/core/api';
import { DEMO_ACCOUNTS } from '../src/mocks/data/demo-accounts';
import { expect, loginWithForm, t, test } from './fixtures';

/** Mục menu phải thấy / không được thấy theo vai trò (quyền do backend giả cấp). */
const MENU_BY_ROLE: Record<Role, { visible: string[]; hidden: string[] }> = {
  ADMIN: { visible: [t.nav.users, t.nav.products, t.nav.goodsReceipts], hidden: [] },
  WAREHOUSE_MANAGER: { visible: [t.nav.warehouses, t.nav.goodsIssues], hidden: [t.nav.users] },
  WAREHOUSE_STAFF: { visible: [t.nav.stock, t.nav.goodsReceipts], hidden: [t.nav.users] },
  ACCOUNTANT: { visible: [t.nav.products, t.nav.stockMovements], hidden: [t.nav.users] },
};

for (const account of DEMO_ACCOUNTS) {
  test(`đăng nhập nhanh bằng tài khoản demo "${account.username}", F5 giữ phiên, đăng xuất`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);

    const roleLabel = t.roles[account.role];
    await page
      .getByRole('button', { name: t.auth.demo.loginAs.replace('{role}', roleLabel) })
      .click();

    await expect(page).toHaveURL(/\/dashboard$/);
    const greeting = t.dashboard.greeting.replace('{name}', account.fullName);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(greeting);

    const menu = page.getByRole('navigation', { name: t.nav.menu });
    for (const label of MENU_BY_ROLE[account.role].visible) {
      await expect(menu.getByRole('link', { name: label })).toBeVisible();
    }
    for (const label of MENU_BY_ROLE[account.role].hidden) {
      await expect(menu.getByRole('link', { name: label })).toHaveCount(0);
    }

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(greeting);

    await page.getByRole('button', { name: `${t.header.account}: ${account.fullName}` }).click();
    await page.getByRole('menuitem', { name: t.header.logout }).click();
    await expect(page).toHaveURL(/\/login\?reason=logout$/);
    await expect(page.getByText(t.auth.login.loggedOut)).toBeVisible();
  });
}

test('sai mật khẩu báo lỗi; nhân viên kho không vào được trang quản lý người dùng', async ({
  page,
}) => {
  await page.goto('/login');
  await loginWithForm(page, 'nhanvien', 'sai-mat-khau');
  await expect(page.getByRole('alert')).toContainText(t.errors.codes.INVALID_CREDENTIALS);

  await loginWithForm(page, 'nhanvien', 'Nhanvien@123');
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/users');
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(page.getByRole('heading', { name: t.system.forbiddenTitle })).toBeVisible();
});

test('mở link sâu khi chưa đăng nhập → đăng nhập xong quay lại đúng trang', async ({ page }) => {
  await page.goto('/goods-receipts');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fgoods-receipts$/);

  await loginWithForm(page, 'ketoan', 'Ketoan@123');
  await expect(page).toHaveURL(/\/goods-receipts$/);
  await expect(page.getByRole('heading', { name: t.receipts.title, level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: t.nav.breadcrumb })).toContainText(
    t.nav.goodsReceipts,
  );
});

test.describe('access token hết hạn', () => {
  test.use({
    mockOverrides: {
      'iwm.mock.errorRate': '0',
      'iwm.mock.delayMax': '50',
      'iwm.mock.accessTokenTtl': '5',
    },
  });

  test('tự refresh token trong nền, người dùng không bị đăng xuất', async ({ page }) => {
    await page.goto('/login');
    await loginWithForm(page, 'quanly', 'Quanly@123');
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.waitForTimeout(6_000);
    const refreshed = page.waitForResponse(
      (response) => response.url().endsWith('/api/auth/refresh') && response.status() === 200,
    );
    await page.reload();
    await refreshed;

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trần Thị Bình');
  });
});

test('đổi ngôn ngữ sang tiếng Anh và đổi theme', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: t.header.language }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('style', /color-scheme: light/);
});

test('Reset dữ liệu demo đưa về màn hình đăng nhập', async ({ page }) => {
  await page.goto('/login');
  await loginWithForm(page, 'admin', 'Admin@123');
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('button', { name: t.header.demoReset }).click();
  const dialog = page.getByRole('alertdialog', { name: t.demo.resetConfirmTitle });
  await dialog.getByRole('button', { name: t.demo.resetConfirm, exact: true }).click();

  await expect(page).toHaveURL(/\/login\?reason=demo-reset$/);
  await expect(page.getByText(t.auth.login.demoReset)).toBeVisible();
});
