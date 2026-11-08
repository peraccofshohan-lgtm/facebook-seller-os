import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { MoneyInput, SearchInput } from '@/components/ui/Controls';
import { ErrorBanner, InfoBanner } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { useAppContext } from '@/app/AppContext';
import { useChannels, useCourierProviders, useOrderStatuses, usePaymentMethods } from '@/hooks/useTaxonomies';
import { createOrder, updateOrder } from '@/services/orderService';
import { createCustomer, findByPhone } from '@/services/customerService';
import { computeLineTotal, computeOrderTotals } from '@/finance/orderTotals';
import { formatMoney } from '@/lib/money';
import { nowMs, startOfDay, toDateInputValue, fromDateInputValue } from '@/lib/date';
import { randomId } from '@/lib/id';
import type { Order } from '@/domain/types';
import { ProductPicker, type PickedProduct } from './ProductPicker';
import { CustomerPicker } from './CustomerPicker';

export interface DraftItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  discount: number;
}

export interface OrderFormProps {
  mode: 'create' | 'edit';
  initial?: Order;
  onSaved?: (order: Order) => void;
}

export function OrderForm({ mode, initial, onSaved }: OrderFormProps) {
  const navigate = useNavigate();
  const { settings, refresh } = useAppContext();
  const channels = useChannels();
  const statuses = useOrderStatuses();
  const paymentMethods = usePaymentMethods();
  const courierProviders = useCourierProviders();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  /** When a walk-in buyer is typed in by hand, this saves them to the CRM. */
  const [saveCustomer, setSaveCustomer] = useState(false);

  const [orderDate, setOrderDate] = useState(() => toDateInputValue(initial?.orderDate ?? startOfDay(nowMs())));
  const [channel, setChannel] = useState(initial?.channel ?? 'facebook');
  const [status, setStatus] = useState(initial?.status ?? 'new');
  const [customerId, setCustomerId] = useState<string | null>(initial?.customerId ?? null);
  const [customerName, setCustomerName] = useState(initial?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(initial?.customerPhone ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(initial?.deliveryAddress ?? '');
  const [items, setItems] = useState<DraftItem[]>(
    initial?.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unitCost: item.unitCost,
      discount: item.discount,
    })) ?? [],
  );
  const [discount, setDiscount] = useState(initial?.discount ?? 0);
  const [deliveryCharge, setDeliveryCharge] = useState(initial?.deliveryCharge ?? settings?.order?.defaultDeliveryCharge ?? 6000);
  const [otherCharge, setOtherCharge] = useState(initial?.otherCharge ?? 0);
  const [paymentMethod, setPaymentMethod] = useState(initial?.paymentMethod ?? 'cash');
  const [courierProviderId, setCourierProviderId] = useState(initial?.courierProviderId ?? '');
  const [trackingNumber, setTrackingNumber] = useState(initial?.trackingNumber ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [customerInstructions, setCustomerInstructions] = useState(initial?.customerInstructions ?? '');
  const [advancePayment, setAdvancePayment] = useState(0);
  const [manualName, setManualName] = useState('');
  const [productQuery, setProductQuery] = useState('');

  useEffect(() => {
    if (mode === 'create' && settings?.order?.defaultDeliveryCharge !== undefined && !initial) {
      setDeliveryCharge(settings.order.defaultDeliveryCharge);
    }
  }, [settings?.order?.defaultDeliveryCharge, mode, initial]);

  const totals = useMemo(
    () => computeOrderTotals({ items: items as never, discount, deliveryCharge, otherCharge }),
    [items, discount, deliveryCharge, otherCharge],
  );

  const filteredItems = useMemo(() => {
    const needle = productQuery.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.name} ${item.sku}`.toLowerCase().includes(needle));
  }, [items, productQuery]);

  const addProduct = (product: PickedProduct) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.productId === product.productId && (item.variantId ?? null) === (product.variantId ?? null));
      if (existing) {
        return prev.map((item) =>
          item === existing ? { ...item, quantity: item.quantity + 1, unitPrice: product.unitPrice, unitCost: product.unitCost } : item,
        );
      }
      return [
        ...prev,
        {
          id: randomId(),
          productId: product.productId,
          variantId: product.variantId,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          quantity: 1,
          unitPrice: product.unitPrice,
          unitCost: product.unitCost,
          discount: 0,
        },
      ];
    });
  };

  const updateItem = (id: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((item) => item.id !== id));

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    if (items.length === 0) {
      setFieldErrors({ items: 'অন্তত একটি পণ্য যোগ করুন' });
      return;
    }
    if (items.some((item) => item.quantity <= 0)) {
      setFieldErrors({ items: 'পরিমাণ ০ এর বেশি হতে হবে' });
      return;
    }
    if (!customerId && !customerName.trim() && !manualName.trim()) {
      setFieldErrors({ customer: 'কাস্টমার নির্বাচন করুন অথবা নাম লিখুন' });
      return;
    }

    // Optionally promote a hand-typed buyer into a real customer record, so repeat
    // orders show up in the CRM. Existing numbers are reused instead of duplicated.
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && saveCustomer && customerPhone.trim()) {
      const existing = (await findByPhone(customerPhone))[0];
      resolvedCustomerId = existing ? existing.id : null;
      if (!existing) {
        try {
          const created = await createCustomer({
            name: manualName.trim() || customerName.trim() || 'নগদ কাস্টমার',
            phone: customerPhone,
            altPhone: '',
            address: deliveryAddress,
            district: '',
            area: '',
            notes: '',
            tags: [],
            status: 'active',
          });
          resolvedCustomerId = created.id;
        } catch {
          // A bad phone number must not block the sale: fall back to a guest order.
          resolvedCustomerId = null;
        }
      }
    }

    const payload = {
      orderDate: fromDateInputValue(orderDate) ?? startOfDay(nowMs()),
      channel: channel as never,
      customerId: resolvedCustomerId,
      customerName: customerId ? customerName : manualName || customerName,
      customerPhone,
      deliveryAddress,
      items: items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCost: item.unitCost,
        discount: item.discount,
      })),
      discount,
      deliveryCharge,
      otherCharge,
      status: status as never,
      paymentMethod,
      courierProviderId: courierProviderId || null,
      courierName: courierProviders.rows.find((c) => c.id === courierProviderId)?.name ?? '',
      trackingNumber,
      notes,
      customerInstructions,
      cancelReason: '',
      advancePayment,
      advanceMethod: paymentMethod,
    };

    setSaving(true);
    try {
      const order = mode === 'edit' && initial ? await updateOrder(initial.id, { id: initial.id, ...payload }) : await createOrder(payload);
      await refresh();
      onSaved?.(order);
      navigate(`/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {mode === 'edit' && initial?.stockCommitted && (
        <InfoBanner>
          এই অর্ডারের স্টক ইতিমধ্যে কেটে নেওয়া হয়েছে। আপনি যদি কোনো পণ্যের পরিমাণ বাড়ান বা কমান, শুধু পার্থক্যটুকুই স্টকে সমন্বয় হবে — দুইবার কাটা হবে না।
        </InfoBanner>
      )}

      <Card>
        <CardHeader title="কাস্টমার ও অর্ডার তথ্য" />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-ink-50/60 p-3">
            <div className="min-w-0 flex-1">
              {customerId ? (
                <>
                  <p className="truncate text-sm font-semibold text-ink-900">{customerName}</p>
                  <p className="truncate text-xs text-ink-500">{customerPhone || 'ফোন নেই'}</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink-700">নগদ কাস্টমার (কাস্টমার প্রোফাইল ছাড়া)</p>
                  <p className="text-xs text-ink-400">চাইলে নাম ও ফোন লিখতে পারেন</p>
                </>
              )}
            </div>
            <Button variant="outline" size="sm" icon="user" onClick={() => setCustomerPickerOpen(true)}>
              {customerId ? 'পরিবর্তন' : 'কাস্টমার নির্বাচন'}
            </Button>
          </div>

          {!customerId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="কাস্টমারের নাম">
                {({ id }) => <Input id={id} value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="নাম (ঐচ্ছিক)" />}
              </Field>
              <Field label="ফোন">
                {({ id }) => (
                  <Input id={id} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} inputMode="tel" dir="ltr" placeholder="01XXXXXXXXX" />
                )}
              </Field>
            </div>
          )}

          {!customerId && customerPhone.trim().length > 0 && (
            <Checkbox
              label="এই কাস্টমারকে কাস্টমার তালিকায় সংরক্ষণ করুন"
              checked={saveCustomer}
              onChange={(e) => setSaveCustomer(e.target.checked)}
            />
          )}

          {fieldErrors.customer && <p className="text-xs font-medium text-rose-600">{fieldErrors.customer}</p>}

          <Field label="ডেলিভারি ঠিকানা">
            {({ id }) => (
              <Textarea id={id} value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="বাড়ি, রোড, এলাকা, জেলা" />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="অর্ডারের তারিখ" required>
              {({ id }) => <Input id={id} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />}
            </Field>
            <Field label="অর্ডার এসেছে যেভাবে">
              {({ id }) => <Select id={id} options={channels} value={channel} onChange={(e) => setChannel(e.target.value as Order['channel'])} />}
            </Field>
            <Field label="স্ট্যাটাস">
              {({ id }) => <Select id={id} options={statuses.map((s) => ({ value: s.value, label: s.label }))} value={status} onChange={(e) => setStatus(e.target.value as Order['status'])} />}
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="পণ্য"
          subtitle={`${items.length} টি আইটেম`}
          action={
            <Button size="sm" icon="plus" onClick={() => setPickerOpen(true)}>
              পণ্য যোগ
            </Button>
          }
        />
        <CardBody className="px-0 py-0">
          {fieldErrors.items && <p className="px-4 pt-3 text-xs font-medium text-rose-600">{fieldErrors.items}</p>}
          {items.length > 3 && (
            <div className="px-4 pt-3">
              <SearchInput value={productQuery} onChange={setProductQuery} placeholder="যোগ করা পণ্যের মধ্যে খুঁজুন" />
            </div>
          )}
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-ink-500">কোনো পণ্য যোগ করা হয়নি।</p>
              <Button className="mt-3" icon="plus" onClick={() => setPickerOpen(true)}>
                পণ্য যোগ করুন
              </Button>
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50/70 text-xs text-ink-600">
                    <th className="px-3 py-2 text-left font-semibold">পণ্য</th>
                    <th className="w-24 px-2 py-2 text-left font-semibold">পরিমাণ</th>
                    <th className="w-32 px-2 py-2 text-left font-semibold">দর</th>
                    <th className="w-28 px-2 py-2 text-left font-semibold">ছাড়</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">মোট</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="border-b border-ink-100">
                      <td className="px-3 py-2">
                        <p className="font-medium text-ink-800">{item.name}</p>
                        <p className="text-[11px] text-ink-400">{item.sku ? `${item.sku} • ` : ''}ক্রয় {formatMoney(item.unitCost)}</p>
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min={0}
                          step="1"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })}
                          className="h-9 px-2 py-1"
                          aria-label="পরিমাণ"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyInput value={item.unitPrice} onChange={(value) => updateItem(item.id, { unitPrice: value })} className="h-9 py-1" />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyInput value={item.discount} onChange={(value) => updateItem(item.id, { discount: value })} className="h-9 py-1" />
                      </td>
                      <td className="tabular px-3 py-2 text-right font-semibold text-ink-900">{formatMoney(computeLineTotal(item))}</td>
                      <td className="px-2 py-2">
                        <Button variant="ghost" size="icon" aria-label="সরিয়ে দিন" onClick={() => removeItem(item.id)}>
                          <Icon name="trash" size={16} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="খরচ ও ছাড়" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="পণ্যের মোট (সাবটোটাল)">
              {() => <p className="tabular rounded-lg bg-ink-50 px-3 py-2.5 text-sm font-semibold text-ink-800">{formatMoney(totals.subtotal)}</p>}
            </Field>
            <Field label="অর্ডার ছাড়">
              {({ id }) => <MoneyInput id={id} value={discount} onChange={setDiscount} />}
            </Field>
            <Field label="ডেলিভারি চার্জ">
              {({ id }) => <MoneyInput id={id} value={deliveryCharge} onChange={setDeliveryCharge} />}
            </Field>
            <Field label="অন্যান্য চার্জ" hint="প্যাকেজিং, গিফট র‍্যাপ ইত্যাদি">
              {({ id }) => <MoneyInput id={id} value={otherCharge} onChange={setOtherCharge} />}
            </Field>
            <div className="sm:col-span-2">
              <div className="rounded-lg bg-brand-50 px-3 py-3">
                <div className="flex items-center justify-between text-sm text-ink-600">
                  <span>নিট বিক্রয় (ছাড় বাদ)</span>
                  <span className="tabular font-medium">{formatMoney(totals.netSales)}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-base font-semibold text-brand-900">
                  <span>সর্বমোট পাওনা</span>
                  <span className="tabular">{formatMoney(totals.total)}</span>
                </div>
                <p className="mt-1 text-[11px] text-ink-500">
                  আনুমানিক লাভ (কুরিয়ার খরচ বাদে): {formatMoney(totals.netSales - totals.cogs)}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="পেমেন্ট ও ডেলিভারি" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="পেমেন্ট মাধ্যম">
              {({ id }) => <Select id={id} options={paymentMethods.options} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} />}
            </Field>
            {mode === 'create' && (
              <Field label="অগ্রিম পেমেন্ট" hint="এখনই কিছু পাওয়া গেলে">
                {({ id }) => <MoneyInput id={id} value={advancePayment} onChange={setAdvancePayment} />}
              </Field>
            )}
            <Field label="কুরিয়ার">
              {({ id }) => (
                <Select id={id} options={courierProviders.options} value={courierProviderId} onChange={(e) => setCourierProviderId(e.target.value)} placeholder="নির্বাচন করুন (ঐচ্ছিক)" />
              )}
            </Field>
            <Field label="কনসাইনমেন্ট নম্বর">
              {({ id }) => <Input id={id} value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} dir="ltr" />}
            </Field>
            <Field label="কাস্টমারের নির্দেশ" className="sm:col-span-2">
              {({ id }) => (
                <Textarea id={id} value={customerInstructions} onChange={(e) => setCustomerInstructions(e.target.value)} placeholder="যেমন: বিকেলের পর ডেলিভারি দেবেন" />
              )}
            </Field>
            <Field label="নোট (শুধু আপনার জন্য)" className="sm:col-span-2">
              {({ id }) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </CardBody>
        </Card>
      </div>

      <div className="sticky bottom-16 z-10 flex flex-wrap gap-2 rounded-xl border border-ink-200 bg-white p-3 shadow-pop lg:bottom-4">
        <Button variant="outline" onClick={() => navigate(-1)}>
          বাতিল
        </Button>
        <Button onClick={submit} loading={saving} icon="save" className="ml-auto">
          {mode === 'create' ? 'অর্ডার সংরক্ষণ করুন' : 'হালনাগাদ সংরক্ষণ করুন'}
        </Button>
      </div>

      <ProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addProduct} />
      <CustomerPicker
        open={customerPickerOpen}
        onClose={() => setCustomerPickerOpen(false)}
        onPick={(customer) => {
          setCustomerId(customer.id);
          setCustomerName(customer.name);
          setCustomerPhone(customer.phone);
          setDeliveryAddress(customer.address || deliveryAddress);
        }}
        onPickGuest={() => {
          setCustomerId(null);
          setCustomerName('');
          setCustomerPhone('');
          setCustomerPickerOpen(false);
        }}
      />
    </div>
  );
}
