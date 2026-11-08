import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ErrorBanner, Skeleton, WarningBanner } from '@/components/ui/Feedback';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { createCustomer, duplicateWarnings, getCustomer, updateCustomer } from '@/services/customerService';
import { customerInputSchema, zodErrorMap } from '@/domain/schemas';

export default function CustomerFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refresh } = useAppContext();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<{ name: string; phone: string; reason: string }[]>([]);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    altPhone: '',
    address: '',
    district: '',
    area: '',
    notes: '',
    tags: '',
    status: 'active' as 'active' | 'blocked' | 'vip',
  });

  const existing = useAsync(() => (id ? getCustomer(id) : Promise.resolve(undefined)), [id]);

  useEffect(() => {
    const customer = existing.data;
    if (!customer) return;
    setForm({
      name: customer.name,
      phone: customer.phone,
      altPhone: customer.altPhone,
      address: customer.address,
      district: customer.district,
      area: customer.area,
      notes: customer.notes,
      tags: customer.tags.join(', '),
      status: customer.status,
    });
  }, [existing.data]);

  const submit = async () => {
    setError(null);
    setErrors({});
    const payload = {
      name: form.name,
      phone: form.phone,
      altPhone: form.altPhone,
      address: form.address,
      district: form.district,
      area: form.area,
      notes: form.notes,
      tags: form.tags
        .split(/[,;]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      status: form.status,
    };
    const parsed = customerInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(zodErrorMap(parsed.error));
      return;
    }
    setSaving(true);
    try {
      if (id) await updateCustomer(id, parsed.data);
      else {
        const duplicates = await duplicateWarnings({ name: parsed.data.name, phone: parsed.data.phone });
        setWarnings(duplicates.map((d) => ({ name: d.customer.name, phone: d.customer.phone, reason: d.reason })));
        const customer = await createCustomer(parsed.data);
        await refresh();
        navigate(`/customers/${customer.id}`);
        return;
      }
      await refresh();
      navigate(`/customers/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (id && existing.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <>
      <PageHeader title={id ? 'কাস্টমার সম্পাদনা' : 'নতুন কাস্টমার'} subtitle="নাম ও ফোন বাংলা বা ইংরেজিতে — যেকোনো ভাষায় লিখতে পারবেন" back />

      {error && <ErrorBanner message={error} />}
      {warnings.length > 0 && (
        <WarningBanner>
          <p className="font-medium">সতর্কতা: এই তথ্যের সাথে মিল থাকা কাস্টমার আগেই আছেন —</p>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((warning) => (
              <li key={`${warning.name}-${warning.phone}`}>
                {warning.name} ({warning.phone}) — {warning.reason === 'phone' ? 'একই ফোন নম্বর' : 'নামের মিল'}
              </li>
            ))}
          </ul>
          <p className="mt-1">নতুন কাস্টমার তৈরি করা হয়েছে, কিন্তু দুজন একই মানুষ হলে প্রোফাইল মুছে না দিয়ে আর্কাইভ করুন।</p>
        </WarningBanner>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="কাস্টমার তথ্য" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="নাম" required error={errors.name}>
              {({ id: fieldId, invalid }) => (
                <Input id={fieldId} value={form.name} invalid={invalid} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="যেমন: মোসা. আয়েশা খাতুন" />
              )}
            </Field>
            <Field label="ফোন" required error={errors.phone} hint="০১৭১২৩৪৫৬৭৮">
              {({ id: fieldId, invalid }) => (
                <Input id={fieldId} value={form.phone} invalid={invalid} inputMode="tel" dir="ltr" onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01XXXXXXXXX" />
              )}
            </Field>
            <Field label="বিকল্প ফোন" error={errors.altPhone}>
              {({ id: fieldId }) => (
                <Input id={fieldId} value={form.altPhone} inputMode="tel" dir="ltr" onChange={(e) => setForm({ ...form, altPhone: e.target.value })} />
              )}
            </Field>
            <Field label="স্ট্যাটাস">
              {({ id: fieldId }) => (
                <Select
                  id={fieldId}
                  options={[
                    { value: 'active', label: 'সাধারণ' },
                    { value: 'vip', label: 'ভিআইপি' },
                    { value: 'blocked', label: 'ব্লকড (অর্ডার নেবেন না)' },
                  ]}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'vip' | 'blocked' })}
                />
              )}
            </Field>
            <Field label="জেলা" className="sm:col-span-2">
              {({ id: fieldId }) => <Input id={fieldId} value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />}
            </Field>
            <Field label="এলাকা/উপজেলা" className="sm:col-span-2">
              {({ id: fieldId }) => <Input id={fieldId} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />}
            </Field>
            <Field label="ঠিকানা" className="sm:col-span-2">
              {({ id: fieldId }) => <Textarea id={fieldId} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="বাড়ি, রোড, এলাকা" />}
            </Field>
            <Field label="ট্যাগ" hint="কমা দিয়ে আলাদা করুন — যেমন: নিয়মিত, পাইকারি" className="sm:col-span-2">
              {({ id: fieldId }) => <Input id={fieldId} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />}
            </Field>
            <Field label="নোট" className="sm:col-span-2">
              {({ id: fieldId }) => <Textarea id={fieldId} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
            </Field>
          </CardBody>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardBody className="space-y-2">
              <Button block onClick={submit} loading={saving} icon="save">
                {id ? 'হালনাগাদ সংরক্ষণ' : 'কাস্টমার সংরক্ষণ'}
              </Button>
              <Button block variant="outline" onClick={() => navigate(-1)}>
                বাতিল
              </Button>
            </CardBody>
          </Card>
          <p className="px-1 text-xs text-ink-500">
            কাস্টমারের তথ্য শুধু আপনার ডিভাইসে থাকে। আমরা কোথাও কিছু পাঠাই না — তাই ব্যাকআপ নেওয়া আপনার দায়িত্ব।
          </p>
        </div>
      </div>
    </>
  );
}
