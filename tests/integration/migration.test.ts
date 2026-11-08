/**
 * migration.test.ts — the V1 → V2 upgrade, run against a database V1 actually wrote.
 *
 * Requirement H of the V2 brief: "Test migration from an actual V1 database snapshot."
 * These tests do not construct V2 rows and check they still exist — they construct rows
 * that are missing every V2 field (see tests/helpers/v1-database.ts), run the real
 * migration, and then assert both that the old business data is untouched and that the
 * new fields are present and correctly defaulted.
 */

import { describe, expect, it } from 'vitest';
import { randomId } from '@/lib/id';
import { SellerDatabase, SCHEMA_VERSION } from '@/db/db';
import { runMigrations } from '@/db/migrations';
import { V1Database, seedV1, v1SeedRows } from '../helpers/v1-database';

/**
 * Build a throwaway V1 database on a unique name, then open the real (V1+V2)
 * `SellerDatabase` over it and run the migrations. Returns the migrated handle so each
 * test can inspect it.
 */
async function migrateAFreshV1Database(): Promise<SellerDatabase> {
  const name = `v1-migration-${randomId()}`;
  const v1 = new V1Database(name);
  await v1.open();
  await seedV1(v1);
  v1.close();

  const target = new SellerDatabase(name);
  // Opening the V2 class over a V1 file is the upgrade the app performs on first boot.
  await target.open();
  await runMigrations(target);
  return target;
}

