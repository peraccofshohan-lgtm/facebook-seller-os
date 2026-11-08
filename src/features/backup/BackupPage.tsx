import { useRef, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Checkbox } from '@/components/ui/Field';
import { Tabs } from '@/components/ui/Controls';
import { ConfirmDialog } from '@/components/ui/Modal';
import { ErrorBanner, InfoBanner, WarningBanner } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Feedback';
import { useAppContext } from '@/app/AppContext';
import {
  backupFilename,
  buildBackupFile,
  buildEncryptedBackup,
  inspectBackup,
  inspectEncryptedBackup,
  markBackupTaken,
  previewRestore,
  restoreBackup,
  type BackupInspection,
  type RestoreMode,
} from '@/services/backupService';
import {
  autoMapColumns,
  commitCustomerImport,
  commitProductImport,
  CUSTOMER_IMPORT_FIELDS,
  exportCourierCsv,
  exportCustomersCsv,
  exportExpensesCsv,
  exportOrdersCsv,
  exportPaymentsCsv,
  exportProductsCsv,
  exportStockMovementsCsv,
  previewCustomerImport,
  previewProductImport,
  PRODUCT_IMPORT_FIELDS,
  readCsv,
  type CsvPreview,
  type ImportRow,
} from '@/services/importExportService';
import { downloadCsv, downloadText, readFileAsText } from '@/lib/download';
import { formatDateTime } from '@/lib/date';
import { formatBytes } from '@/lib/download';

type ImportKind = 'products' | 'customers';

