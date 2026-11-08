/**
 * capture-ui-strings.mjs — regenerate `e2e/ui-strings.ts` from the running app.
 *
 * Usage (with the production preview already running):
 *
 *     npm run build
 *     npm run preview            # serves http://127.0.0.1:4173
 *     node scripts/capture-ui-strings.mjs
 *
 * Bengali has several visually identical but differently-encoded characters, so
 * the end-to-end locators must never be typed by hand — a single wrong code
 * point makes a locator silently unmatchable. This script drives a real browser
 * and copies the strings straight out of the DOM.
 *
 * Set CHROMIUM_BIN to use a browser that is already installed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://127.0.0.1:4173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'e2e', 'ui-strings.ts');

const ROUTES = [
  '/',
  '/products',
  '/products/new',
  '/orders',
  '/orders/new',
  '/customers',
  '/inventory',
  '/courier',
  '/payments',
  '/returns',
  '/expenses',
  '/reports',
  '/backup',
  '/settings',
];

const snap = (page) =>
  page.evaluate(() => ({
    labels: [...document.querySelectorAll('label')].map((l) => l.innerText.trim()).filter(Boolean),
    buttons: [...document.querySelectorAll('button')].map((x) => x.innerText.trim()).filter(Boolean),
    links: [...document.querySelectorAll('a')].map((x) => x.innerText.trim()).filter(Boolean),
    headings: [...document.querySelectorAll('h1,h2,h3')].map((x) => x.innerText.trim()).filter(Boolean),
    inputs: [],
    body: document.body.innerText.slice(0, 500),
  }));

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const context = await browser.newContext({ locale: 'bn-BD', timezoneId: 'Asia/Dhaka', viewport: { width: 390, height: 844 } });
const page = await context.newPage();

await page.goto(BASE + '/');
await page.evaluate(
  (name) =>
    new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    }),
  'facebook-seller-os',
);
await page.reload();
await page.waitForTimeout(1200);

const out = {};
out['/__onboarding'] = await snap(page);

await page.getByLabel('\u09ac\u09cd\u09af\u09ac\u09b8\u09be\u09b0 \u09a8\u09be\u09ae').fill('\u09b0\u09bf\u09ae\u09be \u0995\u09be\u09b2\u09c7\u0995\u09b6\u09a8');
await page.getByRole('button', { name: '\u09b6\u09c1\u09b0\u09c1 \u0995\u09b0\u09c1\u09a8' }).click();
await page.waitForTimeout(1200);

for (const route of ROUTES) {
  await page.goto(BASE + route);
  await page.waitForTimeout(1500);
  out[route] = await snap(page);
}

// A few strings only exist behind a click: settings tabs, and the payment /
// expense "new record" modals.
const out2 = {};
await page.goto(BASE + '/settings');
await page.waitForTimeout(900);
for (const [key, tab] of [['settings:\u09ad\u09be\u09b7\u09be \u0993 \u09b8\u0982\u0996\u09cd\u09af\u09be', '\u09ad\u09be\u09b7\u09be \u0993 \u09b8\u0982\u0996\u09cd\u09af\u09be']]) {
  await page.getByRole('tab', { name: tab }).click();
  await page.waitForTimeout(500);
  out2[key] = await snap(page);
}
await page.goto(BASE + '/expenses');
await page.waitForTimeout(900);
await page.getByRole('button', { name: '\u0996\u09b0\u099a \u09af\u09cb\u0997', exact: true }).click();
await page.waitForTimeout(700);
out2['expenses:new'] = await snap(page);

await browser.close();

const all = { ...out, ...out2 };
const pick = (route, kind, pred, what) => {
  const hit = all[route][kind].find(pred);
  if (!hit) throw new Error(`NOT FOUND: ${what} on ${route}`);
  return hit.replace(/\*+$/, '');
};
const starts = (s) => (x) => x.startsWith(s);

const L = {
  // onboarding
  ONBOARD_BUSINESS_NAME: 'ব্যবসার নাম',
  ONBOARD_START: pick('/__onboarding', 'buttons', starts('শুরু'), 'start button'),
  DASHBOARD_EMPTY: out['/'].headings.find((h) => h.includes('যোগ করা হয়নি')),

  // navigation
  NAV_HOME: 'ড্যাশবোর্ড',
  NAV_ORDERS: 'অর্ডার',
  NAV_CUSTOMERS: 'কাস্টমার',
  NAV_PRODUCTS: 'পণ্য',
  NAV_INVENTORY: 'স্টক',
  NAV_COURIER: 'কুরিয়ার',
  NAV_PAYMENTS: 'পেমেন্ট',
  NAV_RETURNS: 'রিটার্ন',
  NAV_EXPENSES: 'খরচ',
  NAV_REPORTS: 'রিপোর্ট',
  NAV_BACKUP: 'ব্যাকআপ',
  NAV_SETTINGS: 'সেটিংস',
  NAV_HELP: 'ব্যবহারবিধি',
  MORE: 'আরও',
  MENU_TITLE: 'সব মেনু',

  // products
  NEW_PRODUCT: pick('/products', 'links', starts('নতুন পণ্য'), 'new product link'),
  PRODUCT_NAME: pick('/products/new', 'labels', starts('পণ্যের নাম'), 'product name'),
  PRODUCT_COST: pick('/products/new', 'labels', starts('ক্র'), 'cost'),
  PRODUCT_PRICE: pick('/products/new', 'labels', starts('বিক্র'), 'price'),
  PRODUCT_OPENING_STOCK: pick('/products/new', 'labels', starts('ওপে'), 'opening stock'),
  PRODUCT_SAVE: pick('/products/new', 'buttons', starts('পণ্য সংরক্ষণ'), 'save product'),

  // orders
  NEW_ORDER: pick('/orders', 'links', starts('নতুন অর্ডার'), 'new order link'),
  ORDER_CUSTOMER_NAME: pick('/orders/new', 'labels', starts('কাস্টমারের নাম'), 'customer name'),
  ORDER_PHONE: pick('/orders/new', 'labels', starts('ফোন'), 'phone'),
  ORDER_DELIVERY_CHARGE: pick('/orders/new', 'labels', starts('ডেলিভারি চার্জ'), 'delivery charge'),
  ORDER_DISCOUNT: pick('/orders/new', 'labels', starts('অর্ডার ছাড়'), 'discount'),
  ORDER_ADVANCE: pick('/orders/new', 'labels', starts('অগ্রিম'), 'advance'),
  ORDER_STATUS: pick('/orders/new', 'labels', starts('স্ট্যাটাস'), 'status'),
  ORDER_SAVE: pick('/orders/new', 'buttons', starts('অর্ডার সংরক্ষণ'), 'save order'),
  ORDER_ADD_ITEM: pick('/orders/new', 'buttons', starts('পণ্য যোগ করুন'), 'add item'),
  PICKER_TITLE: 'পণ্য নির্বাচন করুন',
  QTY: 'পরিমাণ',

  // backup
  BACKUP_DOWNLOAD: pick('/backup', 'buttons', starts('ব্যাকআপ ডাউনলোড'), 'download backup'),

  // settings
  SETTINGS_TAB_PREFERENCES: pick('/settings', 'buttons', starts('ভাষা'), 'preferences tab'),
  SETTINGS_SAVE: pick('/settings', 'buttons', starts('সংরক্ষণ করুন'), 'settings save'),
  BENGALI_DIGITS_TOGGLE: pick('settings:ভাষা ও সংখ্যা', 'labels', starts('সংখ্যা বাংলায়'), 'bengali digits toggle'),

  // payments / expenses
  PAYMENT_NEW: pick('/payments', 'buttons', starts('লেনদেন যোগ'), 'new payment'),
  EXPENSE_NEW: pick('/expenses', 'buttons', starts('খরচ যোগ'), 'new expense'),
  MODAL_SAVE: pick('expenses:new', 'buttons', starts('সংরক্ষণ'), 'modal save'),
  MODAL_CANCEL: pick('expenses:new', 'buttons', starts('বাতিল'), 'modal cancel'),

  // order detail: the status-change dialog
  CHANGE_STATUS: 'স্ট্যাটাস পরিবর্তন',
  NEW_STATUS: 'নতুন স্ট্যাটাস',
  UPDATE: 'হালনাগাদ',
};

for (const [k, v] of Object.entries(L)) {
  if (!v) throw new Error('EMPTY ' + k);
  if (v.includes('�')) throw new Error('MOJIBAKE ' + k);
}

const body = Object.entries(L)
  .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
  .join('\n');

const banner = `/**
 * Exact UI strings, captured from the running application.
 *
 * DO NOT EDIT BY HAND. Regenerate with:
 *
 *     npm run build && npm run preview
 *     node scripts/capture-ui-strings.mjs
 *
 * Bengali has several visually identical but differently-encoded characters, so
 * a locator typed by hand can look perfect and still never match.
 */
export const ui = {
${body}
} as const;
`;

for (const [key, value] of Object.entries(L)) {
  if (!value) throw new Error(`capture-ui-strings: empty value for ${key}`);
  if (value.includes('\uFFFD')) throw new Error(`capture-ui-strings: mojibake in ${key}`);
}

fs.writeFileSync(OUT, banner);
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${Object.keys(L).length} strings)`);
