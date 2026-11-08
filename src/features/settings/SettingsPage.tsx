import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { MoneyInput, Tabs } from '@/components/ui/Controls';
import { LogoUploadField } from '@/features/branding/LogoUploadField';
import { BrandingBlock } from '@/features/branding/BrandingBlock';
import { ACCENT_PRESETS, ALIGN_LABEL, FONT_SCALE_LABEL, SOFTWARE_DEVELOPER } from '@/domain/constants';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { ErrorBanner, InfoBanner, WarningBanner } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Feedback';
import { useAppContext } from '@/app/AppContext';
import { getSettings, updateSettings, APP_VERSION } from '@/services/settingsService';
import { db, SCHEMA_VERSION } from '@/db/db';
import { createPinRecord, verifyPin } from '@/lib/crypto';
import { destroyAllData } from '@/db/db';
import { rebuildStockLevels } from '@/services/inventoryService';
import { randomId } from '@/lib/id';
import { nowMs } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import type { Settings } from '@/domain/types';

const TABS = [
  { key: 'business', label: 'ব্যবসা' },
  { key: 'branding', label: 'ব্র্যান্ডিং' },
  { key: 'preferences', label: 'ভাষা ও সংখ্যা' },
  { key: 'numbering', label: 'নম্বর ও ইনভয়েস' },
  { key: 'categories', label: 'ক্যাটেগরি' },
  { key: 'methods', label: 'পেমেন্ট মাধ্যম' },
  { key: 'couriers', label: 'কুরিয়ার' },
  { key: 'stock', label: 'স্টক' },
  { key: 'security', label: 'নিরাপত্তা' },
  { key: 'data', label: 'ডেটা' },
  { key: 'about', label: 'সম্পর্কে' },
];

export default function SettingsPage() {
  const { settings, refreshSettings, refresh, lock } = useAppContext();
  const toast = useToast();
  const [tab, setTab] = useState('business');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Settings | null>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const save = async (patch: Partial<Omit<Settings, 'id'>>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await updateSettings(patch);
      setForm(next);
      await refreshSettings();
      await refresh();
      toast.success('সংরক্ষণ হয়েছে');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!form) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded bg-ink-100" />
        <div className="h-64 animate-pulse rounded bg-ink-100" />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="সেটিংস" subtitle="ব্যবসা, হিসাব পদ্ধতি ও ডেটা ব্যবস্থাপনা" />

      <div className="mb-4">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {tab === 'business' && <BusinessSection form={form} onChange={setForm} onSave={save} busy={busy} />}
      {tab === 'branding' && <BrandingSection form={form} onChange={setForm} onSave={save} busy={busy} />}
      {tab === 'preferences' && <PreferencesSection form={form} onChange={setForm} onSave={save} busy={busy} />}
      {tab === 'numbering' && <NumberingSection form={form} onChange={setForm} onSave={save} busy={busy} />}
      {tab === 'categories' && <CategoriesSection />}
      {tab === 'methods' && <MethodsSection />}
      {tab === 'couriers' && <CouriersSection />}
      {tab === 'stock' && <StockSection form={form} onChange={setForm} onSave={save} busy={busy} />}
      {tab === 'security' && <SecuritySection form={form} onSave={save} busy={busy} onLock={lock} />}
      {tab === 'data' && <DataSection />}
      {tab === 'about' && <AboutSection />}
    </>
  );
}

type SaveFn = (patch: Partial<Omit<Settings, 'id'>>) => Promise<void>;