export default function BackupPage() {
  const { settings, refresh, refreshSettings } = useAppContext();
  const toast = useToast();
  const [tab, setTab] = useState('backup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---------------- Backup ---------------- */
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);

  /* ---------------- Restore ---------------- */
  const restoreInput = useRef<HTMLInputElement>(null);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [preview, setPreview] = useState<{ table: string; incoming: number; add: number; update: number; skip: number; current: number }[]>([]);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  /* ---------------- Import ---------------- */
  const importInput = useRef<HTMLInputElement>(null);
  const [importKind, setImportKind] = useState<ImportKind>('products');
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importSummary, setImportSummary] = useState<{ created: number; updated: number; skipped: number; errors: string[] } | null>(null);
  const [importFileName, setImportFileName] = useState('');

  const fields = importKind === 'products' ? PRODUCT_IMPORT_FIELDS : CUSTOMER_IMPORT_FIELDS;

  const doBackup = async () => {
    setBusy(true);
    setError(null);
    try {
      if (usePassword) {
        if (password.length < 6) {
          setError('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে');
          return;
        }
        const file = await buildEncryptedBackup(password, navigator.userAgent.slice(0, 60));
        downloadText(JSON.stringify({ meta: file.meta, envelope: file.envelope }, null, 2), backupFilename(true), 'application/json;charset=utf-8');
      } else {
        const file = await buildBackupFile(navigator.userAgent.slice(0, 60));
        downloadText(JSON.stringify(file, null, 2), backupFilename(false), 'application/json;charset=utf-8');
      }
      await markBackupTaken();
      await refreshSettings();
      await refresh();
      setPassword('');
      toast.success('ব্যাকআপ ফাইল তৈরি হয়েছে — ফোন/কম্পিউটারে সংরক্ষণ করুন।');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRestoreFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setRestoreFile(file);
    try {
      const text = await readFileAsText(file);
      const result = inspectBackup(text);
      setInspection(result);
      if (result.valid && result.payload) {
        setPreview(await previewRestore(result.payload, mode));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const unlockEncrypted = async () => {
    if (!inspection?.envelope || !inspection.meta) return;
    setBusy(true);
    setError(null);
    try {
      const result = await inspectEncryptedBackup(inspection.envelope, inspection.meta, restorePassword);
      setInspection(result);
      if (result.valid && result.payload) setPreview(await previewRestore(result.payload, mode));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async () => {
    if (!inspection?.payload) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreBackup(inspection.payload, mode);
      await refresh();
      await refreshSettings();
      setConfirmRestore(false);
      setInspection(null);
      setPreview([]);
      setRestoreFile(null);
      toast.success(
        mode === 'replace'
          ? `রিস্টোর সম্পন্ন (${result.durationMs} মিলিসেকেন্ড) — পুরনো তথ্য প্রতিস্থাপন করা হয়েছে।`
          : `রিস্টোর সম্পন্ন — নতুন রেকর্ড যোগ ও নতুনতর রেকর্ড আপডেট হয়েছে।`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onImportFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setImportSummary(null);
    try {
      const text = await readFileAsText(file);
      const parsed = readCsv(text);
      setImportFileName(file.name);
      if (parsed.headers.length === 0) {
        setError('CSV ফাইলে কোনো সারি পাওয়া যায়নি।');
        setCsvPreview(null);
        return;
      }
      setCsvPreview(parsed);
      setMapping(autoMapColumns(parsed.headers, fields));
      const result = importKind === 'products' ? await previewProductImport(parsed, autoMapColumns(parsed.headers, fields)) : await previewCustomerImport(parsed, autoMapColumns(parsed.headers, fields));
      setImportRows(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const refreshImportPreview = async () => {
    if (!csvPreview) return;
    setBusy(true);
    try {
      const result = importKind === 'products' ? await previewProductImport(csvPreview, mapping) : await previewCustomerImport(csvPreview, mapping);
      setImportRows(result.rows);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = importKind === 'products' ? await commitProductImport(importRows) : await commitCustomerImport(importRows);
      setImportSummary(result);
      await refresh();
      toast.success(`ইমপোর্ট সম্পন্ন: ${result.created} নতুন, ${result.updated} হালনাগাদ, ${result.skipped} বাদ।`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const validImportRows = importRows.filter((row) => row.errors.length === 0);

  return (
    <>
      <PageHeader
        title="ব্যাকআপ, রিস্টোর ও ইমপোর্ট/এক্সপোর্ট"
        subtitle="আপনার তথ্য আপনার ডিভাইসেই থাকে — তাই ব্যাকআপই একমাত্র সুরক্ষা"
      />

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: 'backup', label: 'ব্যাকআপ' },
            { key: 'restore', label: 'রিস্টোর' },
            { key: 'import', label: 'CSV ইমপোর্ট' },
            { key: 'export', label: 'এক্সপোর্ট' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {tab === 'backup' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="ব্যাকআপ তৈরি করুন" subtitle="সব তথ্য একটি ফাইলে" />
            <CardBody className="space-y-3">
              <p className="text-sm text-ink-600">
                ব্যাকআপ ফাইলে থাকে: পণ্য, কাস্টমার, অর্ডার, পেমেন্ট, কুরিয়ার, রিটার্ন, খরচ, স্টক মুভমেন্ট ও সেটিংস।
              </p>
              <Checkbox label="পাসওয়ার্ড দিয়ে এনক্রিপ্ট করুন" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
              {usePassword && (
                <>
                  <Field label="পাসওয়ার্ড" required hint="কমপক্ষে ৬ অক্ষর">
                    {({ id }) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
                  </Field>
                  <WarningBanner>
                    পাসওয়ার্ড কোথাও সংরক্ষিত হয় না। ভুলে গেলে এই ব্যাকআপ আর খোলা যাবে না — কোনো “পাসওয়ার্ড রিসেট” নেই।
                  </WarningBanner>
                </>
              )}
              <Button block icon="download" loading={busy} onClick={doBackup}>
                ব্যাকআপ ডাউনলোড করুন
              </Button>
              <p className="text-xs text-ink-500">
                সর্বশেষ ব্যাকআপ: {settings?.backup?.lastBackupAt ? formatDateTime(settings.backup.lastBackupAt) : 'কখনো নেওয়া হয়নি'}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="কেন ব্যাকআপ জরুরি" />
            <CardBody>
              <ul className="space-y-2 text-sm text-ink-600">
                <li className="flex gap-2">
                  <Icon name="warning" size={16} className="mt-1 shrink-0 text-amber-600" />
                  এই অ্যাপের তথ্য কোনো সার্ভারে যায় না। ফোন হারালে, ফর্ম্যাট করলে বা ব্রাউজারের ডেটা মুছলে তথ্য ফেরত পাওয়া যাবে না।
                </li>
                <li className="flex gap-2">
                  <Icon name="info" size={16} className="mt-1 shrink-0 text-sky-600" />
                  প্রতি সপ্তাহে অন্তত একবার ব্যাকআপ নিয়ে ফাইলটি গুগল ড্রাইভ বা অন্য ফোনে রাখুন।
                </li>
                <li className="flex gap-2">
                  <Icon name="check" size={16} className="mt-1 shrink-0 text-brand-700" />
                  ব্যাকআপ নেওয়া ও রিস্টোর করা — দুটোই সম্পূর্ণ অফলাইনে কাজ করে।
                </li>
              </ul>
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'restore' && (
        <Card>
          <CardHeader title="ব্যাকআপ থেকে ফিরিয়ে আনুন" />
          <CardBody className="space-y-3">
            <input
              ref={restoreInput}
              type="file"
              accept=".json,.fsos,application/json"
              className="block w-full text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onRestoreFile(file);
              }}
            />

            {inspection && (
              <div className="space-y-3">
                {inspection.issues.map((issue) =>
                  issue.level === 'error' ? (
                    <ErrorBanner key={issue.message} message={issue.message} />
                  ) : (
                    <WarningBanner key={issue.message}>{issue.message}</WarningBanner>
                  ),
                )}

                {inspection.meta && (
                  <dl className="grid grid-cols-2 gap-2 rounded-lg bg-ink-50 p-3 text-sm">
                    <div>
                      <dt className="text-xs text-ink-500">তৈরি</dt>
                      <dd>{formatDateTime(inspection.meta.createdAtMs)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">অ্যাপ সংস্করণ</dt>
                      <dd>{inspection.meta.appVersion}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">স্কিমা</dt>
                      <dd>{inspection.meta.schemaVersion}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">এনক্রিপ্টেড</dt>
                      <dd>{inspection.meta.encrypted ? 'হ্যাঁ' : 'না'}</dd>
                    </div>
                  </dl>
                )}

                {inspection.encrypted && !inspection.payload && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="ব্যাকআপ পাসওয়ার্ড" required>
                      {({ id }) => <Input id={id} type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} />}
                    </Field>
                    <Button onClick={unlockEncrypted} loading={busy}>
                      আনলক করুন
                    </Button>
                  </div>
                )}

                {inspection.valid && inspection.payload && (
                  <>
                    <Field label="রিস্টোর পদ্ধতি" hint="মার্জ: নতুন রেকর্ড যোগ হবে, বিদ্যমান রেকর্ড নতুন হলে আপডেট হবে, কিছু মুছবে না। রিপ্লেস: বর্তমান সব তথ্য মুছে ব্যাকআপের তথ্য বসবে।">
                      {({ id }) => (
                        <Select
                          id={id}
                          options={[
                            { value: 'merge', label: 'মার্জ (নিরাপদ)' },
                            { value: 'replace', label: 'রিপ্লেস (সব মুছে নতুন করে)' },
                          ]}
                          value={mode}
                          onChange={async (e) => {
                            const next = e.target.value as RestoreMode;
                            setMode(next);
                            setPreview(await previewRestore(inspection.payload!, next));
                          }}
                        />
                      )}
                    </Field>

                    <div className="overflow-x-auto rounded-lg border border-ink-200">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-ink-200 bg-ink-50/70 text-xs text-ink-600">
                            <th className="px-3 py-2 text-left">টেবিল</th>
                            <th className="px-3 py-2 text-right">এখন আছে</th>
                            <th className="px-3 py-2 text-right">ব্যাকআপে</th>
                            <th className="px-3 py-2 text-right">নতুন</th>
                            <th className="px-3 py-2 text-right">হালনাগাদ</th>
                            <th className="px-3 py-2 text-right">বাদ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.map((row) => (
                            <tr key={row.table} className="border-b border-ink-100 last:border-0">
                              <td className="px-3 py-1.5">{row.table}</td>
                              <td className="tabular px-3 py-1.5 text-right">{row.current}</td>
                              <td className="tabular px-3 py-1.5 text-right">{row.incoming}</td>
                              <td className="tabular px-3 py-1.5 text-right text-brand-700">{row.add}</td>
                              <td className="tabular px-3 py-1.5 text-right text-sky-700">{row.update}</td>
                              <td className="tabular px-3 py-1.5 text-right text-ink-400">{row.skip}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {mode === 'replace' && (
                      <WarningBanner>রিপ্লেস করলে বর্তমান ডিভাইসের সব ব্যবসায়িক তথ্য মুছে যাবে এবং ব্যাকআপের তথ্য বসবে। এই কাজটি আর ফেরানো যাবে না।</WarningBanner>
                    )}

                    <Button icon="upload" onClick={() => setConfirmRestore(true)} disabled={busy}>
                      রিস্টোর শুরু করুন
                    </Button>
                  </>
                )}
              </div>
            )}

            {!inspection && (
              <InfoBanner>
                ব্যাকআপ ফাইল (.json বা .fsos) নির্বাচন করুন। ফাইলটি খুলে আগে প্রিভিউ দেখানো হবে — আপনি না চাপলে কিছুই বদলাবে না।
              </InfoBanner>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'import' && (
        <Card>
          <CardHeader title="CSV ইমপোর্ট" subtitle="এক্সেল বা গুগল শিট থেকে পণ্য/কাস্টমার আনুন" />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Select
                aria-label="কী ইমপোর্ট করবেন"
                options={[
                  { value: 'products', label: 'পণ্য (Products)' },
                  { value: 'customers', label: 'কাস্টমার (Customers)' },
                ]}
                value={importKind}
                onChange={(e) => {
                  setImportKind(e.target.value as ImportKind);
                  setCsvPreview(null);
                  setImportRows([]);
                  setImportSummary(null);
                }}
                className="h-10 w-auto"
              />
              <input
                ref={importInput}
                type="file"
                accept=".csv,text/csv"
                className="block w-full max-w-sm text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onImportFile(file);
                }}
              />
            </div>

            <p className="text-xs text-ink-500">
              প্রথম সারিতে কলামের নাম রাখুন (বাংলা বা ইংরেজি — দুটোই চলবে)। ফাইলটি UTF-8 হতে হবে; এক্সেল থেকে “CSV UTF-8” হিসেবে সেভ করুন।
            </p>

            {csvPreview && (
              <>
                <div className="rounded-lg border border-ink-200 p-3">
                  <p className="mb-2 text-sm font-medium text-ink-800">কলাম ম্যাপিং ({importFileName})</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {fields.map((field) => (
                      <Field key={field.key} label={field.label} required={field.required}>
                        {({ id }) => (
                          <Select
                            id={id}
                            options={[
                              { value: '-1', label: '— আমদানি করবেন না —' },
                              ...csvPreview.headers.map((header, index) => ({ value: String(index), label: header })),
                            ]}
                            value={mapping[field.key] === null || mapping[field.key] === undefined ? '-1' : String(mapping[field.key])}
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              setMapping((prev) => ({ ...prev, [field.key]: value < 0 ? null : value }));
                            }}
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                  <Button className="mt-3" size="sm" variant="outline" onClick={refreshImportPreview} loading={busy}>
                    প্রিভিউ আপডেট করুন
                  </Button>
                </div>

                <div className="flex flex-wrap gap-3 text-sm">
                  <span>মোট সারি: {importRows.length}</span>
                  <span className="text-brand-700">ঠিক আছে: {validImportRows.length}</span>
                  <span className="text-rose-600">সমস্যা: {importRows.length - validImportRows.length}</span>
                  <span className="text-ink-500">
                    নতুন: {importRows.filter((row) => row.action === 'create').length} • হালনাগাদ: {importRows.filter((row) => row.action === 'update').length}
                  </span>
                </div>

                <div className="max-h-72 overflow-auto rounded-lg border border-ink-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-ink-50">
                      <tr className="text-xs text-ink-600">
                        <th className="px-3 py-2 text-left">সারি</th>
                        <th className="px-3 py-2 text-left">তথ্য</th>
                        <th className="px-3 py-2 text-left">অবস্থা</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 200).map((row) => (
                        <tr key={row.index} className="border-b border-ink-100">
                          <td className="px-3 py-1.5 text-ink-500">{row.index}</td>
                          <td className="px-3 py-1.5">{Object.entries(row.values).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).slice(0, 4).join(' • ')}</td>
                          <td className="px-3 py-1.5">
                            {row.errors.length > 0 ? (
                              <span className="text-rose-600">{row.errors.join(', ')}</span>
                            ) : (
                              <span className="text-brand-700">{row.action === 'create' ? 'নতুন যোগ হবে' : 'হালনাগাদ হবে'}</span>
                            )}
                            {row.warnings.map((warning) => (
                              <span key={warning} className="ml-1 text-xs text-amber-600">
                                ({warning})
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Button icon="upload" onClick={runImport} loading={busy} disabled={validImportRows.length === 0}>
                  {validImportRows.length} টি সারি ইমপোর্ট করুন
                </Button>
              </>
            )}

            {importSummary && (
              <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
                <p>
                  ইমপোর্ট শেষ: {importSummary.created} নতুন, {importSummary.updated} হালনাগাদ, {importSummary.skipped} বাদ।
                </p>
                {importSummary.errors.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {importSummary.errors.slice(0, 5).map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'export' && (
        <Card>
          <CardHeader title="CSV এক্সপোর্ট" subtitle="এক্সেলে খোলা যাবে — বাংলা টেক্সট ঠিক থাকবে (UTF-8 BOM সহ)" />
          <CardBody className="grid gap-2 sm:grid-cols-2">
            <ExportButton label="পণ্য (স্টক সহ)" onClick={exportProductsCsv} name="products" />
            <ExportButton label="কাস্টমার" onClick={exportCustomersCsv} name="customers" />
            <ExportButton label="অর্ডার" onClick={() => exportOrdersCsv()} name="orders" />
            <ExportButton label="খরচ" onClick={() => exportExpensesCsv()} name="expenses" />
            <ExportButton label="কুরিয়ার" onClick={exportCourierCsv} name="courier" />
            <ExportButton label="লেনদেন" onClick={exportPaymentsCsv} name="payments" />
            <ExportButton label="স্টক মুভমেন্ট" onClick={() => exportStockMovementsCsv()} name="stock-movements" />
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmRestore}
        title={mode === 'replace' ? 'সব তথ্য প্রতিস্থাপন করবেন?' : 'ব্যাকআপ মার্জ করবেন?'}
        message={
          mode === 'replace'
            ? `“${restoreFile?.name ?? 'ব্যাকআপ'}” ফাইলের তথ্য দিয়ে বর্তমান সব তথ্য বদলে যাবে। এই কাজটি আর ফেরানো যাবে না।`
            : `“${restoreFile?.name ?? 'ব্যাকআপ'}” ফাইলের নতুন রেকর্ড যোগ হবে এবং নতুনতর রেকর্ড আপডেট হবে। কোনো তথ্য মুছবে না।`
        }
        tone={mode === 'replace' ? 'danger' : 'primary'}
        confirmLabel={mode === 'replace' ? 'হ্যাঁ, প্রতিস্থাপন করুন' : 'হ্যাঁ, মার্জ করুন'}
        busy={busy}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={runRestore}
      />
    </>
  );
}

function ExportButton({ label, onClick, name }: { label: string; onClick: () => Promise<string>; name: string }) {
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<string | null>(null);
  return (
    <Button
      variant="outline"
      icon="download"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const csv = await onClick();
          setSize(formatBytes(new Blob([csv]).size));
          downloadCsv(csv, `${name}-${Date.now()}.csv`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
      {size ? <span className="text-xs text-ink-400">({size})</span> : null}
    </Button>
  );
}
