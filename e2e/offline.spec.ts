import { expect, test } from '@playwright/test';
import { addProduct, onboard, openScreen, resetApp, ui, visibleText } from './support';

/**
 * The whole point of the product: it must keep working on a phone with no
 * internet. These tests run against the production build (`vite preview`)
 * because the service worker only exists there.
 */
test.describe('offline first', () => {
  test('the service worker takes control after the first reload', async ({ page }) => {
    await resetApp(page);
    await onboard(page);

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });

    const script = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '');
    expect(script).toContain('sw.js');
  });

  test('the app still opens and accepts data with the network switched off', async ({
    page,
    context,
  }) => {
    await resetApp(page);
    await onboard(page);

    // Let the service worker install and take control while still online.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });

    await context.setOffline(true);

    // A cold reload with no network at all must still bring the app up.
    await page.reload();
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });

    // And it must still accept work.
    await addProduct(page, { name: 'অফলাইন হিজাব', cost: '300', price: '550', stock: '4' });

    // Re-opening the app offline shows the data that was just written.
    await page.reload();
    await openScreen(page, ui.NAV_PRODUCTS);
    await expect(visibleText(page, 'অফলাইন হিজাব')).toBeVisible();

    await context.setOffline(false);
  });

  test('no request ever leaves for a server the seller did not ask for', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http://127.0.0.1:4173') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        external.push(url);
      }
    });

    await resetApp(page);
    await onboard(page);
    await addProduct(page, { name: 'টি-শার্ট', cost: '400', price: '700', stock: '10' });
    await createOrderOfflineCheck(page);
    await openScreen(page, ui.NAV_REPORTS);

    // Nothing is phoned home: no analytics, no fonts, no telemetry.
    expect(external).toEqual([]);
  });
});

async function createOrderOfflineCheck(page: import('@playwright/test').Page) {
  await page.goto('/orders/new');
  await page.getByLabel(ui.ORDER_CUSTOMER_NAME).fill('রিমা আক্তার');
  await page.getByLabel(ui.ORDER_PHONE).fill('01712345678');
  await page.getByRole('button', { name: ui.ORDER_ADD_ITEM }).click();
  await page.getByRole('dialog').getByText('টি-শার্ট').first().click();
  await page.getByLabel(ui.QTY).fill('1');
  await page.getByRole('button', { name: ui.ORDER_SAVE }).click();
  await expect(page).toHaveURL(/\/orders\/(?!new)[^/]+$/);
}
