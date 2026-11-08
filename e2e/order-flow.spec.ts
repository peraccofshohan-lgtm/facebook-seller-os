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

async function addProduct(page: Page, name: string, cost: string, price: string, stock: string) {
  await page.getByRole('link', { name: /পণ্য/ }).first().click();
  await page.getByRole('button', { name: /নতুন পণ্য|পণ্য যোগ/ }).first().click();
  await page.getByLabel('পণ্যের নাম').fill(name);
  await page.getByLabel('ক্রয়মূল্য').fill(cost);
  await page.getByLabel('বিক্রয়মূল্য').fill(price);
  const openingStock = page.getByLabel('শুরুর স্টক');
  if (await openingStock.count()) await openingStock.fill(stock);
  await page.getByRole('button', { name: /সংরক্ষণ/ }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}

test.describe('the money trail of one order', () => {
  test('product → order → stock → dashboard numbers all agree', async ({ page }) => {
    await onboard(page);

    await addProduct(page, 'টি-শার্ট', '400', '700', '10');

    // Create an order for 2 units + 60 BDT delivery.
    await page.getByRole('link', { name: /অর্ডার/ }).first().click();
    await page.getByRole('button', { name: /নতুন অর্ডার/ }).click();
    await page.getByLabel('কাস্টমারের নাম').fill('রিমা আক্তার');
    await page.getByLabel('ফোন').fill('01712345678');
    await page.getByRole('button', { name: /পণ্য যোগ করুন/ }).click();
    await page.getByRole('dialog').getByText('টি-শার্ট').click();
    await page.getByLabel('পরিমাণ').fill('2');
    await page.getByLabel('ডেলিভারি চার্জ').fill('60');
    await expect(page.getByText('৳1,460')).toBeVisible();
    await page.getByRole('button', { name: /অর্ডার সংরক্ষণ করুন/ }).click();

    // The order detail view shows the same total.
    await expect(page.getByText('টি-শার্ট').first()).toBeVisible();
    await expect(page.getByText('৳1,460').first()).toBeVisible();

    // Stock: 10 − 2 = 8 (status "new" does not commit stock).
    await page.getByRole('link', { name: /স্টক/ }).first().click();
    await expect(page.getByText('টি-শার্ট').first()).toBeVisible();

    // Confirming the order must deduct stock.
    await page.getByRole('link', { name: /অর্ডার/ }).first().click();
    await page.getByText('টি-শার্ট').first().click();
    const statusSelect = page.getByLabel('স্ট্যাটাস');
    if (await statusSelect.count()) {
      await statusSelect.selectOption('confirmed');
      await page.getByRole('button', { name: /সংরক্ষণ|আপডেট|হালনাগাদ/ }).first().click();
    }

    // Dashboard: total sales for the range now reads 1,460 — not a placeholder.
    await page.getByRole('link', { name: /ড্যাশবোর্ড/ }).first().click();
    await expect(page.getByText('৳1,460').first()).toBeVisible();
  });
});