function SectionActions({ onSave, busy, disabled }: { onSave: () => void; busy: boolean; disabled?: boolean }) {
  return (
    <div className="mt-4 flex justify-end">
      <Button onClick={onSave} loading={busy} disabled={disabled} icon="save">
        সংরক্ষণ করুন
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Business                                                            */
/* ------------------------------------------------------------------ */

function BusinessSection({ form, onChange, onSave, busy }: { form: Settings; onChange: (value: Settings) => void; onSave: SaveFn; busy: boolean }) {
  const business = form.business;
  const patch = (next: Partial<Settings['business']>) => onChange({ ...form, business: { ...business, ...next } });

  return (
    <Card>
      <CardHeader title="ব্যবসার তথ্য" subtitle="ইনভয়েস ও রিপোর্টে ব্যবহার হবে" />
      <CardBody className="grid gap-3 sm:grid-cols-2">
        <Field label="ব্যবসার নাম" required className="sm:col-span-2">
          {({ id }) => <Input id={id} value={business.name} onChange={(e) => patch({ name: e.target.value })} />}
        </Field>
        <Field label="মালিক/প্রোপ্রাইটরের নাম" hint="ইনভয়েসের স্বাক্ষরের নিচে দেখা যায়">
          {({ id }) => <Input id={id} value={business.ownerName} onChange={(e) => patch({ ownerName: e.target.value })} />}
        </Field>
        <Field label="প্রধান ফোন">
          {({ id }) => <Input id={id} value={business.phone} onChange={(e) => patch({ phone: e.target.value })} dir="ltr" inputMode="tel" />}
        </Field>
        <Field label="দ্বিতীয় ফোন" hint="ঐচ্ছিক">
          {({ id }) => <Input id={id} value={business.altPhone} onChange={(e) => patch({ altPhone: e.target.value })} dir="ltr" inputMode="tel" />}
        </Field>
        <Field label="ইমেইল">
          {({ id }) => <Input id={id} value={business.email} onChange={(e) => patch({ email: e.target.value })} type="email" dir="ltr" />}
        </Field>
        <Field label="ওয়েবসাইট/সোশ্যাল মিডিয়া" hint="ঐচ্ছিক — ফেসবুক পেজ বা ওয়েবসাইটের লিংক">
          {({ id }) => <Input id={id} value={business.website} onChange={(e) => patch({ website: e.target.value })} dir="ltr" />}
        </Field>
        <Field label="ট্রেড লাইসেন্স/টিআইএন">
          {({ id }) => <Input id={id} value={business.registrationNote} onChange={(e) => patch({ registrationNote: e.target.value })} />}
        </Field>
        <Field label="এলাকা/থানা">
          {({ id }) => <Input id={id} value={business.area} onChange={(e) => patch({ area: e.target.value })} />}
        </Field>
        <Field label="জেলা">
          {({ id }) => <Input id={id} value={business.district} onChange={(e) => patch({ district: e.target.value })} />}
        </Field>
        <Field label="ঠিকানা" className="sm:col-span-2">
          {({ id }) => <Textarea id={id} value={business.address} onChange={(e) => patch({ address: e.target.value })} />}
        </Field>
        <Field label="ব্যবসার পরিচিতি" className="sm:col-span-2" hint="ইনভয়েসে দেখাতে চাইলে ব্র্যান্ডিং ট্যাবে চালু করুন">
          {({ id }) => <Textarea id={id} value={business.description} onChange={(e) => patch({ description: e.target.value })} />}
        </Field>
        <Field label="কাস্টম ফুটার / ধন্যবাদ বার্তা" className="sm:col-span-2" hint="ইনভয়েসের নিচে ছাপা হবে">
          {({ id }) => (
            <Textarea
              id={id}
              value={business.thankYouMessage}
              onChange={(e) => patch({ thankYouMessage: e.target.value })}
              placeholder="আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ।"
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <LogoUploadField
            value={business.logoDataUrl}
            businessName={business.name}
            onChange={(logoDataUrl) => patch({ logoDataUrl })}
          />
        </div>
      </CardBody>
      <SectionActions onSave={() => onSave({ business })} busy={busy} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Branding (V2)                                                       */
/* ------------------------------------------------------------------ */

const SURFACE_LABELS: Array<{ key: keyof Settings['branding']['showLogoOn']; label: string }> = [
  { key: 'invoice', label: 'ইনভয়েস' },
  { key: 'courierSlip', label: 'কুরিয়ার স্লিপ' },
  { key: 'parcelLabel', label: 'পার্সেল লেবেল' },
  { key: 'reports', label: 'রিপোর্ট' },
];

function BrandingSection({ form, onChange, onSave, busy }: { form: Settings; onChange: (value: Settings) => void; onSave: SaveFn; busy: boolean }) {
  const branding = form.branding;
  const business = form.business;
  const patch = (next: Partial<Settings['branding']>) => onChange({ ...form, branding: { ...branding, ...next } });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="ব্র্যান্ডিং"
          subtitle="ইনভয়েস, কুরিয়ার স্লিপ, পার্সেল লেবেল ও রিপোর্টে আপনার ব্যবসার পরিচয় কীভাবে দেখাবে"
        />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="ট্যাগলাইন" hint="ব্যবসার নামের নিচে ছোট একটি লাইন">
            {({ id }) => (
              <Input
                id={id}
                value={branding.tagline}
                onChange={(e) => patch({ tagline: e.target.value })}
                placeholder="যেমন: নারীদের পোশাকে ১০ বছরের অভিজ্ঞতা"
              />
            )}
          </Field>
          <Field label="ডকুমেন্ট ফুটার" hint="রিপোর্ট ও অন্যান্য ডকুমেন্টের নিচে">
            {({ id }) => (
              <Input
                id={id}
                value={branding.documentFooter}
                onChange={(e) => patch({ documentFooter: e.target.value })}
              />
            )}
          </Field>

          <Field label="রঙের থিম">
            {({ id }) => (
              <Select
                id={id}
                value={branding.accent}
                onChange={(e) => patch({ accent: e.target.value as Settings['branding']['accent'] })}
                options={ACCENT_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))}
              />
            )}
          </Field>
          <Field label="লেখার আকার">
            {({ id }) => (
              <Select
                id={id}
                value={branding.fontScale}
                onChange={(e) => patch({ fontScale: e.target.value as Settings['branding']['fontScale'] })}
                options={(Object.keys(FONT_SCALE_LABEL) as Array<Settings['branding']['fontScale']>).map((key) => ({
                  value: key,
                  label: FONT_SCALE_LABEL[key],
                }))}
              />
            )}
          </Field>
          <Field label="লেখার বিন্যাস">
            {({ id }) => (
              <Select
                id={id}
                value={branding.align}
                onChange={(e) => patch({ align: e.target.value as Settings['branding']['align'] })}
                options={(Object.keys(ALIGN_LABEL) as Array<Settings['branding']['align']>).map((key) => ({
                  value: key,
                  label: ALIGN_LABEL[key],
                }))}
              />
            )}
          </Field>
          <Field label="ব্যবসার পরিচিতি দেখান" hint="ইনভয়েসে ব্যবসার বিবরণ ছাপা হবে">
            {({ id }) => (
              <Checkbox
                id={id}
                checked={branding.showBusinessDescription}
                onChange={(e) => patch({ showBusinessDescription: e.target.checked })}
                label="বিবরণ দেখান"
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-ink-700">লোগো কোথায় দেখাবে</p>
            <div className="flex flex-wrap gap-2">
              {SURFACE_LABELS.map((surface) => (
                <Checkbox
                  key={surface.key}
                  id={`logo-${surface.key}`}
                  label={surface.label}
                  checked={branding.showLogoOn[surface.key]}
                  onChange={(e) => patch({ showLogoOn: { ...branding.showLogoOn, [surface.key]: e.target.checked } })}
                />
              ))}
            </div>
          </div>
        </CardBody>
        <SectionActions onSave={() => onSave({ branding, business })} busy={busy} />
      </Card>

      <Card>
        <CardHeader title="স্বাক্ষর" subtitle="ইনভয়েস ও ডকুমেন্টের নিচে" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="স্বাক্ষর দেখান">
            {({ id }) => (
              <Checkbox
                id={id}
                checked={branding.showSignature}
                onChange={(e) => patch({ showSignature: e.target.checked })}
                label="স্বাক্ষরের ঘর দেখান"
              />
            )}
          </Field>
          <Field label="স্বাক্ষরের নিচের লেখা">
            {({ id }) => (
              <Input
                id={id}
                value={branding.signatureLabel}
                onChange={(e) => patch({ signatureLabel: e.target.value })}
              />
            )}
          </Field>
          <Field label="স্বাক্ষরকারীর নাম" hint="খালি রাখলে ব্যবসার মালিকের নাম ব্যবহার হবে">
            {({ id }) => (
              <Input
                id={id}
                value={branding.signatureName}
                onChange={(e) => patch({ signatureName: e.target.value })}
                placeholder={business.ownerName || 'মালিকের নাম'}
              />
            )}
          </Field>
        </CardBody>
        <SectionActions onSave={() => onSave({ branding, business })} busy={busy} />
      </Card>

      <Card>
        <CardHeader title="প্রিভিউ" subtitle="ইনভয়েসে এই পরিচয়টি দেখাবে" />
        <CardBody>
          <div className="rounded-lg border border-ink-200 bg-white p-4">
            <BrandingBlock
              settings={form}
              surface="invoice"
              meta={<p className="text-xs text-ink-500">ইনভয়েস নং: INV-00001</p>}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

function PreferencesSection({ form, onChange, onSave, busy }: { form: Settings; onChange: (value: Settings) => void; onSave: SaveFn; busy: boolean }) {
  const currency = form.currency;
  const locale = form.locale;
  return (
    <Card>
      <CardHeader title="মুদ্রা, সময় ও সংখ্যা" subtitle="আপনার সুবিধা মতো বদলাতে পারেন" />
      <CardBody className="grid gap-3 sm:grid-cols-2">
        <Field label="মুদ্রা" hint="এই সংস্করণে শুধু বাংলাদেশি টাকা (BDT) সমর্থিত">
          {({ id }) => <Input id={id} value="বাংলাদেশি টাকা (BDT)" disabled />}
        </Field>
        <Field label="টাকার চিহ্ন">
          {({ id }) => <Input id={id} value={currency.symbol} onChange={(e) => onChange({ ...form, currency: { ...currency, symbol: e.target.value } })} />}
        </Field>
        <Field label="চিহ্নের অবস্থান">
          {({ id }) => (
            <Select
              id={id}
              options={[
                { value: 'before', label: 'আগে (৳ ১২০০)' },
                { value: 'after', label: 'পরে (১২০০ ৳)' },
              ]}
              value={currency.position}
              onChange={(e) => onChange({ ...form, currency: { ...currency, position: e.target.value as 'before' | 'after' } })}
            />
          )}
        </Field>
        <Field label="সময় অঞ্চল" hint="তারিখ ও রিপোর্ট এই সময় অনুযায়ী">
          {({ id }) => (
            <Select
              id={id}
              options={[
                { value: 'Asia/Dhaka', label: 'ঢাকা (UTC+6)' },
                { value: 'Asia/Kolkata', label: 'কলকাতা (UTC+5:30)' },
                { value: 'UTC', label: 'ইউটিসি' },
              ]}
              value={locale.timeZone}
              onChange={(e) => onChange({ ...form, locale: { ...locale, timeZone: e.target.value } })}
            />
          )}
        </Field>
        <Field label="তারিখের ফরম্যাট">
          {({ id }) => (
            <Select
              id={id}
              options={[
                { value: 'dd MMMM yyyy', label: '৮ নভেম্বর ২০২৬' },
                { value: 'dd/MM/yyyy', label: '০৮/১১/২০২৬' },
                { value: 'yyyy-MM-dd', label: '২০২৬-১১-০৮' },
              ]}
              value={locale.dateFormat}
              onChange={(e) => onChange({ ...form, locale: { ...locale, dateFormat: e.target.value as Settings['locale']['dateFormat'] } })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            label="সংখ্যা বাংলায় দেখান (০-৯)"
            checked={locale.bengaliDigits}
            onChange={(e) => onChange({ ...form, locale: { ...locale, bengaliDigits: e.target.checked } })}
          />
        </div>
        <div className="sm:col-span-2 rounded-lg bg-ink-50 p-3 text-sm">
          <p className="mb-1 text-xs text-ink-500">নমুনা</p>
          <p className="tabular">{formatMoney(123456789, { bengaliDigits: locale.bengaliDigits, symbol: currency.symbol === '৳' })}</p>
        </div>
      </CardBody>
      <SectionActions onSave={() => onSave({ currency, locale })} busy={busy} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Numbering & invoice                                                 */
/* ------------------------------------------------------------------ */

function NumberingSection({ form, onChange, onSave, busy }: { form: Settings; onChange: (value: Settings) => void; onSave: SaveFn; busy: boolean }) {
  const order = form.order;
  const invoice = form.invoice;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="নম্বর পদ্ধতি" subtitle="অর্ডার ও ইনভয়েস নম্বর কীভাবে বাড়বে" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="অর্ডার নম্বরের প্রিফিক্স">
            {({ id }) => <Input id={id} value={order.prefix} onChange={(e) => onChange({ ...form, order: { ...order, prefix: e.target.value } })} dir="ltr" />}
          </Field>
          <Field label="পরবর্তী অর্ডার নম্বর" hint="বাড়িয়ে দিলে পুরনো নম্বর এড়ানো যায়">
            {({ id }) => (
              <Input id={id} type="number" min={1} value={order.nextNumber} onChange={(e) => onChange({ ...form, order: { ...order, nextNumber: Number(e.target.value) || 1 } })} />
            )}
          </Field>
          <Field label="ইনভয়েস প্রিফিক্স">
            {({ id }) => <Input id={id} value={invoice.prefix} onChange={(e) => onChange({ ...form, invoice: { ...invoice, prefix: e.target.value } })} dir="ltr" />}
          </Field>
          <Field label="ডিফল্ট ডেলিভারি চার্জ">
            {({ id }) => (
              <MoneyInput id={id} value={order.defaultDeliveryCharge} onChange={(value) => onChange({ ...form, order: { ...order, defaultDeliveryCharge: value } })} />
            )}
          </Field>
        </CardBody>
        <SectionActions onSave={() => onSave({ order, invoice })} busy={busy} />
      </Card>

      <Card>
        <CardHeader title="ইনভয়েস" />
        <CardBody className="grid gap-3">
          <Field label="ইনভয়েসের নিচের নোট">
            {({ id }) => <Textarea id={id} value={invoice.footerNote} onChange={(e) => onChange({ ...form, invoice: { ...invoice, footerNote: e.target.value } })} />}
          </Field>
          <Field label="শর্তাবলি">
            {({ id }) => <Textarea id={id} value={invoice.terms} onChange={(e) => onChange({ ...form, invoice: { ...invoice, terms: e.target.value } })} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox label="ইনভয়েসে লোগো দেখান" checked={invoice.showLogo} onChange={(e) => onChange({ ...form, invoice: { ...invoice, showLogo: e.target.checked } })} />
            <Field label="কাগজের আকার">
              {({ id }) => (
                <Select
                  id={id}
                  options={[
                    { value: 'a4', label: 'A4' },
                    { value: 'pos', label: 'পিওএস (সরু)' },
                  ]}
                  value={invoice.paper}
                  onChange={(e) => onChange({ ...form, invoice: { ...invoice, paper: e.target.value as 'a4' | 'pos' } })}
                />
              )}
            </Field>
          </div>
        </CardBody>
        <SectionActions onSave={() => onSave({ invoice })} busy={busy} />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Simple taxonomy CRUD                                                */
/* ------------------------------------------------------------------ */

interface TaxonomyRow {
  id: string;
  name: string;
}

function TaxonomyList({
  title,
  hint,
  rows,
  onAdd,
  onDelete,
  onRename,
}: {
  title: string;
  hint?: string;
  rows: TaxonomyRow[];
  onAdd: (name: string) => Promise<void>;
  onDelete: (row: TaxonomyRow) => Promise<void>;
  onRename: (row: TaxonomyRow, name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title={title} subtitle={hint} />
      <CardBody>
        {error && <ErrorBanner message={error} />}
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="নতুন নাম" aria-label={title} />
          <Button
            icon="plus"
            loading={busy}
            onClick={async () => {
              if (!name.trim()) return;
              setBusy(true);
              setError(null);
              try {
                await onAdd(name.trim());
                setName('');
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            যোগ
          </Button>
        </div>
        <ul className="mt-3 divide-y divide-ink-100">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-2 py-2">
              <Input
                value={row.name}
                aria-label={`${title} নাম`}
                onChange={async (e) => {
                  await onRename(row, e.target.value);
                }}
                className="h-9 py-1"
              />
              <Button variant="ghost" size="icon" aria-label="মুছে ফেলুন" onClick={() => void onDelete(row)}>
                <Icon name="trash" size={16} />
              </Button>
            </li>
          ))}
          {rows.length === 0 && <li className="py-3 text-sm text-ink-400">কিছু যোগ করা হয়নি।</li>}
        </ul>
      </CardBody>
    </Card>
  );
}

function CategoriesSection() {
  const { version, refresh } = useAppContext();
  const [productRows, setProductRows] = useState<TaxonomyRow[]>([]);
  const [expenseRows, setExpenseRows] = useState<TaxonomyRow[]>([]);

  useEffect(() => {
    void (async () => {
      const [products, expenses] = await Promise.all([db.productCategories.toArray(), db.expenseCategories.toArray()]);
      setProductRows(products.filter((r) => !r.archivedAt).map((r) => ({ id: r.id, name: r.name })));
      setExpenseRows(expenses.filter((r) => !r.archivedAt).map((r) => ({ id: r.id, name: r.name })));
    })();
  }, [version]);

  const add = async (table: 'productCategories' | 'expenseCategories', name: string) => {
    const now = nowMs();
    await db[table].add({ id: randomId(), name, description: '', createdAt: now, updatedAt: now, archivedAt: null });
    await refresh();
  };

  const remove = async (table: 'productCategories' | 'expenseCategories', row: TaxonomyRow) => {
    await db[table].update(row.id, { archivedAt: nowMs(), updatedAt: nowMs() });
    await refresh();
  };

  const rename = async (table: 'productCategories' | 'expenseCategories', row: TaxonomyRow, name: string) => {
    setProductRows((prev) => (table === 'productCategories' ? prev.map((r) => (r.id === row.id ? { ...r, name } : r)) : prev));
    setExpenseRows((prev) => (table === 'expenseCategories' ? prev.map((r) => (r.id === row.id ? { ...r, name } : r)) : prev));
    await db[table].update(row.id, { name, updatedAt: nowMs() });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TaxonomyList
        title="পণ্যের ক্যাটেগরি"
        hint="পণ্য ভাগ করে রাখতে সাহায্য করে"
        rows={productRows}
        onAdd={(name) => add('productCategories', name)}
        onDelete={(row) => remove('productCategories', row)}
        onRename={(row, name) => rename('productCategories', row, name)}
      />
      <TaxonomyList
        title="খরচের খাত"
        hint="বিজ্ঞাপন, প্যাকেজিং, ভাড়া…"
        rows={expenseRows}
        onAdd={(name) => add('expenseCategories', name)}
        onDelete={(row) => remove('expenseCategories', row)}
        onRename={(row, name) => rename('expenseCategories', row, name)}
      />
    </div>
  );
}

function MethodsSection() {
  const { version, refresh } = useAppContext();
  const [rows, setRows] = useState<{ id: string; name: string; key: string; isActive: boolean }[]>([]);

  useEffect(() => {
    void db.paymentMethods.toArray().then((data) => setRows(data.filter((r) => !r.archivedAt).map((r) => ({ id: r.id, name: r.name, key: r.key, isActive: r.isActive }))));
  }, [version]);

  return (
    <Card>
      <CardHeader title="পেমেন্ট মাধ্যম" subtitle="নগদ, বিকাশ, নগদ, ব্যাংক — যা যা ব্যবহার করেন" />
      <CardBody>
        <TaxonomyList
          title="মাধ্যম যোগ করুন"
          rows={rows.map((r) => ({ id: r.id, name: r.name }))}
          onAdd={async (name) => {
            const now = nowMs();
            await db.paymentMethods.add({ id: randomId(), key: name.toLowerCase().replace(/\s+/g, '-'), name, note: '', isActive: true, createdAt: now, updatedAt: now, archivedAt: null });
            await refresh();
          }}
          onDelete={async (row) => {
            await db.paymentMethods.update(row.id, { archivedAt: nowMs(), isActive: false, updatedAt: nowMs() });
            await refresh();
          }}
          onRename={async (row, name) => {
            await db.paymentMethods.update(row.id, { name, updatedAt: nowMs() });
            await refresh();
          }}
        />
      </CardBody>
    </Card>
  );
}

function CouriersSection() {
  const { version, refresh } = useAppContext();
  const [rows, setRows] = useState<{ id: string; name: string; phone: string }[]>([]);

  useEffect(() => {
    void db.courierProviders.toArray().then((data) => setRows(data.filter((r) => !r.archivedAt).map((r) => ({ id: r.id, name: r.name, phone: r.phone }))));
  }, [version]);

  return (
    <Card>
      <CardHeader title="কুরিয়ার প্রতিষ্ঠান" subtitle="নামগুলো শুধু তালিকায় দেখানোর জন্য — কোনো API সংযোগ নেই" />
      <CardBody>
        <TaxonomyList
          title="কুরিয়ার যোগ করুন"
          rows={rows.map((r) => ({ id: r.id, name: r.name }))}
          onAdd={async (name) => {
            const now = nowMs();
            await db.courierProviders.add({ id: randomId(), name, phone: '', note: '', isActive: true, createdAt: now, updatedAt: now, archivedAt: null });
            await refresh();
          }}
          onDelete={async (row) => {
            await db.courierProviders.update(row.id, { archivedAt: nowMs(), isActive: false, updatedAt: nowMs() });
            await refresh();
          }}
          onRename={async (row, name) => {
            await db.courierProviders.update(row.id, { name, updatedAt: nowMs() });
            await refresh();
          }}
        />
        <div className="mt-3">
          <InfoBanner>কুরিয়ারের স্ট্যাটাস ও COD আপনাকে হাতে আপডেট করতে হবে — এই অ্যাপ কারো সার্ভার থেকে ট্র্যাকিং আনে না।</InfoBanner>
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Stock                                                               */
/* ------------------------------------------------------------------ */

function StockSection({ form, onChange, onSave, busy }: { form: Settings; onChange: (value: Settings) => void; onSave: SaveFn; busy: boolean }) {
  const inventory = form.inventory;
  return (
    <Card>
      <CardHeader title="স্টক নীতি" />
      <CardBody className="space-y-3">
        <Field label="ডিফল্ট কম-স্টক সতর্ক সীমা" hint="নতুন পণ্য যোগ করার সময় এই মান বসবে">
          {({ id }) => (
            <Input id={id} type="number" min={0} value={inventory.defaultLowStockThreshold} onChange={(e) => onChange({ ...form, inventory: { ...inventory, defaultLowStockThreshold: Number(e.target.value) || 0 } })} />
          )}
        </Field>
        <Checkbox
          label="স্টক মাইনাসে যেতে দিন (সতর্কতা সহ)"
          checked={inventory.allowNegativeStock}
          onChange={(e) => onChange({ ...form, inventory: { ...inventory, allowNegativeStock: e.target.checked } })}
        />
        {inventory.allowNegativeStock && (
          <WarningBanner>
            মাইনাস স্টক অনুমোদিত থাকলে বিক্রির সময় স্টক থাকা ছাড়াও অর্ডার করা যাবে। এতে স্টকের মূল্য ও লাভের হিসাব ভুল দেখাতে পারে — সাধারণত বন্ধ রাখাই ভালো।
          </WarningBanner>
        )}
      </CardBody>
      <SectionActions onSave={() => onSave({ inventory })} busy={busy} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

function SecuritySection({ form, onSave, busy, onLock }: { form: Settings; onSave: SaveFn; busy: boolean; onLock: () => void }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const enabled = form.security.pinEnabled;

  const enable = async () => {
    setError(null);
    if (!/^\d{4,8}$/.test(pin)) {
      setError('পিন ৪ থেকে ৮ সংখ্যার হতে হবে');
      return;
    }
    if (pin !== confirmPin) {
      setError('দুটি পিন মিলছে না');
      return;
    }
    setWorking(true);
    try {
      await onSave({ security: { pinEnabled: true, pinRecord: await createPinRecord(pin) } });
      setOpen(false);
      setPin('');
      setConfirmPin('');
    } finally {
      setWorking(false);
    }
  };

  const disable = async () => {
    setError(null);
    const record = form.security.pinRecord;
    if (!record) return;
    const ok = await verifyPin(pin, record);
    if (!ok) {
      setError('পিন সঠিক নয়');
      return;
    }
    setWorking(true);
    try {
      await onSave({ security: { pinEnabled: false, pinRecord: null } });
      setPin('');
    } finally {
      setWorking(false);
    }
  };

  return (
    <Card>
      <CardHeader title="পিন লক" subtitle="অ্যাপ খোলার সময় পিন চাইবে" />
      <CardBody className="space-y-3">
        {error && <ErrorBanner message={error} />}
        <WarningBanner>
          <p className="font-medium">পিন কী করে এবং কী করে না —</p>
          <ul className="mt-1 list-disc pl-5">
            <li>পিন অ্যাপের স্ক্রিন লুকিয়ে রাখে; এটি ডেটাবেস এনক্রিপ্ট করে না।</li>
            <li>পিন কোথাও সংরক্ষিত থাকে না, শুধু একটি PBKDF2 হ্যাশ থাকে। ভুলে গেলে তথ্য মুছে ফেলতে হবে।</li>
            <li>ডিভাইসে ইনস্টল করা অন্য অ্যাপ বা ব্রাউজার এক্সটেনশনের বিরুদ্ধে পিন কোনো সুরক্ষা নয়।</li>
          </ul>
        </WarningBanner>

        {enabled ? (
          <div className="space-y-2">
            <p className="text-sm text-brand-700">পিন লক চালু আছে।</p>
            <Field label="বর্তমান পিন" required>
              {({ id }) => <Input id={id} type="password" inputMode="numeric" dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={disable} loading={working || busy} disabled={pin.length < 4}>
                পিন লক বন্ধ করুন
              </Button>
              <Button variant="outline" onClick={onLock}>
                এখনই লক করুন
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button icon="lock" onClick={() => setOpen(true)}>
              পিন সেট করুন
            </Button>
          </>
        )}
      </CardBody>

      <Modal
        open={open}
        title="নতুন পিন সেট করুন"
        onClose={() => setOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              বাতিল
            </Button>
            <Button onClick={enable} loading={working}>
              সংরক্ষণ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <Field label="পিন (৪-৮ সংখ্যা)" required>
            {({ id }) => <Input id={id} type="password" inputMode="numeric" dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label="পিন আবার দিন" required>
            {({ id }) => <Input id={id} type="password" inputMode="numeric" dir="ltr" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} />}
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

function DataSection() {
  const { refresh, refreshSettings, settings } = useAppContext();
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number }>({});
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (navigator.storage?.estimate) {
      void navigator.storage.estimate().then((result) => setEstimate({ usage: result.usage, quota: result.quota }));
    }
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="ডেটা ব্যবস্থাপনা" />
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-600">
            ব্যবহৃত স্থান: {estimate.usage ? `${(estimate.usage / 1048576).toFixed(1)} MB` : 'জানা নেই'}
            {estimate.quota ? ` / উপলব্ধ আনুমানিক ${(estimate.quota / 1048576).toFixed(0)} MB` : ''}
          </p>
          <Button
            variant="outline"
            icon="refresh"
            onClick={async () => {
              setBusy(true);
              try {
                const result = await rebuildStockLevels();
                await refresh();
                window.alert(`স্টক পুনর্গণনা সম্পন্ন: ${result.rows} টি স্টক রেকর্ড।`);
              } finally {
                setBusy(false);
              }
            }}
            loading={busy}
          >
            স্টক পুনর্গণনা করুন
          </Button>
          <p className="text-xs text-ink-500">
            কোনো কারণে স্টকের হিসাব মিলছে না বলে মনে হলে এটি চালান — সব স্টক মুভমেন্ট থেকে নতুন করে স্টক গণনা হবে।
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="ব্যাকআপ মনে করিয়ে দেওয়া" />
        <CardBody className="space-y-3">
          <Checkbox
            label="নির্দিষ্ট দিন পর ব্যাকআপের কথা মনে করিয়ে দিন"
            checked={settings?.backup.reminderEnabled ?? true}
            onChange={async (e) => {
              const current = await getSettings();
              await updateSettings({ backup: { ...current.backup, reminderEnabled: e.target.checked } });
              await refreshSettings();
            }}
          />
          <Field label="কত দিন পর মনে করিয়ে দেবে">
            {({ id }) => (
              <Select
                id={id}
                options={[
                  { value: '1', label: 'প্রতিদিন' },
                  { value: '3', label: '৩ দিন' },
                  { value: '7', label: 'সপ্তাহে একবার' },
                  { value: '30', label: 'মাসে একবার' },
                ]}
                value={String(settings?.backup.reminderDays ?? 7)}
                onChange={async (e) => {
                  const current = await getSettings();
                  await updateSettings({ backup: { ...current.backup, reminderDays: Number(e.target.value) } });
                  await refreshSettings();
                }}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="বিপদ অঞ্চল" />
        <CardBody>
          <Button variant="danger" icon="trash" onClick={() => setConfirmWipe(true)}>
            সব তথ্য মুছে ফেলুন
          </Button>
          <p className="mt-2 text-xs text-ink-500">
            এই কাজটি আপনার ডিভাইসের সব অর্ডার, কাস্টমার, পণ্য, পেমেন্ট ও খরচ স্থায়ীভাবে মুছে দেবে। আগে অবশ্যই ব্যাকআপ নিন।
          </p>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmWipe}
        title="সব তথ্য মুছে ফেলবেন?"
        message={
          <>
            <p>এই কাজটি ফেরানো যাবে না। নিশ্চিত করতে নিচের ঘরে <strong>মুছে ফেলুন</strong> লিখুন।</p>
            <Input className="mt-2" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="মুছে ফেলুন" aria-label="নিশ্চিতকরণ" />
          </>
        }
        tone="danger"
        confirmLabel="স্থায়ীভাবে মুছুন"
        onCancel={() => {
          setConfirmWipe(false);
          setTyped('');
        }}
        onConfirm={async () => {
          if (typed.trim() !== 'মুছে ফেলুন') return;
          await destroyAllData();
          await refresh();
          await refreshSettings();
          setConfirmWipe(false);
          setTyped('');
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* About                                                               */
/* ------------------------------------------------------------------ */

function AboutSection() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="অ্যাপ সম্পর্কে" />
        <CardBody className="space-y-1 text-sm">
          <p className="font-semibold text-ink-900">Facebook Seller OS</p>
          <p className="text-ink-600">সংস্করণ {APP_VERSION}</p>
          <p className="text-ink-600">ডেটা স্কিমা সংস্করণ {SCHEMA_VERSION}</p>
          <p className="text-ink-600">নির্মাণ: অফলাইন-ফার্স্ট PWA (React + TypeScript + IndexedDB)</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="গোপনীয়তা" />
        <CardBody className="space-y-2 text-sm text-ink-600">
          <p>
            এই অ্যাপ কোনো সার্ভারে তথ্য পাঠায় না। কোনো বিজ্ঞাপন ট্র্যাকার, কোনো অ্যানালিটিক্স এবং কোনো বাহ্যিক API ব্যবহার করা হয় না।
          </p>
          <p>
            আপনার সব ব্যবসায়িক তথ্য এই ডিভাইসের ব্রাউজার স্টোরেজে (IndexedDB) থাকে। ব্রাউজারের তথ্য মুছে ফেললে, ডিভাইস বদলালে বা অ্যাপ আনইনস্টল করলে তথ্য যাবে — ব্যাকআপই একমাত্র সুরক্ষা।
          </p>
          <p className="text-xs text-ink-500">
            একই ডিভাইসে ব্রাউজার ব্যবহার করতে পারা অন্য কেউ এই তথ্য দেখতে পারে। পিন লক শুধু স্ক্রিন ঢেকে রাখে; এটি কোনো এনক্রিপশন নয়।
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="নির্মাতা"
          subtitle="সফটওয়্যারটি কে বানিয়েছেন — কাস্টমার-মুখী কোনো ডকুমেন্টে এটি দেখা যায় না"
        />
        <CardBody className="space-y-1 text-sm">
          <p className="font-semibold text-ink-900">{SOFTWARE_DEVELOPER.name}</p>
          <p className="text-ink-600">{SOFTWARE_DEVELOPER.role}</p>
          <p className="text-ink-600" dir="ltr">
            <a href={`mailto:${SOFTWARE_DEVELOPER.email}`} className="text-brand-700 underline">
              {SOFTWARE_DEVELOPER.email}
            </a>
          </p>
          <p className="mt-2 text-xs text-ink-500">
            এই তথ্য শুধু এই পেজেই থাকে। আপনার ইনভয়েস, রিপোর্ট, কুরিয়ার স্লিপ বা পার্সেল
            লেবেলে কখনোই নির্মাতার নাম বা ঠিকানা বসানো হয় না — সেখানে শুধু আপনার ব্যবসার
            পরিচয় থাকে, যা আপনি সেটিংসের “ব্যবসা” ও “ব্র্যান্ডিং” ট্যাবে নিজেই ঠিক করেন।
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="ক্রেডিট ও লাইসেন্স" subtitle="সব নির্ভরতা মুক্ত ও বাণিজ্যিকভাবে ব্যবহারযোগ্য লাইসেন্সের" />
        <CardBody>
          <ul className="space-y-1 text-sm text-ink-600">
            <li>React — MIT</li>
            <li>Dexie.js — Apache-2.0</li>
            <li>Zod — MIT</li>
            <li>react-router-dom — MIT</li>
            <li>Vite — MIT</li>
            <li>Tailwind CSS — MIT</li>
            <li>Vitest — MIT</li>
            <li>vite-plugin-pwa — MIT</li>
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            অ্যাপের লোগো ও সব আইকন মৌলিকভাবে তৈরি; অন্য কোনো কোম্পানির লোগো বা ট্রেডমার্ক ব্যবহার করা হয়নি।
            কুরিয়ার প্রতিষ্ঠানের নাম শুধু ব্যবহারকারীর সুবিধার জন্য ডিফল্ট তালিকায় দেওয়া আছে — কোনো সংযোগ বা অনুমোদন নেই।
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
