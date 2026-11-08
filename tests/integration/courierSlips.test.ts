/**
 * courierSlips.test.ts — the courier documents and their money (V2).
 *
 * The COD figure is the one that can cost a seller real taka: if the app says "collect
 * 1,460" when the customer already paid 500 in advance, the customer is charged twice.
 * These tests pin that rule down using the actual payment ledger, not a hardcoded number.
 */

import { describe, expect, it } from 'vitest';
import type { CourierInput as CourierRecordInput } from '@/domain/schemas';
import { db } from '@/db/db';
import { fromDateInputValue } from '@/lib/date';
import { parseMoney } from '@/lib/money';
import {
  advancePaidForOrder,
  buildCourierSlip,
  buildCourierSlips,
  courierSummary,
  createNoteTemplate,
  defaultNoteFor,
  listNoteTemplates,
  markSlipPrinted,
  updateNoteTemplate,
  updateSlipFields,
} from '@/services/courierSlipService';
import { computeSlipMoney } from '@/finance/courierSlip';
import { recordOrderPayment, voidPayment } from '@/services/paymentService';
import { createOrder } from '@/services/orderService';
import { getSettings, updateSettings } from '@/services/settingsService';
import { line, orderInput, seedCustomer, seedProductWithStock } from '../helpers/factories';

const tk = parseMoney;
const DHACA_TODAY = fromDateInputValue('2026-11-08') ?? Date.now();
const SHIP_DATE = DHACA_TODAY;

/**
 * Each test file gets its own IndexedDB, so there is nothing to reset — but the shop
 * name has to be set explicitly because the slip reads the sender from it.
 */
async function setShopName(name: string): Promise<void> {
  await updateSettings({ business: { ...(await getSettings()).business, name } });
}

async function seedConsignment(partial: Partial<CourierRecordInput> = {}) {
  const { createCourierRecord } = await import('@/services/courierService');
  const product = await seedProductWithStock(20, '400', '700');
  const customer = await seedCustomer({ name: 'রহিমা বেগম', phone: '01712 345678' });
  const order = await createOrder(
    orderInput({
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: '১২/এ, মিরপুর ১০',
      items: [line(product.id, 1, '700')],
      status: 'confirmed',
      orderDate: DHACA_TODAY,
      deliveryCharge: tk('60'),
    }),
  );
  const record = await createCourierRecord({
    providerId: null,
    courierName: 'পাঠাও',
    consignmentId: 'CN-1',
    orderId: order.id,
    shipmentDate: SHIP_DATE,
    status: 'pending',
    deliveryCharge: tk('60'),
    customerDeliveryCharge: tk('60'),
    codAmount: tk('760'),
    collectedAmount: 0,
    courierFee: tk('30'),
    returnFee: 0,
    adjustment: 0,
    payoutDate: null,
    payoutReference: '',
    note: '',
    ...partial,
  } as CourierRecordInput);
  return { record, order, product };
}

describe('COD arithmetic', () => {
  it('asks the courier to collect what is still owed, not the whole order', () => {
    const money = computeSlipMoney({
      orderTotal: tk('1460'),
      deliveryCharge: tk('60'),
      advancePaid: tk('500'),
      courierCharge: tk('60'),
      productValue: tk('1400'),
    });
    expect(money.codToCollect).toBe(tk('960'));
    expect(money.fullyPrepaid).toBe(false);
  });

  it('collects nothing when the customer has already paid in full', () => {
    const money = computeSlipMoney({
      orderTotal: tk('1460'),
      deliveryCharge: tk('60'),
      advancePaid: tk('1460'),
      courierCharge: tk('60'),
      productValue: tk('1400'),
    });
    expect(money.codToCollect).toBe(0);
    expect(money.fullyPrepaid).toBe(true);
  });

  it('never produces a negative COD when the customer overpays', () => {
    const money = computeSlipMoney({
      orderTotal: tk('1000'),
      deliveryCharge: 0,
      advancePaid: tk('1500'),
      courierCharge: 0,
      productValue: tk('1000'),
    });
    expect(money.codToCollect).toBe(0);
  });

  it('keeps the courier charge out of what the customer is asked for', () => {
    const money = computeSlipMoney({
      orderTotal: tk('1000'),
      deliveryCharge: 0,
      advancePaid: 0,
      courierCharge: tk('120'),
      productValue: tk('1000'),
    });
    expect(money.codToCollect).toBe(tk('1000'));
    expect(money.courierCharge).toBe(tk('120'));
  });
});