describe('V1 → V2 migration', () => {
  it('reports the migration it applied and lands on schema version 2', async () => {
    const name = `v1-migration-${randomId()}`;
    const v1 = new V1Database(name);
    await v1.open();
    await seedV1(v1);
    v1.close();

    const target = new SellerDatabase(name);
    await target.open();
    const result = await runMigrations(target);

    expect(result.previousVersion).toBe(1);
    expect(result.applied).toEqual([2]);
    expect(result.currentVersion).toBe(2);

    const settings = await target.settings.get('app');
    expect(settings?.schemaVersion).toBe(SCHEMA_VERSION);

    target.close();
    await target.delete();
  });

  it('keeps every V1 business record — nothing is dropped or rewritten', async () => {
    const db = await migrateAFreshV1Database();
    const seed = v1SeedRows();

    const order = await db.orders.get('ord-v1-1');
    expect(order).toBeTruthy();
    expect(order?.orderNumber).toBe('ORD-00001');
    // The money that matters most: a seller's historical figures must not move.
    expect(order?.subtotal).toBe(240000);
    expect(order?.total).toBe(246000);
    expect(order?.cogs).toBe(160000);
    expect(order?.deliveryCharge).toBe(6000);
    expect(order?.status).toBe('shipped');
    expect(order?.paymentStatus).toBe('partial');
    expect(order?.items).toHaveLength(1);
    expect(order?.items[0].unitPrice).toBe(120000);
    expect(order?.items[0].lineTotal).toBe(240000);

    const customer = await db.customers.get('cus-v1-1');
    expect(customer?.name).toBe('রিমা আক্তার');
    expect(customer?.phone).toBe('01712345678');
    expect(customer?.tags).toEqual(['পাইকারি']);

    const product = await db.products.get('prd-v1-1');
    expect(product?.name).toBe('থ্রি-পিস লন');
    expect(product?.sellingPrice).toBe(120000);

    const payment = await db.payments.get('pay-v1-1');
    expect(payment?.amount).toBe(100000);

    const expense = await db.expenses.get('exp-v1-1');
    expect(expense?.amount).toBe(25000);
    expect(expense?.categoryName).toBe('প্যাকেজিং');

    // And the seller's own configuration survives too.
    const settings = await db.settings.get('app');
    expect(settings?.business.name).toBe('শাহান ট্রেডার্স');
    expect(settings?.business.registrationNote).toBe('ট্রেড লাইসেন্স: ১২৩৪৫৬');
    expect(settings?.invoice.prefix).toBe('INV');
    // A V1 value must not be replaced by a V2 default.
    expect(settings?.locale.bengaliDigits).toBe(true);

    expect(seed.order.orderNumber).toBe('ORD-00001');

    db.close();
    await db.delete();
  });

  it('adds the promotion fields to V1 orders without inventing a discount', async () => {
    const db = await migrateAFreshV1Database();
    const order = await db.orders.get('ord-v1-1');

    expect(order?.promotionIds).toEqual([]);
    // V1 had no promotions, so the honest historical discount is zero — not a guess.
    expect(order?.promotionDiscount).toBe(0);
    expect(order?.couponCode).toBe('');
    expect(order?.loyaltyPointsEarned).toBe(0);
    expect(order?.loyaltyPointsRedeemed).toBe(0);
    expect(order?.loyaltyDiscount).toBe(0);
    expect(order?.referralId).toBeNull();

    // Every line is marked as NOT a free gift, so no V1 sale is silently reclassified.
    expect(order?.items[0].isFreeGift).toBe(false);
    expect(order?.items[0].promotionId).toBeNull();

    db.close();
    await db.delete();
  });

  it('gives V1 customers a loyalty balance, segment and referral code', async () => {
    const db = await migrateAFreshV1Database();
    const customer = await db.customers.get('cus-v1-1');

    expect(customer?.loyaltyPoints).toBe(0);
    expect(customer?.segment).toBe('');
    expect(customer?.referredByCustomerId).toBeNull();
    // Derived from the V1 customer code, which V1 already guaranteed to be unique.
    expect(customer?.referralCode).toBe('C0001');

    db.close();
    await db.delete();
  });

  it('fills courier slip fields from the linked order, and invents nothing', async () => {
    const db = await migrateAFreshV1Database();
    const record = await db.courierRecords.get('crr-v1-1');

    // Derived from real linked data.
    expect(record?.recipientName).toBe('রিমা আক্তার');
    expect(record?.recipientPhone).toBe('01712345678');
    expect(record?.recipientAddress).toBe('ধনবাড়ী, টাঙ্গাইল');
    expect(record?.district).toBe('টাঙ্গাইল');
    expect(record?.area).toBe('ধনবাড়ী');
    // Declared value = subtotal - discount = 240000 - 0.
    expect(record?.declaredValue).toBe(240000);
    expect(record?.contentsSummary).toContain('থ্রি-পিস লন');
    expect(record?.contentsSummary).toContain('2');

    // Unknowable things stay empty rather than being guessed.
    expect(record?.postcode).toBe('');
    expect(record?.senderSnapshot).toBeNull();
    expect(record?.slipPrintCount).toBe(0);

    // Sensible defaults for the new document fields.
    expect(record?.parcelCount).toBe(1);
    expect(record?.fragile).toBe(false);
    expect(record?.handleWithCare).toBe(false);
    expect(record?.specialInstructions).toBe('');
    expect(record?.sellerNote).toBe('');
    expect(record?.noteTemplateId).toBeNull();

    db.close();
    await db.delete();
  });

  it('adds the V2 configuration blocks without clobbering V1 settings', async () => {
    const db = await migrateAFreshV1Database();
    const settings = await db.settings.get('app');

    expect(settings?.branding).toBeTruthy();
    expect(settings?.branding.showLogoOn.invoice).toBe(true);
    expect(settings?.branding.accent).toBe('indigo');

    expect(settings?.documents.courierSlipPaper).toBe('a4');
    expect(settings?.promotions.enabled).toBe(true);
    expect(settings?.promotions.pointsPerHundredTaka).toBe(1);
    expect(settings?.dashboard.showCharts).toBe(true);

    // Extended business profile fields appear, existing ones are untouched.
    expect(settings?.business.ownerName).toBe('');
    expect(settings?.business.name).toBe('শাহান ট্রেডার্স');

    db.close();
    await db.delete();
  });

  it('seeds the starter note templates exactly once', async () => {
    const db = await migrateAFreshV1Database();
    const first = await db.noteTemplates.count();
    expect(first).toBeGreaterThan(0);

    const templates = await db.noteTemplates.toArray();
    expect(templates.some((t) => t.kind === 'courier_slip')).toBe(true);
    expect(templates.some((t) => t.kind === 'parcel_label')).toBe(true);

    // Idempotency: running the migration again must not duplicate or drop anything.
    await runMigrations(db);
    const second = await db.noteTemplates.count();
    expect(second).toBe(first);

    db.close();
    await db.delete();
  });

  it('is idempotent — a second run changes nothing and keeps the data', async () => {
    const db = await migrateAFreshV1Database();
    const before = await db.orders.get('ord-v1-1');

    // Reset the recorded version so the migration is eligible to run again, which is
    // what happens if the seller closes the tab mid-migration.
    await db.settings.update('app', { schemaVersion: 1 });
    const result = await runMigrations(db);
    expect(result.applied).toEqual([2]);

    const after = await db.orders.get('ord-v1-1');
    expect(after).toEqual(before);
    expect(await db.customers.count()).toBe(1);
    expect(await db.products.count()).toBe(1);
    expect(await db.courierRecords.count()).toBe(1);
    expect(await db.expenses.count()).toBe(1);

    db.close();
    await db.delete();
  });

  it('creates the new V2 tables so the app can write promotions straight away', async () => {
    const db = await migrateAFreshV1Database();
    // Presence of the stores is the point; they start empty because V1 had none of this.
    expect(await db.promotions.count()).toBe(0);
    expect(await db.promotionUsages.count()).toBe(0);
    expect(await db.loyaltyEntries.count()).toBe(0);
    expect(await db.referrals.count()).toBe(0);
    expect(await db.recurringExpenses.count()).toBe(0);
    expect(await db.reminders.count()).toBe(0);

    db.close();
    await db.delete();
  });
});
