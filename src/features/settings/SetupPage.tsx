import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { ErrorBanner, InfoBanner } from '@/components/ui/Feedback';
import { useAppContext } from '@/app/AppContext';
import { getSettings, updateSettings } from '@/services/settingsService';
import { resizeImageFile } from '@/lib/image';

/** First-run business profile setup. */
export default function SetupPage() {
  const navigate = useNavigate();
  const { refreshSettings, refresh } = useAppContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    registrationNote: '',
    logoDataUrl: null as string | null,
  });

  const submit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('ব্যবসার নাম দিন');
      return;
    }
    setSaving(true);
    try {
      const settings = await getSettings();
      await updateSettings({
        business: { ...settings.business, ...form },
        onboardingCompleted: true,
      });
      await refreshSettings();
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <header className="mb-6 text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-700 text-xl font-bold text-white">ফ</span>
        <h1 className="text-xl font-semibold text-ink-900">Facebook Seller OS-এ স্বাগতম</h1>
        <p className="mt-1 text-sm text-ink-500">প্রথমে আপনার ব্যবসার তথ্য দিন — এগুলো ইনভয়েস ও রিপোর্টে ব্যবহার হবে।</p>
      </header>

      {error && <ErrorBanner message={error} />}

      <Card>
        <CardHeader title="ব্যবসার তথ্য" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="ব্যবসার নাম" required className="sm:col-span-2">
            {({ id }) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="যেমন: রিমা কালেকশন" />}
          </Field>
          <Field label="ফোন">
            {({ id }) => <Input id={id} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" dir="ltr" />}
          </Field>
          <Field label="ইমেইল">
            {({ id }) => <Input id={id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" dir="ltr" />}
          </Field>
          <Field label="ওয়েবসাইট/পেজ লিংক">
            {({ id }) => <Input id={id} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} dir="ltr" />}
          </Field>
          <Field label="ট্রেড লাইসেন্স/টিআইএন (ঐচ্ছিক)">
            {({ id }) => <Input id={id} value={form.registrationNote} onChange={(e) => setForm({ ...form, registrationNote: e.target.value })} />}
          </Field>
          <Field label="ঠিকানা" className="sm:col-span-2">
            {({ id }) => <Textarea id={id} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />}
          </Field>
          <Field label="লোগো (ঐচ্ছিক)" className="sm:col-span-2" hint="ছোট ছবি ব্যবহার করুন — ডিভাইসেই থাকবে">
            {({ id }) => (
              <input
                id={id}
                type="file"
                accept="image/*"
                className="block w-full text-sm"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    setForm({ ...form, logoDataUrl: await resizeImageFile(file, 240) });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            )}
          </Field>
          {form.logoDataUrl && (
            <div className="sm:col-span-2">
              <img src={form.logoDataUrl} alt="লোগো প্রিভিউ" className="h-20 w-20 rounded-lg border border-ink-200 object-contain" />
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-4">
        <InfoBanner>
          এই তথ্য শুধু আপনার ডিভাইসে থাকবে — কোনো সার্ভারে পাঠানো হবে না। পরে <strong>সেটিংস</strong> থেকে যেকোনো সময় বদলাতে পারবেন।
        </InfoBanner>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate('/')}>
          পরে করব
        </Button>
        <Button onClick={submit} loading={saving} icon="check">
          শুরু করুন
        </Button>
      </div>
    </div>
  );
}
