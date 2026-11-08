import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SearchInput } from '@/components/ui/Controls';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ErrorBanner, WarningBanner } from '@/components/ui/Feedback';
import { Badge } from '@/components/ui/Badge';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { createCustomer, duplicateWarnings, listCustomers } from '@/services/customerService';
import { customerInputSchema, zodErrorMap } from '@/domain/schemas';
import type { Customer, ID } from '@/domain/types';

export interface PickedCustomer {
  id: ID | null;
  name: string;
  phone: string;
  address: string;
  district: string;
  area: string;
}

export function CustomerPicker({
  open,
  onClose,
  onPick,
  onPickGuest,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (customer: PickedCustomer) => void;
  onPickGuest: () => void;
}) {
  const { version, refresh } = useAppContext();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', address: '', district: '', area: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<Customer[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const state = useAsync(() => listCustomers({ query, limit: 40 }), [version, query]);

  const submitNew = async () => {
    const parsed = customerInputSchema.safeParse({ ...form, altPhone: '', notes: '', tags: [], status: 'active' });
    if (!parsed.success) {
      setErrors(zodErrorMap(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    setSaveError(null);
    try {
      const duplicates = await duplicateWarnings({ name: form.name, phone: form.phone });
      setWarnings(duplicates.map((d) => d.customer));
      const customer = await createCustomer(parsed.data);
      await refresh();
      onPick({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        district: customer.district,
        area: customer.area,
      });
      setCreating(false);
      setForm({ name: '', phone: '', address: '', district: '', area: '' });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="কাস্টমার নির্বাচন করুন" onClose={onClose} size="md">
      {creating ? (
        <div className="space-y-3">
          {saveError && <ErrorBanner message={saveError} />}
          {warnings.length > 0 && (
            <WarningBanner>
              <p className="font-medium">সতর্কতা: একই ধরনের নাম/ফোন আগে থেকেই আছে।</p>
              <ul className="mt-1 space-y-0.5">
                {warnings.map((customer) => (
                  <li key={customer.id}>
                    {customer.name} — {customer.phone}
                  </li>
                ))}
              </ul>
              <p className="mt-1">এরা একই মানুষ কিনা নিশ্চিত না হলে নতুন কাস্টমার তৈরি করবেন না।</p>
            </WarningBanner>
          )}
          <Field label="নাম" required error={errors.name}>
            {({ id, invalid }) => (
              <Input id={id} value={form.name} invalid={invalid} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="কাস্টমারের নাম" />
            )}
          </Field>
          <Field label="ফোন" required error={errors.phone} hint="০১৭১২৩৪৫৬৭৮">
            {({ id, invalid }) => (
              <Input id={id} value={form.phone} invalid={invalid} inputMode="tel" dir="ltr" onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01XXXXXXXXX" />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="জেলা" error={errors.district}>
              {({ id }) => <Input id={id} value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />}
            </Field>
            <Field label="এলাকা" error={errors.area}>
              {({ id }) => <Input id={id} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />}
            </Field>
          </div>
          <Field label="ঠিকানা" error={errors.address}>
            {({ id }) => <Input id={id} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />}
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setCreating(false)}>
              তালিকায় ফিরুন
            </Button>
            <Button onClick={submitNew} loading={saving} icon="save">
              সংরক্ষণ ও নির্বাচন
            </Button>
          </div>
        </div>
      ) : (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="নাম বা ফোন নম্বর দিয়ে খুঁজুন" className="mb-3" autoFocus />
          <ul className="max-h-[46vh] divide-y divide-ink-100 overflow-y-auto">
            {(state.data?.rows ?? []).map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick({
                      id: customer.id,
                      name: customer.name,
                      phone: customer.phone,
                      address: customer.address,
                      district: customer.district,
                      area: customer.area,
                    });
                    onClose();
                  }}
                  className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left hover:bg-brand-50/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-800">{customer.name}</span>
                    <span className="block truncate text-xs text-ink-400">{customer.phone || 'ফোন নেই'}</span>
                  </span>
                  {customer.status !== 'active' && <Badge tone="bg-ink-100 text-ink-600 ring-ink-200">{customer.status === 'vip' ? 'ভিআইপি' : 'ব্লকড'}</Badge>}
                </button>
              </li>
            ))}
            {(state.data?.rows ?? []).length === 0 && (
              <li className="py-8 text-center text-sm text-ink-400">{query ? 'কোনো কাস্টমার পাওয়া যায়নি' : 'এখনো কোনো কাস্টমার যোগ করা হয়নি'}</li>
            )}
          </ul>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onPickGuest}>
              কাস্টমার ছাড়া (নগদ বিক্রয়)
            </Button>
            <Button icon="plus" onClick={() => setCreating(true)}>
              নতুন কাস্টমার
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
