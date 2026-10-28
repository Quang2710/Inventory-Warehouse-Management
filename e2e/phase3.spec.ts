import type { Page } from '@playwright/test';

import { expect, t, test } from './fixtures';

async function loginAsManager(page: Page): Promise<void> {
  await page.goto('/login');
  await page
    .getByRole('button', {
      name: t.auth.demo.loginAs.replace('{role}', t.roles.WAREHOUSE_MANAGER),
    })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Ngày dd/MM/yyyy cách hôm nay `days` ngày (theo giờ trình duyệt = Asia/Ho_Chi_Minh). */
function dmy(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Điều hướng trong SPA (không tải lại trang): backend giả lưu IndexedDB sau ~300 ms. */
async function openMenu(page: Page, label: string): Promise<void> {
  await page
    .getByRole('navigation', { name: t.nav.menu })
    .getByRole('link', { name: label, exact: true })
    .click();
}

async function pickProduct(page: Page, query: string): Promise<void> {
  const field = page.getByLabel(t.documents.fields.product).first();
  await field.fill(query);
  await page
    .getByRole('option', { name: new RegExp(query) })
    .first()
    .click();
}

test('nhập kho theo lô/HSD → tồn theo lô → phiếu xuất gợi ý lấy theo FEFO', async ({ page }) => {
  await loginAsManager(page);
  const lot = `E2E-${Date.now().toString().slice(-6)}`;

  await openMenu(page, t.nav.goodsReceipts);
  await page.getByRole('link', { name: t.receipts.create }).click();
  await page.getByLabel(t.receipts.fields.warehouse).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.receipts.fields.supplier, { exact: true }).fill('NCC kiểm thử e2e');
  // FOOD-RICE: nhóm hàng quản lý cả lô và hạn sử dụng.
  await pickProduct(page, 'FOOD-RICE-00');
  await page.getByLabel(t.common.quantity).first().fill('5');
  await page.getByLabel(t.lots.lotNumber).fill(lot);
  await page.getByLabel(t.lots.expiryDate).fill(dmy(3));
  await page.getByRole('button', { name: t.documents.saveAndSubmit }).click();

  await expect(page).toHaveURL(/\/goods-receipts\/[\w-]+$/);
  await page.getByRole('button', { name: t.documents.actions.approve }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: t.documents.actions.approve })
    .click();
  await expect(page.getByText(t.statuses.documentApproved).first()).toBeVisible();

  await openMenu(page, t.nav.stock);
  await page.getByRole('tab', { name: t.stock.tabs.lots }).click();
  await page.getByRole('searchbox').fill(lot);
  const row = page.getByRole('row', { name: new RegExp(lot) });
  await expect(row).toBeVisible();
  await expect(row.getByText(t.expiry.EXPIRING)).toBeVisible();
  const sku = (await row.getByRole('cell').nth(2).innerText()).trim();

  // Lô vừa nhập hết hạn sau 3 ngày → FEFO phải đề xuất lấy lô này trước.
  await openMenu(page, t.nav.goodsIssues);
  await page.getByRole('link', { name: t.issues.create }).click();
  await page.getByLabel(t.issues.fields.warehouse).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.issues.fields.customer, { exact: true }).fill('Khách lẻ');
  await pickProduct(page, sku);
  await page.getByLabel(t.common.quantity).first().fill('1');
  // Gợi ý FEFO lấy đúng lô vừa nhập (hạn gần nhất trong số lô còn hạn).
  const suggestion = page.getByText(`${t.issues.suggestedPicks}:`).locator('..');
  await expect(suggestion).toContainText(lot);
});

test('cảnh báo tồn kho: chuông trên header, lọc theo loại', async ({ page }) => {
  await loginAsManager(page);
  await page.getByRole('link', { name: /Cảnh báo tồn kho/ }).click();
  await expect(page).toHaveURL(/\/alerts$/);
  await page.getByRole('button', { name: new RegExp(t.alerts.types.EXPIRED) }).click();
  await expect(page).toHaveURL(/type=EXPIRED/);
  const firstRow = page.getByRole('row').nth(1);
  await expect(firstRow.getByText(t.alerts.types.EXPIRED)).toBeVisible();
  await expect(firstRow.getByRole('link', { name: t.alerts.actions.dispose })).toBeVisible();
});

test('báo cáo NXT có tổng cộng và xuất Excel theo bộ lọc; ABC vẽ đường Pareto', async ({
  page,
}) => {
  await loginAsManager(page);
  await openMenu(page, t.nav.inventorySummary);
  await expect(page.getByText(t.reports.nxt.closingValue).first()).toBeVisible();
  await page.getByRole('button', { name: t.exports.export }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: t.exports.excel }).click();
  expect((await download).suggestedFilename()).toMatch(/^nhap-xuat-ton-\d{8}-\d{4}\.xlsx$/);

  await openMenu(page, t.nav.abc);
  await expect(page.getByRole('img', { name: t.reports.abc.paretoAria })).toBeVisible();
  await expect(page.getByText(t.reports.abc.classA).first()).toBeVisible();
});
