import { expect, test } from '@playwright/test';
import { addProduct, createOrder, onboard, openScreen, resetApp, ui, visibleText } from './support';

/**
 * Backup is the only thing standing between a seller and total data loss, so
 * these tests do the real round trip: write data, download the file, wipe the
 * database, restore the file, and check the data is genuinely back.
 */
test.describe('backup and restore', () => {
  test('a backup file can be downloaded and restored into an empty database', async ({ page }) => {
    await resetApp(page);
    await onboard(page);
    await addProduct(page, { name: 'টি-শার্ট', cost: '400', price: '700', stock: '10' });
    await createOrder(page, {
      customerName: 'রিমা আক্তার',
      phone: '01712345678',
      productName: 'টি-শার্ট',
      quantity: '2',
      status: 'confirmed',
    });

    // --- Download ---
    await page.goto('/backup');
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: ui.BACKUP_DOWNLOAD }).click(),
    ]).then(([event]) => event);

    expect(download.suggestedFilename()).toMatch(/^facebook-seller-os-backup-\d{8}-\d{4}\.json$/);
    const file = await download.path();
    expect(file).toBeTruthy();

    // The file must really contain the business, not an empty shell.
    const { readFileSync } = await import('node:fs');
    const payload = JSON.parse(readFileSync(file as string, 'utf8'));
    const serialised = JSON.stringify(payload);
    expect(serialised).toContain('টি-শার্ট');
    expect(serialised).toContain('রিমা আক্তার');
    expect(payload.meta?.format).toBeTruthy();
    expect(Array.isArray(payload.data?.orders ?? payload.tables?.orders ?? null) || payload.data?.orders).toBeTruthy();

    // --- Wipe the database completely ---
    await resetApp(page);
    await onboard(page);
    await openScreen(page, ui.NAV_PRODUCTS);
    await expect(page.getByText('কোনো পণ্য পাওয়া যায়নি')).toBeVisible();

    // --- Restore ---
    await page.goto('/backup');
    await page.getByRole('tab', { name: 'রিস্টোর' }).click();
    await page.locator('input[type=file]').setInputFiles(file as string);

    await page.getByRole('button', { name: 'রিস্টোর শুরু করুন' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /রিস্টোর|হ্যাঁ|নিশ্চিত/ }).first().click();
    await expect(page.getByText(/রিস্টোর সম্পন্ন/)).toBeVisible({ timeout: 30_000 });

    // --- The data is genuinely back ---
    await openScreen(page, ui.NAV_PRODUCTS);
    await expect(visibleText(page, 'টি-শার্ট')).toBeVisible();
    await openScreen(page, ui.NAV_ORDERS);
    await expect(visibleText(page, 'রিমা আক্তার')).toBeVisible();
  });

  test('a corrupt file is refused with a clear message instead of destroying data', async ({
    page,
  }) => {
    await resetApp(page);
    await onboard(page);
    await addProduct(page, { name: 'টি-শার্ট', cost: '400', price: '700', stock: '10' });

    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const bad = join(tmpdir(), 'not-a-backup.json');
    writeFileSync(bad, '{"this":"is not a backup"}');

    await page.goto('/backup');
    await page.getByRole('tab', { name: 'রিস্টোর' }).click();
    await page.locator('input[type=file]').setInputFiles(bad);

    // The app must say what is wrong rather than silently doing nothing.
    // (The ASCII part of the message is asserted to avoid re-typing Bengali.)
    await expect(visibleText(page, /Facebook Seller OS/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'রিস্টোর শুরু করুন' })).toHaveCount(0);

    // And the existing product must be untouched.
    await openScreen(page, ui.NAV_PRODUCTS);
    await expect(visibleText(page, 'টি-শার্ট')).toBeVisible();
  });
});
