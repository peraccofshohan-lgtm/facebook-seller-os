import { expect, test, type Page } from '@playwright/test';

async function onboard(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('facebook-seller-os');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.getByLabel('ব্যবসার নাম').fill('রিমা কালেকশন');
  await page.getByRole('button', { name: 'শুরু করুন' }).click();
  await expect(page.getByText(/আপনার ব্যবসার আজকের চিত্র/)).toBeVisible();
}

/**
 * These tests only mean anything against a production build, because that is where the
 * service worker is registered. `npm run preview` serves `dist/`.
 */
test.describe('offline first', () => {
  test('the app installs a service worker for offline use', async ({ page }) => {
    await onboard(page);
    const registered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration.active);
    });
    expect(registered).toBe(true);
  });

  test('the app still opens and accepts data with the network switched off', async ({ page, context }) => {
    await onboard(page);

    // Add a product while online…
    await page.getByRole('link', { name: /পণ্য/ }).first().click();
    await page.getByRole('button', { name: /নতুন পণ্য|পণ্য যোগ/ }).first().click();
    await page.getByLabel('পণ্যের নাম').fill('অফলাইন হিজাব');
    await page.getByLabel('ক্রয়মূল্য').fill('300');
    await page.getByLabel('বিক্রয়মূল্য').fill('550');
    await page.getByRole('button', { name: /সংরক্ষণ/ }).click();
    await expect(page.getByText('অফলাইন হিজাব').first()).toBeVisible();

    // …then cut the network and reload: everything must still work.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(/আপনার ব্যবসার আজকের চিত্র/)).toBeVisible();

    await page.getByRole('link', { name: /পণ্য/ }).first().click();
    await expect(page.getByText('অফলাইন হিজাব').first()).toBeVisible();

    // Data entry works offline too.
    await page.getByRole('button', { name: /নতুন পণ্য|পণ্য যোগ/ }).first().click();
    await page.getByLabel('পণ্যের নাম').fill('অফলাইন এন্ট্রি');
    await page.getByLabel('ক্রয়মূল্য').fill('100');
    await page.getByLabel('বিক্রয়মূল্য').fill('200');
    await page.getByRole('button', { name: /সংরক্ষণ/ }).click();
    await expect(page.getByText('অফলাইন এন্ট্রি').first()).toBeVisible();

    await context.setOffline(false);
  });
});
