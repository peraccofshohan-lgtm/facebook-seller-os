/**
 * courierSlips.test.tsx — what the seller actually sees on a courier document.
 *
 * These render the real slip and label components against a real courier record, because
 * "the data is right" and "the seller can read it" are different claims. The COD figure
 * appears on screen in taka, the barcode is real markup rather than a placeholder box,
 * and — the assertion that matters most here — the developer's name is nowhere on it.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CourierBookingSlip } from '@/features/courier/CourierBookingSlip';
import { ParcelLabel } from '@/features/courier/ParcelLabel';
import { buildCourierSlip, createNoteTemplate, updateSlipFields } from '@/services/courierSlipService';
import { createCourierRecord } from '@/services/courierService';
import { recordOrderPayment } from '@/services/paymentService';
import { createOrder } from '@/services/orderService';
import { getSettings, updateSettings } from '@/services/settingsService';
import { fromDateInputValue } from '@/lib/date';
import { parseMoney } from '@/lib/money';
import { SOFTWARE_DEVELOPER } from '@/domain/constants';
import { line, orderInput, seedCustomer, seedProductWithStock } from '../helpers/factories';
import type { Settings } from '@/domain/types';

const tk = parseMoney;
const SHIP_DATE = fromDateInputValue('2026-11-08') ?? Date.now();

async function seedScenario(consignmentId = 'PT-998877') {
  await updateSettings({
    business: {
      ...(await getSettings()).business,
      name: 'রিমা কালেকশন',
      ownerName: 'রিমা আক্তার',
      phone: '01712345678',
      address: '১২, মেইন রোড',
      area: 'ধনবাড়ী',
      district: 'টাঙ্গাইল',
    },
  });
  const product = await seedProductWithStock(20, '400', '700');
  const customer = await seedCustomer({ name: 'রহিমা বেগম', phone: '01712345000' });
  const order = await createOrder(
    orderInput({
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: '৪৫/বি, মিরপুর ১০',
      items: [line(product.id, 1, '700')],
      status: 'confirmed',
      deliveryCharge: tk('60'),
    }),
  );
  const record = await createCourierRecord({
    providerId: null,
    courierName: 'পাঠাও',
    consignmentId,
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
  } as Parameters<typeof createCourierRecord>[0]);
  return { record, order, product, customer };
}

async function settings(): Promise<Settings> {
  return getSettings();
}

describe('the booking slip', () => {
  it('is filled in from the order — the seller should not retype what the app already knows', async () => {
    const { record } = await seedScenario();
    const slip = await buildCourierSlip(record.id);
    const { container } = render(<CourierBookingSlip slip={slip} settings={await settings()} />);

    expect(screen.getByText('কুরিয়ার বুকিং স্লিপ')).toBeTruthy();
    // The shop name appears in the letterhead AND in the প্রেরক box — a courier needs
    // a clearly marked FROM block even when the letterhead already says who sent it.
    expect(screen.getAllByText('রিমা কালেকশন').length).toBeGreaterThan(0);
    expect(screen.getByText('রহিমা বেগম')).toBeTruthy();
    expect(screen.getAllByText(/মিরপুর ১০/).length).toBeGreaterThan(0);
    // The barcode caption repeats the consignment id — that is deliberate, so a
    // torn label can still be read by hand.
    expect(screen.getAllByText('PT-998877').length).toBeGreaterThan(0);
    // One product line, printed as a row rather than a free-text blob.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('shows the COD the courier must collect, in taka', async () => {
    const { record } = await seedScenario();
    const slip = await buildCourierSlip(record.id);
    render(<CourierBookingSlip slip={slip} settings={await settings()} />);

    expect(slip.money.codToCollect).toBe(tk('760'));
    expect(screen.getAllByText(/৭৬০/).length).toBeGreaterThan(0);
  });

  it('drops the COD by the advance the customer already paid', async () => {
    const { record, order } = await seedScenario('PT-500');
    await recordOrderPayment({ orderId: order.id, amount: tk('500'), method: 'bkash', date: SHIP_DATE });
    const slip = await buildCourierSlip(record.id);
    render(<CourierBookingSlip slip={slip} settings={await settings()} />);

    expect(slip.money.codToCollect).toBe(tk('260'));
    expect(screen.getAllByText(/২৬০/).length).toBeGreaterThan(0);
  });

  it('prints the seller note they designed', async () => {
    const { record } = await seedScenario('PT-NOTE');
    const template = await createNoteTemplate({
      kind: 'courier_slip',
      name: 'ভঙ্গুর সতর্কতা',
      body: 'দয়া করে সাবধানে হ্যান্ডেল করুন।',
      footer: 'ধন্যবাদ',
      isActive: true,
      isDefault: true,
    });
    const slip = await buildCourierSlip(record.id, { noteTemplateId: template.id });
    render(<CourierBookingSlip slip={slip} settings={await settings()} />);

    expect(screen.getByText(/সাবধানে হ্যান্ডেল করুন/)).toBeTruthy();
  });

  it('shouts when a parcel is fragile', async () => {
    const { record } = await seedScenario('PT-FRAGILE');
    await updateSlipFields(record.id, { fragile: true, handleWithCare: true });
    const slip = await buildCourierSlip(record.id);
    render(<CourierBookingSlip slip={slip} settings={await settings()} />);

    expect(screen.getByText(/ভঙ্গুর/)).toBeTruthy();
    expect(screen.getByText(/HANDLE WITH CARE/)).toBeTruthy();
  });

  it('draws a real barcode instead of an empty box', async () => {
    const { record } = await seedScenario();
    const slip = await buildCourierSlip(record.id);
    const { container } = render(<CourierBookingSlip slip={slip} settings={await settings()} />);

    const svg = container.querySelector('svg[aria-label^="বারকোড"]');
    expect(svg).toBeTruthy();
    // A Code 128 barcode is a stack of black bars — if none were drawn the label is fake.
    expect(svg!.querySelectorAll('rect[fill="#000"]').length).toBeGreaterThan(10);
  });

  it('never carries the software developer onto a courier document', async () => {
    const { record } = await seedScenario('PT-IDENTITY');
    const slip = await buildCourierSlip(record.id);
    const { container } = render(<CourierBookingSlip slip={slip} settings={await settings()} />);

    expect(container.textContent).not.toContain(SOFTWARE_DEVELOPER.name);
    expect(container.textContent).not.toContain(SOFTWARE_DEVELOPER.email);
  });
});

describe('the parcel label', () => {
  it('carries everything a courier sorter needs', async () => {
    const { record, order } = await seedScenario('PT-LABEL');
    const slip = await buildCourierSlip(record.id);
    const { container } = render(<ParcelLabel slip={slip} settings={await settings()} />);

    expect(screen.getByText(/প্রাপক/)).toBeTruthy();
    expect(screen.getByText('রহিমা বেগম')).toBeTruthy();
    expect(screen.getByText(/01712 345000/)).toBeTruthy();
    expect(screen.getAllByText('PT-LABEL').length).toBeGreaterThan(0);
    expect(screen.getAllByText(order.orderNumber).length).toBeGreaterThan(0);
    expect(container.textContent).toContain('পাঠাও');
  });

  it('shows the COD amount the courier collects, or says it is already paid', async () => {
    const { record, order } = await seedScenario('PT-COD');
    let slip = await buildCourierSlip(record.id);
    const first = render(<ParcelLabel slip={slip} settings={await settings()} />);
    expect(first.container.textContent).toContain('COD আদায়');
    expect(first.container.textContent).toContain('৷'.replace('৷', '৳') + '৭৬০');
    first.unmount();

    await recordOrderPayment({ orderId: order.id, amount: tk('760'), method: 'cash', date: SHIP_DATE });
    slip = await buildCourierSlip(record.id);
    const second = render(<ParcelLabel slip={slip} settings={await settings()} />);
    expect(second.container.textContent).toContain('অগ্রিম পরিশোধিত');
  });

  it('keeps the developer name off the label too', async () => {
    const { record } = await seedScenario('PT-LABEL-ID');
    const slip = await buildCourierSlip(record.id);
    const { container } = render(<ParcelLabel slip={slip} settings={await settings()} />);
    expect(container.textContent).not.toContain(SOFTWARE_DEVELOPER.name);
  });
});
