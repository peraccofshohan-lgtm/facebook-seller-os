import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/app/App';
import { getSettings, updateSettings } from '@/services/settingsService';
import { createProduct } from '@/services/productService';
import { adjustStock } from '@/services/inventoryService';
import { parseMoney } from '@/lib/money';
import { db } from '@/db/db';

const tk = parseMoney;

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

async function completeOnboarding() {
  await updateSettings({
    onboardingCompleted: true,
    business: {
      ...(await getSettings()).business,
      name: 'রিমা কালেকশন',
      phone: '01712345678',
      address: 'টাঙ্গাইল',
    },
  });
}

async function seedProductWithStock() {
  const product = await createProduct(
    {
      name: 'টি-শার্ট',
      sku: 'TS-1',
      description: '',
      categoryId: null,
      brand: '',
      costPrice: tk('400'),
      sellingPrice: tk('700'),
      discountPrice: null,
      unit: 'পিস',
      barcode: '',
      imageDataUrl: null,
      hasVariants: false,
      lowStockThreshold: 5,
      isActive: true,
    },
    { openingStock: 0 },
  );
  await adjustStock({ productId: product.id, variantId: null, quantity: 10, type: 'purchase', unitCost: tk('400') });
  return product;
}

describe('creating an order through the UI', () => {
  it('picks a product, computes the total, saves and commits stock', async () => {
    await completeOnboarding();
    const product = await seedProductWithStock();
    const user = userEvent.setup();

    renderAt('/orders/new');

    // 1. Customer details typed by hand (no saved customer yet).
    await user.type(await screen.findByLabelText('কাস্টমারের নাম'), 'রিমা আক্তার');
    await user.type(screen.getByLabelText('ফোন'), '01712345678');

    // 2. Save this buyer to the CRM (opt-in, so cash sales stay out of the list by default).
    await user.click(await screen.findByLabelText('এই কাস্টমারকে কাস্টমার তালিকায় সংরক্ষণ করুন'));

    // 3. Add a product through the picker.
    await user.click(screen.getByRole('button', { name: /পণ্য যোগ করুন/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByText('টি-শার্ট'));

    // 4. The line appears with the selling price filled in from the catalogue.
    expect(await screen.findByDisplayValue('700')).toBeTruthy();

    // 5. Set the quantity to 2 and add a delivery charge.
    const quantity = await screen.findByLabelText('পরিমাণ');
    await user.clear(quantity);
    await user.type(quantity, '2');
    const delivery = screen.getByLabelText('ডেলিভারি চার্জ');
    await user.clear(delivery);
    await user.type(delivery, '60');

    // 6. Totals are computed live: 2 × 700 + 60 = 1,460.
    await waitFor(() => expect(screen.getByText('৳১,৪৬০')).toBeTruthy());

    // 7. Confirming the order is what commits stock — a draft must not move stock.
    await user.selectOptions(screen.getByLabelText('স্ট্যাটাস'), 'confirmed');

    // 8. Save.
    await user.click(screen.getByRole('button', { name: /অর্ডার সংরক্ষণ করুন/ }));

    // 9. The order exists with the right numbers, and stock was committed.
    await waitFor(async () => {
      const orders = await db.orders.toArray();
      expect(orders).toHaveLength(1);
      expect(orders[0].subtotal).toBe(tk('1400'));
      expect(orders[0].total).toBe(tk('1460'));
      expect(orders[0].status).toBe('confirmed');
      expect(orders[0].stockCommitted).toBe(true);
    });

    const level = await db.stockLevels.get(`${product.id}::-`);
    expect(level?.quantity).toBe(8);

    // 10. A customer was created from the typed phone number.
    const customers = await db.customers.toArray();
    expect(customers).toHaveLength(1);
    expect(customers[0].phone).toBe('01712345678');
  });

  it('refuses to save an order with no products', async () => {
    await completeOnboarding();
    await seedProductWithStock();
    const user = userEvent.setup();

    renderAt('/orders/new');
    await user.click(await screen.findByRole('button', { name: /অর্ডার সংরক্ষণ করুন/ }));

    expect(await screen.findByText(/অন্তত একটি পণ্য যোগ করুন/)).toBeTruthy();
    expect(await db.orders.count()).toBe(0);
  });
});
