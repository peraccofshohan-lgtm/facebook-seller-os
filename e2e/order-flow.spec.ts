import { expect, test } from '@playwright/test';
import { addProduct, createOrder, onboard, openScreen, resetApp, ui, visibleText } from './support';

/**
 * The money trail of a single order: product → order → stock → payment →
 * dashboard. Every number here is one the seller can check by hand, and the
 * point of the test is that all five screens agree with each other.
 */
test.describe('the money trail of one order', () => {
  test('2 × 700 + 60 delivery = 1,460; 500 advance leaves 960 due; stock drops 10 → 8', async ({
    page,
  }) => {
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

    // 1. The saved order shows the same total the form promised.
    await expect(visibleText(page, 'টি-শার্ট')).toBeVisible();
    await expect(visibleText(page, '৳1,460')).toBeVisible();

    // 2. 500 paid of 1,460 leaves 960 due.
    await expect(page.locator('div').filter({ has: page.locator('dt:text-is("বাকি")') }).last()).toContainText(
      '৳960',
    );

    // 3. Stock 10 − 2 = 8. A "confirmed" order is what commits stock.
    await openScreen(page, ui.NAV_INVENTORY);
    const stockCard = page.locator('li').filter({ hasText: 'টি-শার্ট' });
    await expect(stockCard).toContainText('8');

    // 4. The dashboard reads the same sale from the same database.
    await openScreen(page, ui.NAV_HOME);
    await expect(page.getByText('৳1.5 হাজার').first()).toBeVisible(); // মোট বিক্রয়, compact
    await expect(page.getByText('৳500').first()).toBeVisible(); // আদায়কৃত পেমেন্ট
    await expect(page.getByText('৳960').first()).toBeVisible(); // বাকি (কাস্টমার)
  });

  test('cancelling a confirmed order puts the stock back', async ({ page }) => {
    await resetApp(page);
    await onboard(page);
    await addProduct(page, { name: 'টি-শার্ট', cost: '400', price: '700', stock: '10' });

    await createOrder(page, {
      customerName: 'রিমা আক্তার',
      phone: '01712345678',
      productName: 'টি-শার্ট',
      quantity: '3',
      status: 'confirmed',
    });

    await openScreen(page, ui.NAV_INVENTORY);
    await expect(page.locator('li').filter({ hasText: 'টি-শার্ট' })).toContainText('7');

    // Back to the order and cancel it.
    await openScreen(page, ui.NAV_ORDERS);
    // The order list hides the product column on a phone, so find it by customer.
    await visibleText(page, 'রিমা আক্তার').click();
    await expect(page).toHaveURL(/\/orders\/(?!new)[^/]+$/);

    const dialog = page.getByRole('dialog');
    await page.getByRole('button', { name: ui.CHANGE_STATUS }).click();
    await dialog.getByLabel(ui.NEW_STATUS).selectOption('cancelled');
    // "বাতিল" is both a status and the dialog's dismiss button — confirm with "হালনাগাদ".
    await dialog.getByRole('button', { name: ui.UPDATE }).click();
    await expect(visibleText(page, 'ORD-00001')).toBeVisible();
    await expect(visibleText(page, 'বাতিল')).toBeVisible();

    // The 3 units are back on the shelf.
    await openScreen(page, ui.NAV_INVENTORY);
    await expect(page.locator('li').filter({ hasText: 'টি-শার্ট' })).toContainText('10');
  });

  test('a rejected order does not let the seller save nonsense', async ({ page }) => {
    await resetApp(page);
    await onboard(page);

    await openScreen(page, ui.NAV_ORDERS);
    await page.getByRole('link', { name: ui.NEW_ORDER }).click();

    // No items, no customer: the form must refuse, not create a phantom order.
    await page.getByRole('button', { name: ui.ORDER_SAVE }).click();
    await expect(page).toHaveURL(/\/orders\/new$/);
  });
});