describe('building a slip from real records', () => {
  it('fills the recipient and the contents from the linked order', async () => {
    await setShopName('শাহান স্টোর');
    const { record, order } = await seedConsignment();
    const slip = await buildCourierSlip(record.id);

    expect(slip.order?.id).toBe(order.id);
    expect(slip.recipient.name).toBe('রহিমা বেগম');
    // The order keeps the normalised digits; the printed slip formats them for reading.
    expect(slip.recipient.phone.replace(/\D/g, '')).toBe('01712345678');
    expect(slip.recipient.address).toBe('১২/এ, মিরপুর ১০');
    expect(slip.contents).toHaveLength(1);
    expect(slip.contents[0].quantity).toBe(1);
    expect(slip.money.orderTotal).toBe(order.total);
  });

  it('brings the COD down by whatever the customer has actually paid', async () => {
    await setShopName('শাহান স্টোর');
    const { record, order } = await seedConsignment();
    await recordOrderPayment({
      orderId: order.id,
      amount: tk('500'),
      method: 'bkash',
      date: SHIP_DATE,
      reference: '',
      note: '',
    });

    const slip = await buildCourierSlip(record.id);
    expect(await advancePaidForOrder(order.id)).toBe(tk('500'));
    // 760 declared − 500 already in hand.
    expect(slip.money.advancePaid).toBe(tk('500'));
    expect(slip.money.codToCollect).toBe(tk('260'));
  });

  it('ignores a voided payment when working out the advance', async () => {
    const { record, order } = await seedConsignment();
    const payment = await recordOrderPayment({
      orderId: order.id,
      amount: tk('500'),
      method: 'bkash',
      date: SHIP_DATE,
      reference: '',
      note: '',
    });
    await voidPayment(payment.id, 'ভুল');

    const slip = await buildCourierSlip(record.id);
    expect(slip.money.advancePaid).toBe(0);
    expect(slip.money.codToCollect).toBe(tk('760'));
  });

  it('draws a barcode for an ASCII consignment id and refuses a Bangla one', async () => {
    await setShopName('শাহান স্টোর');
    const { record } = await seedConsignment({ consignmentId: 'PT-998877' });
    const slip = await buildCourierSlip(record.id);
    expect(slip.barcodeSvg).toContain('<svg');
    expect(slip.barcodeSvg).toContain('PT-998877');

    await db.courierRecords.update(record.id, { consignmentId: 'পার্সেল-১' });
    const bangla = await buildCourierSlip(record.id);
    expect(bangla.barcodeSvg).toBeNull();
  });

  it('never lets a consignment id inject markup into the barcode', async () => {
    await setShopName('শাহান স্টোর');
    const { record } = await seedConsignment({ consignmentId: '</text><script>alert(1)</script>' });
    const slip = await buildCourierSlip(record.id);
    expect(slip.barcodeSvg).not.toContain('<script');
    expect(slip.barcodeSvg).toContain('&lt;script&gt;');
  });

  it('emits a QR carrying the consignment id and the order number', async () => {
    await setShopName('শাহান স্টোর');
    const { record, order } = await seedConsignment({ consignmentId: 'PT-998877' });
    const slip = await buildCourierSlip(record.id);
    expect(slip.qrSvg).toContain('<svg');
    expect(slip.qrSvg).toContain(`PT-998877|${order.orderNumber}`);
  });

  it('carries the sender identity from the business profile and freezes it on the record', async () => {
    await setShopName('শাহান স্টোর');
    const { record } = await seedConsignment();
    const first = await buildCourierSlip(record.id);
    expect(first.sender.name).toBe('শাহান স্টোর');

    // Rename the shop; a reprint of a slip already produced must keep the old name.
    await setShopName('নতুন নাম');
    const reprint = await buildCourierSlip(record.id);
    expect(reprint.sender.name).toBe('শাহান স্টোর');
  });
});

describe('the slip fields the seller edits by hand', () => {
  it('keeps a manually typed tracking id exactly as written', async () => {
    await setShopName('শাহান স্টোর');
    const { record } = await seedConsignment({ consignmentId: '' });
    await updateSlipFields(record.id, {
      parcelCount: 3,
      fragile: true,
      handleWithCare: true,
      specialInstructions: 'দুপুরের পর ডেলিভারি দেবেন',
      sellerNote: 'বিকেলে কল করবেন',
      area: 'মিরপুর',
      district: 'ঢাকা',
      postcode: '1216',
    });
    const updated = await db.courierRecords.get(record.id);
    expect(updated?.parcelCount).toBe(3);
    expect(updated?.fragile).toBe(true);
    expect(updated?.handleWithCare).toBe(true);
    expect(updated?.specialInstructions).toBe('দুপুরের পর ডেলিভারি দেবেন');
    expect(updated?.sellerNote).toBe('বিকেলে কল করবেন');

    const slip = await buildCourierSlip(record.id);
    expect(slip.recipient.area).toBe('মিরপুর');
    expect(slip.recipient.district).toBe('ঢাকা');
    expect(slip.recipient.postcode).toBe('1216');
  });

  it('never accepts a parcel count below one', async () => {
    await setShopName('শাহান স্টোর');
    const { record } = await seedConsignment();
    await updateSlipFields(record.id, { parcelCount: 0 });
    expect((await db.courierRecords.get(record.id))?.parcelCount).toBe(1);
  });

  it('counts each print, so a reprint is visible', async () => {
    await setShopName('শাহান স্টোর');
    const { record } = await seedConsignment();
    await markSlipPrinted([record.id]);
    await markSlipPrinted([record.id]);
    const updated = await db.courierRecords.get(record.id);
    expect(updated?.slipPrintCount).toBe(2);
    expect(updated?.lastSlipPrintedAt).toBeGreaterThan(0);
  });

  it('builds a whole batch for bulk printing', async () => {
    await setShopName('শাহান স্টোর');
    const a = await seedConsignment({ consignmentId: 'A-1' });
    const b = await seedConsignment({ consignmentId: 'B-1' });
    const slips = await buildCourierSlips([a.record.id, b.record.id]);
    expect(slips.map((s) => s.record.consignmentId).sort()).toEqual(['A-1', 'B-1']);
  });
});

