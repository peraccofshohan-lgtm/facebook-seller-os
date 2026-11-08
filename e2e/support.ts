/**
 * support.ts — shared helpers for the end-to-end suite.
 *
 * Every test starts from a completely empty IndexedDB, so tests are independent
 * and their assertions describe a real first-run experience rather than
 * whatever a previous test happened to leave behind.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { ui } from './ui-strings';

export const DB_NAME = 'facebook-seller-os';
export const BASE = 'http://127.0.0.1:4173';

/** Wipe the local database and reload, as if the app had just been installed. */
export async function resetApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
    DB_NAME,
  );
  await page.reload();
}

/**
 * Walk through the first-run setup screen.
 *
 * `latinDigits: true` also switches the "সংখ্যা বাংলায় দেখান" setting off, so the
 * rest of a test can assert on `৳1,460`-style amounts. Tests that specifically
 * check the digit setting pass `false`.
 */
export async function onboard(
  page: Page,
  options: { businessName?: string; latinDigits?: boolean } = {},
): Promise<void> {
  const { businessName = 'রিমা কালেকশন', latinDigits = true } = options;

  await page.getByLabel(ui.ONBOARD_BUSINESS_NAME).fill(businessName);
  await page.getByRole('button', { name: ui.ONBOARD_START }).click();
  await expect(page.getByText(ui.DASHBOARD_EMPTY)).toBeVisible();

  if (latinDigits) await setBengaliDigits(page, false);
}

/** Toggle "সংখ্যা বাংলায় দেখান" and save it from the Settings screen. */
export async function setBengaliDigits(page: Page, enabled: boolean): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('tab', { name: ui.SETTINGS_TAB_PREFERENCES }).click();
  const toggle = page.getByLabel(ui.BENGALI_DIGITS_TOGGLE);
  if ((await toggle.isChecked()) !== enabled) await toggle.click();
  await page.getByRole('button', { name: ui.SETTINGS_SAVE }).click();
  await expect(page.getByRole('tab', { name: ui.SETTINGS_TAB_PREFERENCES })).toBeVisible();
}

/**
 * Navigate the way a seller on a phone would: the four primary destinations sit
 * in the bottom bar, everything else lives behind the "আরও" menu.
 */
export async function openScreen(page: Page, label: string): Promise<void> {
  const bottomBar = page.getByRole('navigation', { name: 'নিচের নেভিগেশন' });
  const direct = bottomBar.getByRole('link', { name: label, exact: true });
  if (await direct.count()) {
    await direct.click();
  } else {
    await bottomBar.getByRole('button', { name: ui.MORE }).click();
    await page.getByRole('dialog').getByRole('link', { name: label, exact: true }).click();
  }
  await expect(page.getByRole('heading').first()).toBeVisible();
}

/** Create a product through the normal UI and wait for it to appear in the list. */
export async function addProduct(
  page: Page,
  product: { name: string; cost: string; price: string; stock: string },
): Promise<void> {
  await openScreen(page, ui.NAV_PRODUCTS);
  await page.getByRole('link', { name: ui.NEW_PRODUCT }).click();
  // "ক্রয়মূল্য" is a substring of "বিক্রয়মূল্য", so these must match exactly.
  await page.getByRole('textbox', { name: `${ui.PRODUCT_NAME}*`, exact: true }).fill(product.name);
  await page.getByRole('textbox', { name: `${ui.PRODUCT_COST}*`, exact: true }).fill(product.cost);
  await page.getByRole('textbox', { name: `${ui.PRODUCT_PRICE}*`, exact: true }).fill(product.price);
  await page.getByLabel(ui.PRODUCT_OPENING_STOCK, { exact: true }).fill(product.stock);
  await page.getByRole('button', { name: ui.PRODUCT_SAVE }).click();
  // Saving opens the product's own page (not the list), so wait for that URL.
  await expect(page).toHaveURL(/\/products\/[^/]+$/);
  await expect(page.getByText(product.name).first()).toBeVisible();
}

export interface OrderDraft {
  customerName: string;
  phone: string;
  productName: string;
  quantity: string;
  deliveryCharge?: string;
  advance?: string;
  status?: string;
}

/** Create an order through the normal UI. Returns the order-detail URL. */
export async function createOrder(page: Page, draft: OrderDraft): Promise<string> {
  await openScreen(page, ui.NAV_ORDERS);
  await page.getByRole('link', { name: ui.NEW_ORDER }).click();

  await page.getByLabel(ui.ORDER_CUSTOMER_NAME).fill(draft.customerName);
  await page.getByLabel(ui.ORDER_PHONE).fill(draft.phone);

  await page.getByRole('button', { name: ui.ORDER_ADD_ITEM }).click();
  const picker = page.getByRole('dialog');
  await expect(picker.getByText(draft.productName).first()).toBeVisible();
  await picker.getByText(draft.productName).first().click();

  await page.getByLabel(ui.QTY).fill(draft.quantity);
  if (draft.deliveryCharge !== undefined) {
    await page.getByLabel(ui.ORDER_DELIVERY_CHARGE).fill(draft.deliveryCharge);
  }
  if (draft.advance !== undefined) {
    await page.getByLabel(ui.ORDER_ADVANCE).fill(draft.advance);
  }
  if (draft.status !== undefined) {
    await page.getByLabel(ui.ORDER_STATUS).selectOption(draft.status);
  }
  await page.getByRole('button', { name: ui.ORDER_SAVE }).click();
  // Must be a real order id — "/orders/new" also matches a naive `\/orders\/.+`.
  await expect(page).toHaveURL(/\/orders\/(?!new)[^/]+$/);
  return page.url();
}

/**
 * Text locator that ignores the hidden desktop-only table cells.
 *
 * `DataTable` renders both a `<table>` (desktop) and a `<ul>` of cards (mobile)
 * from the same rows, so a plain text locator can resolve to the invisible copy.
 */
export function visibleText(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

/** Read the whole visible page text (useful for "nothing is fabricated" checks). */
export async function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

export { ui };
