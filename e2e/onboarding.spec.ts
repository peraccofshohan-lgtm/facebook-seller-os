import { expect, test, type Page } from '@playwright/test';

/** Fresh install: every test starts from an empty database. */
async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('facebook-seller-os');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
}

test.describe('first run', () => {
  test('a brand-new seller is guided through setup and lands on the dashboard', async ({ page }) => {
    await resetApp(page);

    await expect(page.getByText('Facebook Seller OS-এ স্বাগতম')).toBeVisible();
    await page.getByLabel('ব্যবসার নাম').fill('রিমা কালেকশন');
    await page.getByRole('button', { name: 'শুরু করুন' }).click();

    await expect(page.getByText(/আপনার ব্যবসার আজকের চিত্র/)).toBeVisible();
    // Nothing is fabricated: an empty business shows an empty state and zeroes.
    await expect(page.getByText(/আপনার ব্যবসার তথ্য এখনো যোগ করা হয়নি/)).toBeVisible();
  });

  test('the whole app is in Bengali and the navigation is reachable on a phone', async ({ page }) => {
    await resetApp(page);
    await page.getByLabel('ব্যবসার নাম').fill('রিমা কালেকশন');
    await page.getByRole('button', { name: 'শুরু করুন' }).click();
    await expect(page.getByText(/আপনার ব্যবসার আজকের চিত্র/)).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'প্রধান নেভিগেশন' });
    for (const label of ['অর্ডার', 'কাস্টমার', 'পণ্য', 'স্টক', 'কুরিয়ার', 'পেমেন্ট', 'রিটার্ন', 'খরচ', 'রিপোর্ট']) {
      await expect(nav.getByRole('link', { name: new RegExp(label) })).toBeVisible();
    }
  });
});