describe('note templates', () => {
  it('saves a note and puts it on the slip', async () => {
    await setShopName('শাহান স্টোর');
    const template = await createNoteTemplate({
      kind: 'courier_slip',
      name: 'ভঙ্গুর সতর্কতা',
      body: 'দয়া করে সাবধানে হ্যান্ডেল করুন।',
      footer: 'ধন্যবাদ',
      align: 'center',
      fontScale: 'large',
      isActive: true,
      isDefault: true,
    });
    expect((await listNoteTemplates('courier_slip')).map((t) => t.name)).toContain('ভঙ্গুর সতর্কতা');
    expect((await defaultNoteFor('courier_slip'))?.id).toBe(template.id);

    const { record } = await seedConsignment();
    const slip = await buildCourierSlip(record.id, { noteTemplateId: template.id });
    expect(slip.note?.body).toContain('সাবধানে হ্যান্ডেল');
    expect(slip.note?.fontScale).toBe('large');
  });

  it('keeps only one default per kind', async () => {
    await setShopName('শাহান স্টোর');
    const first = await createNoteTemplate({
      kind: 'courier_slip', name: 'প্রথম', body: '', footer: '', isActive: true, isDefault: true,
    });
    const second = await createNoteTemplate({
      kind: 'courier_slip', name: 'দ্বিতীয়', body: '', footer: '', isActive: true, isDefault: true,
    });
    expect((await db.noteTemplates.get(first.id))?.isDefault).toBe(false);
    expect((await db.noteTemplates.get(second.id))?.isDefault).toBe(true);
  });

  it('lets a saved note be edited', async () => {
    await setShopName('শাহান স্টোর');
    const template = await createNoteTemplate({
      kind: 'courier_slip', name: 'নোট', body: 'পুরনো', footer: '', isActive: true, isDefault: false,
    });
    await updateNoteTemplate(template.id, {
      kind: 'courier_slip', name: 'নোট', body: 'নতুন', footer: '', isActive: true, isDefault: false,
    });
    expect((await db.noteTemplates.get(template.id))?.body).toBe('নতুন');
  });

  it('keeps notes meant for a parcel label separate from ones meant for a slip', async () => {
    await setShopName('শাহান স্টোর');
    await createNoteTemplate({ kind: 'parcel_label', name: 'লেবেল নোট', body: '', footer: '', isActive: true, isDefault: false });
    await createNoteTemplate({ kind: 'courier_slip', name: 'স্লিপ নোট', body: '', footer: '', isActive: true, isDefault: false });
    expect((await listNoteTemplates('parcel_label')).map((t) => t.name)).toEqual(['লেবেল নোট']);
    expect((await listNoteTemplates()).length).toBe(2);
  });
});

describe('courier-wise reporting', () => {
  it('groups shipments by courier and separates what arrived from what did not', async () => {
    await setShopName('শাহান স্টোর');
    await seedConsignment({ consignmentId: 'A-1', courierName: 'পাঠাও', status: 'delivered', collectedAmount: tk('760') });
    await seedConsignment({ consignmentId: 'A-2', courierName: 'পাঠাও', status: 'returned', collectedAmount: 0 });
    await seedConsignment({ consignmentId: 'B-1', courierName: 'স্টেডফাস্ট', status: 'delivered', collectedAmount: tk('760') });
    await seedConsignment({ consignmentId: 'C-1', courierName: 'রেডএক্স', status: 'lost', collectedAmount: 0 });

    const rows = await courierSummary();
    const pathao = rows.find((r) => r.courierName === 'পাঠাও');
    expect(pathao?.shipments).toBe(2);
    expect(pathao?.delivered).toBe(1);
    expect(pathao?.returned).toBe(1);
    expect(pathao?.codCollected).toBe(tk('760'));

    const redx = rows.find((r) => r.courierName === 'রেডএক্স');
    expect(redx?.failed).toBe(1);
    expect(redx?.delivered).toBe(0);

    // A returned parcel is a failure to deliver, but the declared COD is still what
    // was at stake — the report shows both, never one dressed up as the other.
    expect(pathao?.codDeclared).toBe(tk('1520'));
  });

  it('returns an empty report rather than inventing a courier', async () => {
    expect(await courierSummary()).toEqual([]);
  });
});
