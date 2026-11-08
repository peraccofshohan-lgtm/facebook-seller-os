import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/app/App';
import { updateSettings } from '@/services/settingsService';
import { createProduct } from '@/services/productService';
import { adjustStock } from '@/services/inventoryService';
import { parseMoney } from '@/lib/money';
import { db } from '@/db/db';

const tk = parseMoney;

function renderAt(path: string) {
  // <App /> owns its own BrowserRouter, so the route is set on jsdom's history instead.
  window.history.pushState({}, '', path);
  return render(<App />);
}

async function completeOnboarding() {
  await updateSettings({ onboardingCompleted: true, business: { name: 'রিমা কালেকশন', phone: '01712345678', address: 'টাঙ্গাইল', email: '', website: '', registrationNote: '', logoDataUrl: null } });
}

describe('app shell', () => {
  it('sends a brand-new user to the setup page', async () => {
    renderAt('/');
    expect(await screen.findByText(/Facebook Seller OS-এ স্বাগতম/)).toBeTruthy();
    expect(screen.getByText(/প্রথমে আপনার ব্যবসার তথ্য দিন/)).toBeTruthy();
  });

  it('shows the dashboard with a real empty state after onboarding', async () => {
    await completeOnboarding();
    renderAt('/');
    // The dashboard greets by time of day and explains itself in Bengali.
    expect(await screen.findByText(/আপনার ব্যবসার আজকের চিত্র/)).toBeTruthy();
    // With no data at all, it says so instead of inventing numbers.
    expect(await screen.findByText(/আপনার ব্যবসার তথ্য এখনো যোগ করা হয়নি/)).toBeTruthy();
    expect(await screen.findByRole('link', { name: /প্রথম পণ্য যোগ করুন/ })).toBeTruthy();
  });

  it('renders the full Bengali navigation on a phone-sized screen', async () => {
    await completeOnboarding();
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: 'প্রধান নেভিগেশন' });
    for (const label of ['ড্যাশবোর্ড', 'অর্ডার', 'কাস্টমার', 'পণ্য', 'স্টক', 'কুরিয়ার', 'পেমেন্ট', 'রিটার্ন', 'খরচ', 'রিপোর্ট']) {
      expect(within(nav).getByRole('link', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('shows an unknown route as a Bengali not-found page', async () => {
    await completeOnboarding();
    renderAt('/এই-পেজ-নেই');
    expect(await screen.findByText(/পেজটি পাওয়া যায়নি/)).toBeTruthy();
  });
});

describe('product screen', () => {
  it('lists a created product with its price in taka', async () => {
    await completeOnboarding();
    await createProduct(
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
    await adjustStock({ productId: (await db.products.toArray())[0].id, variantId: null, quantity: 8, type: 'purchase', unitCost: tk('400') });

    renderAt('/products');
    expect((await screen.findAllByText('টি-শার্ট')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳700').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8').length).toBeGreaterThan(0);
  });

  it('shows a Bengali empty state when there are no products', async () => {
    await completeOnboarding();
    renderAt('/products');
    expect(await screen.findByText('কোনো পণ্য পাওয়া যায়নি')).toBeTruthy();
  });
});

describe('help screen', () => {
  it('documents the offline limits honestly', async () => {
    await completeOnboarding();
    renderAt('/help');
    expect(await screen.findByRole('heading', { name: 'ব্যবহারবিধি' })).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /অফলাইন ও সীমাবদ্ধতা/ }));
    expect(await screen.findByText(/কোনো ক্লাউড ব্যাকআপ বা ডিভাইস-সিঙ্ক নেই/)).toBeTruthy();
  });
});
