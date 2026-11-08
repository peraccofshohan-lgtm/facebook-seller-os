import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

test.describe('backup and export', () => {
  test('a backup file can be downloaded and restores into an empty database', async ({ page }) => {
    await onboard(page);

    // Create one product so the backup has something in it.
    await page.getByRole('link', { name: /পণ্য/ }).first().click();
    await page.getByRole('button', { name: /নতুন পণ্য|পণ্য যোগ/ }).first().click();
    await page.getByLabel('পণ্যের নাম').fill('ব্যাকআপ পণ্য');
    await page.getByLabel('ক্রয়মূল্য').fill('250');
    await page.getByLabel('বিক্রয়মূল্য').fill('450');
    await page.getByRole('button', { name: /সংরক্ষণ/ }).click();
    await expect(page.getByText('ব্যাকআপ পণ্য').first()).toBeVisible();

    // Download the backup.
    await page.getByRole('link', { name: /ব্যাকআপ/ }).first().click();
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /ব্যাকআপ ডাউনলোড করুন/ }).click(),
    ]).then(([event]) => event);
    const path = await download.path();
    expect(path).toBeTruthy();
    const raw = readFileSync(path!, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.meta.format).toBe('facebook-seller-os-backup');
    expect(parsed.data.products.length).toBe(1);

    // Wipe the database, then restore from the same file.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('facebook-seller-os');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    });
    await page.reload();
    await page.getByRole('link', { name: /ব্যাকআপ/ }).first().click();
    await page.getByRole('tab', { name: 'রিস্টোর' }).click();
    await page.locator('input[type="file"]').setInputFiles(path!);

    await expect(page.getByRole('button', { name: /রিস্টোর শুরু করুন/ })).toBeVisible();
    await page.getByRole('button', { name: /রিস্টোর শুরু করুন/ }).click();
    await expect(page.getByText(/রিস্টোর সম্পন্ন/)).toBeVisible();
  });
});
