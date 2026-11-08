import { expect, test } from '@playwright/test';
import { addProduct, onboard, openScreen, resetApp, setBengaliDigits, ui, visibleText } from './support';

test.describe('first run', () => {
  test('a brand-new seller is guided through setup and lands on an honest empty dashboard', async ({
    page,
  }) => {
    await resetApp(page);

    await expect(page.getByText('Facebook Seller OS-এ স্বাগতম')).toBeVisible();
    await onboard(page, { latinDigits: false });

    // Nothing is invented: a business with no data shows an empty state, not fake numbers.
    await expect(page.getByText(ui.DASHBOARD_EMPTY)).toBeVisible();
  });

  test('every module is reachable from the phone navigation', async ({ page }) => {
    await resetApp(page);
    await onboard(page);

    await page.getByRole('navigation', { name: 'নিচের নেভিগেশন' }).getByRole('button', { name: ui.MORE }).click();
    const menu = page.getByRole('dialog');

    for (const label of [
      ui.NAV_ORDERS,
      ui.NAV_CUSTOMERS,
      ui.NAV_PRODUCTS,
      ui.NAV_INVENTORY,
      ui.NAV_COURIER,
      ui.NAV_PAYMENTS,
      ui.NAV_RETURNS,
      ui.NAV_EXPENSES,
      ui.NAV_REPORTS,
      ui.NAV_BACKUP,
      ui.NAV_SETTINGS,
    ]) {
      await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
  });

  test('every screen opens with a Bengali heading and no crash', async ({ page }) => {
    const crashes: string[] = [];
    page.on('pageerror', (error) => crashes.push(String(error)));

    await resetApp(page);
    await onboard(page);

    for (const label of [
      ui.NAV_ORDERS,
      ui.NAV_CUSTOMERS,
      ui.NAV_PRODUCTS,
      ui.NAV_INVENTORY,
      ui.NAV_COURIER,
      ui.NAV_PAYMENTS,
      ui.NAV_RETURNS,
      ui.NAV_EXPENSES,
      ui.NAV_REPORTS,
      ui.NAV_BACKUP,
      ui.NAV_SETTINGS,
      ui.NAV_HOME,
    ]) {
      await openScreen(page, label);
      await expect(page.getByRole('heading').first()).toBeVisible();
    }

    expect(crashes).toEqual([]);
  });

  test('the "numbers in Bangla" setting changes every screen, not just the dashboard', async ({
    page,
  }) => {
    await resetApp(page);
    // Shipped default: digits in Bangla.
    await onboard(page, { latinDigits: false });
    await addProduct(page, { name: 'টি-শার্ট', cost: '400', price: '700', stock: '10' });

    await expect(visibleText(page, '৳৭০০')).toBeVisible();
    await expect(page.getByText('৳700')).toHaveCount(0);

    // Turning the setting off must reach this screen too.
    await setBengaliDigits(page, false);
    await openScreen(page, ui.NAV_PRODUCTS);
    await expect(visibleText(page, '৳700')).toBeVisible();
    await expect(page.getByText('৳৭০০')).toHaveCount(0);
  });
});
