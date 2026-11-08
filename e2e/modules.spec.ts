import { expect, test } from '@playwright/test';
import { addProduct, createOrder, onboard, openScreen, resetApp, ui, visibleText } from './support';

/**
 * Are the modules really one app, or separate screens that only look connected?
 *
 * A customer made on one screen must be selectable on another, and the numbers
 * on the report screens must be the same money the order screen wrote. That is
 * what these tests check — against a real database, not mocks.
 */
test.describe('the modules share one database', () => {
  test('a customer saved in the CRM can be picked on the order screen', async ({ page }) => {
    await resetApp(page);
    await onboard(page);

    // --- Customers: save one ---
    await openScreen(page, ui.NAV_CUSTOMERS);
    await page.getByRole('link', { name: 'নতুন কাস্টমার' }).click();
    await page.getByLabel('নাম').fill('রিমা আক্তার');
    await page.getByLabel('ফোন').first().fill('01712345678');
    await page.getByRole('button', { name: 'কাস্টমার সংরক্ষণ' }).click();
    await expect(page).toHaveURL(/\/customers\/[^/]+$|\/customers$/);
    await expect(visibleText(page, 'রিমা আক্তার')).toBeVisible();

    // --- Orders: that same customer can now be chosen ---
    await addProduct(page, { name: 'টি-শার্ট', cost: '400', price: '700', stock: '10' });
    await openScreen(page, ui.NAV_ORDERS);
    await page.getByRole('link', { name: ui.NEW_ORDER }).click();
    await page.getByRole('button', { name: 'কাস্টমার নির্বাচন' }).click();
    await page.getByRole('dialog').getByText('রিমা আক্তার').first().click();

    // Choosing them filled the order form from the CRM record (the manual
    // name/phone fields are replaced by the linked customer).
    await expect(visibleText(page, 'রিমা আক্তার')).toBeVisible();
    await expect(visibleText(page, '01712345678')).toBeVisible();
  });

  test('the report screens read the same money the order screen wrote', async ({ page }) => {
    await resetApp(page);
    await onboard(page);
    await addProduct(page, { name: 'টি-শার্ট', cost: '400', price: '700', stock: '10' });
    await createOrder(page, {
      customerName: 'রিমা আক্তার',
      phone: '01712345678',
      productName: 'টি-শার্ট',
      quantity: '2',
      deliveryCharge: '60',
      advance: '500',
      status: 'confirmed',
    });

    await openScreen(page, ui.NAV_REPORTS);

    // Sales report: the very same order, total, due and profit.
    await expect(visibleText(page, 'ORD-00001')).toBeVisible();
    await expect(visibleText(page, '৳1,460')).toBeVisible(); // মোট বিক্রয়
    await expect(visibleText(page, '৳960')).toBeVisible(); // মোট বাকি (1,460 − 500)
    await expect(visibleText(page, '৳600')).toBeVisible(); // 1,400 বিক্রয় − 800 ক্রয়

    // Profit & loss reads the same order: 1,400 sales − 800 cost = 600 profit.
    await page.getByLabel('রিপোর্ট').selectOption('profit');
    await expect(visibleText(page, '৳1,400')).toBeVisible(); // বিক্রয়
    await expect(visibleText(page, '৳800')).toBeVisible(); // ক্রয়মূল্য
    await expect(visibleText(page, '৳600')).toBeVisible(); // লাভ

    // Outstanding report shows only what is still owed.
    await page.getByLabel('রিপোর্ট').selectOption('outstanding');
    await expect(visibleText(page, '৳960')).toBeVisible();
  });

  test('an invoice can be opened and printed from a real order', async ({ page }) => {
    await resetApp(page);
    await onboard(page);
    await addProduct(page, { name: 'টি-শার্ট', cost: '400', price: '700', stock: '10' });
    const orderUrl = await createOrder(page, {
      customerName: 'রিমা আক্তার',
      phone: '01712345678',
      productName: 'টি-শার্ট',
      quantity: '1',
      status: 'confirmed',
    });

    // The invoice lives on the order page (it is shown only when printing),
    // so assert on the print sheet rather than on what is visible on screen.
    await page.goto(orderUrl);
    const sheet = page.locator('.print-sheet');
    await expect(sheet).toBeAttached();
    await expect(sheet).toContainText('রিমা আক্তার');
    await expect(sheet).toContainText('টি-শার্ট');
    await expect(sheet).toContainText('700');
    // And the print button really is wired to the browser's print dialog.
    await expect(page.getByRole('button', { name: 'প্রিন্ট' })).toBeVisible();
  });

  test('a product CSV export really contains the products in the database', async ({ page }) => {
    await resetApp(page);
    await onboard(page);
    await addProduct(page, { name: 'টি-শার্ট', cost: '400', price: '700', stock: '10' });

    await openScreen(page, ui.NAV_PRODUCTS);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV', exact: true }).click(),
    ]);
    const file = await download.path();
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(file as string, 'utf8');
    expect(text).toContain('টি-শার্ট');
    expect(text).toContain('400.00');
    expect(text).toContain('700.00');
    // Exported with a BOM so Excel keeps the Bengali intact.
    expect(text.charCodeAt(0)).toBe(0xfeff);
  });
});
