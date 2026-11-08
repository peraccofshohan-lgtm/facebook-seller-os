import { describe, expect, it } from 'vitest';
import { addTag, allTags, createCustomer, customerStats, duplicateWarnings, findByPhone, getCustomer, updateCustomer } from '@/services/customerService';
import { createOrder } from '@/services/orderService';
import { recordOrderPayment } from '@/services/paymentService';
import { parseMoney } from '@/lib/money';
import { customerInput, line, orderInput, seedProductWithStock } from '../helpers/factories';

const tk = parseMoney;

describe('customers', () => {
  it('assigns an incrementing customer code', async () => {
    const a = await createCustomer(customerInput({ name: 'রিমা', phone: '01711111111' }));
    const b = await createCustomer(customerInput({ name: 'করিম', phone: '01722222222' }));
    expect(a.code).toBe('C0001');
    expect(b.code).toBe('C0002');
  });

  it('normalises phone numbers before storing them', async () => {
    const customer = await createCustomer(customerInput({ name: 'রিমা', phone: '+88 01712-345678' }));
    expect(customer.phone).toBe('01712345678');
    expect((await findByPhone('01712345678')).length).toBe(1);
    expect((await findByPhone('+8801712345678')).length).toBe(1);
    // The stored history is keyed on the normalised number, so a differently
    // formatted number still finds the same person.
    expect((await findByPhone('01712 345 678'))[0].id).toBe(customer.id);
  });

  it('warns about a possible duplicate but never merges automatically', async () => {
    await createCustomer(customerInput({ name: 'রিমা আক্তার', phone: '01712345678' }));
    const warnings = await duplicateWarnings({ name: 'রিমা আক্তার', phone: '01712345678' });
    expect(warnings.length).toBeGreaterThan(0);

    // Both records must still exist afterwards — the app only ever warns.
    const created = await createCustomer(customerInput({ name: 'রিমা আক্তার', phone: '01712345678' }));
    expect(created.id).toBeTruthy();
    expect((await findByPhone('01712345678')).length).toBe(2);
  });

  it('keeps lifetime stats derived from real orders', async () => {
    const product = await seedProductWithStock(20, '400', '700');
    const customer = await createCustomer(customerInput({ name: 'রিমা', phone: '01712345678' }));

    const order = await createOrder(
      orderInput({ customerId: customer.id, customerName: 'রিমা', items: [line(product.id, 2, '700')], deliveryCharge: tk('60') }),
    );
    await recordOrderPayment({ orderId: order.id, amount: tk('1460'), method: 'cash', date: Date.now(), reference: '', note: '' });

    const stats = await customerStats(customer.id);
    expect(stats.orderCount).toBe(1);
    // Lifetime purchase uses the customer-payable total (goods + delivery charge).
    expect(stats.totalPurchase).toBe(tk('1460'));
    expect(stats.totalPaid).toBe(tk('1460'));
    expect(stats.outstanding).toBe(0);
    expect(stats.lastOrderAt).toBeGreaterThan(0);

    // The customer record caches the last order date for sorting.
    expect((await getCustomer(customer.id))?.lastOrderAt).toBeGreaterThan(0);
  });

  it('supports tagging without duplicating tags', async () => {
    const customer = await createCustomer(customerInput({ name: 'রিমা', phone: '01712345678' }));
    await addTag(customer.id, 'ভিআইপি');
    await addTag(customer.id, 'ভিআইপি');
    await addTag(customer.id, 'পাইকারি');
    const updated = await getCustomer(customer.id);
    expect(updated?.tags).toEqual(['ভিআইপি', 'পাইকারি']);
    expect(allTags([updated!])).toEqual(['পাইকারি', 'ভিআইপি']);
  });

  it('updates without wiping untouched fields', async () => {
    const customer = await createCustomer({ ...customerInput({ name: 'রিমা' }), address: 'টাঙ্গাইল' });
    await updateCustomer(customer.id, { name: 'রিমা খাতুন' });
    const updated = await getCustomer(customer.id);
    expect(updated?.name).toBe('রিমা খাতুন');
    expect(updated?.address).toBe('টাঙ্গাইল');
    expect(updated?.phone).toBe('01712345678');
  });
});
