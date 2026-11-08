/**
 * CourierSlipsPage.tsx — the Shipping Center document desk (V2).
 *
 * Pick consignments → see exactly what will print → print (or "Save as PDF" from the
 * browser's own dialog). Everything is rendered with the app's real components and the
 * seller's real business identity, so the on-screen preview IS the document.
 *
 * Notes on what this page does NOT do:
 *  - It does not track parcels. There is no courier API integration; the tracking id is
 *    whatever the seller types, and the app says so on the slip.
 *  - It cannot know whether the printer actually ran. "প্রিন্ট হয়েছে" records that the
 *    seller pressed print, which is the honest version of the number.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ErrorBanner, InfoBanner } from '@/components/ui/Feedback';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { formatDate } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { listCourierRecords } from '@/services/courierService';
import {
  buildCourierSlips,
  createNoteTemplate,
  deleteNoteTemplate,
  listNoteTemplates,
  markSlipPrinted,
  updateNoteTemplate,
  type CourierSlip,
} from '@/services/courierSlipService';
import { ALIGN_LABEL, FONT_SCALE_LABEL, NOTE_KIND_LABEL } from '@/domain/constants';
import type { NoteTemplate } from '@/domain/types';
import { CourierBookingSlip } from './CourierBookingSlip';
import { ParcelLabel } from './ParcelLabel';

type DocumentKind = 'slip' | 'label';

export default function CourierSlipsPage() {
  const { settings, refresh } = useAppContext();
  const [params] = useSearchParams();

  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<DocumentKind>('slip');
  const [paper, setPaper] = useState<'a4' | 'pos'>(settings?.documents?.courierSlipPaper ?? 'a4');
  const [labelSize, setLabelSize] = useState<'small' | 'medium'>(settings?.documents?.labelSize ?? 'medium');
  const [noteTemplateId, setNoteTemplateId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const records = useAsync(() => listCourierRecords({ limit: 200 }), []);
  const templates = useAsync(() => listNoteTemplates(), []);

  // A "স্লিপ" button on the courier list links here with ?records=<id> preselected.
  useEffect(() => {
    const fromUrl = params.get('records');
    if (fromUrl) setSelected(fromUrl.split(',').filter(Boolean));
  }, [params]);

  const rows = useMemo(() => records.data?.rows ?? [], [records.data]);

  const slips = useAsync(async () => {
    if (selected.length === 0) return [] as CourierSlip[];
    return buildCourierSlips(selected, { noteTemplateId: noteTemplateId || null });
  }, [selected.join(','), noteTemplateId, records.data]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const print = async () => {
    setPrinting(true);
    setError(null);
    try {
      // Record the print BEFORE opening the dialog: the seller has already committed,
      // and the browser print dialog gives us no reliable completion signal.
      await markSlipPrinted(selected, noteTemplateId || null);
      window.print();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPrinting(false);
    }
  };

  const allSelected = rows.length > 0 && selected.length === rows.length;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="কুরিয়ার বুকিং স্লিপ ও লেবেল"
          subtitle="এক বা একাধিক পার্সেলের স্লিপ ও লেবেল তৈরি ও প্রিন্ট করুন"
        />

        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="কনসাইনমেন্ট নির্বাচন"
                subtitle={selected.length ? `${selected.length}টি নির্বাচিত` : 'যেগুলো প্রিন্ট করবেন সেগুলো টিক দিন'}
              />
              <CardBody className="space-y-2">
                {rows.length === 0 ? (
                  <p className="text-sm text-ink-500">
                    এখনো কোনো কুরিয়ার রেকর্ড নেই। প্রথমে কুরিয়ার পেজে একটি রেকর্ড তৈরি করুন।
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between border-b border-ink-200 pb-2">
                      <Checkbox
                        id="select-all"
                        label="সব নির্বাচন করুন"
                        checked={allSelected}
                        onChange={(event) => setSelected(event.target.checked ? rows.map((r) => r.id) : [])}
                      />
                      {selected.length > 0 ? (
                        <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                          নির্বাচন সাফ করুন
                        </Button>
                      ) : null}
                    </div>
                    <ul className="max-h-72 space-y-1 overflow-y-auto">
                      {rows.map((record) => (
                        <li key={record.id}>
                          <Checkbox
                            id={`record-${record.id}`}
                            checked={selected.includes(record.id)}
                            onChange={() => toggle(record.id)}
                            label={`${record.consignmentId || '(কনসাইনমেন্ট নেই)'} — ${record.orderNumber || 'অর্ডার নেই'} · ${formatDate(
                              record.shipmentDate,
                            )} · COD ${formatMoney(record.codAmount)}`}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="প্রিভিউ" subtitle="এখানে যা দেখছেন, প্রিন্টে ঠিক তাই আসবে" />
              <CardBody>
                {slips.data && slips.data.length > 0 ? (
                  <div className="space-y-4">
                    {slips.data.map((slip, index) =>
                      kind === 'slip' ? (
                        <CourierBookingSlip
                          key={slip.record.id}
                          slip={slip}
                          settings={settings}
                          paper={paper}
                          pageBreak={index > 0}
                        />
                      ) : (
                        <ParcelLabel
                          key={slip.record.id}
                          slip={slip}
                          settings={settings}
                          size={labelSize}
                          pageBreak={index > 0}
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <InfoBanner>
                    ডানদিকে ডকুমেন্টের ধরণ ঠিক করে বাম থেকে অন্তত একটি কনসাইনমেন্ট নির্বাচন করুন।
                  </InfoBanner>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="প্রিন্ট সেটিং" />
              <CardBody className="space-y-3">
                <Field label="ডকুমেন্ট">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={kind}
                      onChange={(event) => setKind(event.target.value as DocumentKind)}
                      options={[
                        { value: 'slip', label: 'বুকিং স্লিপ' },
                        { value: 'label', label: 'পার্সেল লেবেল' },
                      ]}
                    />
                  )}
                </Field>
                {kind === 'slip' ? (
                  <Field label="কাগজের আকার">
                    {({ id }) => (
                      <Select
                        id={id}
                        value={paper}
                        onChange={(event) => setPaper(event.target.value as 'a4' | 'pos')}
                        options={[
                          { value: 'a4', label: 'A4' },
                          { value: 'pos', label: 'থার্মাল (সরু)' },
                        ]}
                      />
                    )}
                  </Field>
                ) : (
                  <Field label="লেবেলের আকার">
                    {({ id }) => (
                      <Select
                        id={id}
                        value={labelSize}
                        onChange={(event) => setLabelSize(event.target.value as 'small' | 'medium')}
                        options={[
                          { value: 'small', label: 'ছোট' },
                          { value: 'medium', label: 'মাঝারি' },
                        ]}
                      />
                    )}
                  </Field>
                )}

                <Field label="নোট টেমপ্লেট" hint="স্লিপে কোন বার্তা ছাপা হবে">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={noteTemplateId}
                      onChange={(event) => setNoteTemplateId(event.target.value)}
                      options={[
                        { value: '', label: 'ডিফল্ট নোট' },
                        ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name })),
                      ]}
                    />
                  )}
                </Field>

                <Button
                  icon="print"
                  loading={printing}
                  disabled={selected.length === 0}
                  onClick={() => void print()}
                  className="w-full"
                >
                  প্রিন্ট করুন ({selected.length})
                </Button>
                <p className="text-[11px] text-ink-500">
                  PDF রাখতে চাইলে প্রিন্ট ডায়লগে <strong>Destination → Save as PDF</strong> বেছে নিন।
                  এটি আপনার ব্রাউজারের নিজস্ব সুবিধা — কোনো বাড়তি সফটওয়্যার বা অনলাইন সেবা লাগে না।
                </p>
              </CardBody>
            </Card>

            <NoteDesigner
              templates={templates.data ?? []}
              selectedId={noteTemplateId}
              onSelect={setNoteTemplateId}
              onChange={templates.reload}
              onError={setError}
            />

            <Card>
              <CardHeader title="গুরুত্বপূর্ণ" />
              <CardBody className="space-y-1 text-[11px] text-ink-600">
                <p>
                  এই অ্যাপ কোনো কুরিয়ার প্রতিষ্ঠানের সাথে সংযুক্ত নয় এবং কোনো লাইভ ট্র্যাকিং দেখায় না।
                  ট্র্যাকিং/কনসাইনমেন্ট আইডি আপনি নিজেই লিখবেন।
                </p>
                <p>প্রিন্ট করা মানে এই অ্যাপের রেকর্ডে “প্রিন্ট হয়েছে” লেখা হয়েছে — প্রিন্টার কাজ করেছে কি না তা অ্যাপ জানে না।</p>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {/* The printable copy: hidden on screen, laid out by the browser when printing. */}
      <div className="hidden print:block">
        {slips.data?.map((slip, index) =>
          kind === 'slip' ? (
            <CourierBookingSlip
              key={slip.record.id}
              slip={slip}
              settings={settings}
              paper={paper}
              pageBreak={index > 0}
            />
          ) : (
            <ParcelLabel
              key={slip.record.id}
              slip={slip}
              settings={settings}
              size={labelSize}
              pageBreak={index > 0}
            />
          ),
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Note designer                                                       */
/* ------------------------------------------------------------------ */

function NoteDesigner({
  templates,
  selectedId,
  onSelect,
  onChange,
  onError,
}: {
  templates: NoteTemplate[];
  selectedId: string;
  onSelect: (id: string) => void;
  onChange: () => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState<NoteTemplate | null>(null);
  const [draft, setDraft] = useState({ name: '', body: '', footer: '', align: 'left', fontScale: 'normal' });

  const startNew = () => {
    setEditing(null);
    setDraft({ name: '', body: '', footer: '', align: 'left', fontScale: 'normal' });
  };

  const startEdit = (template: NoteTemplate) => {
    setEditing(template);
    setDraft({
      name: template.name,
      body: template.body,
      footer: template.footer,
      align: template.align,
      fontScale: template.fontScale,
    });
  };

  const save = async () => {
    if (!draft.name.trim()) {
      onError('নোটের নাম দিন');
      return;
    }
    onError(null);
    try {
      if (editing) {
        await updateNoteTemplate(editing.id, {
          kind: editing.kind,
          name: draft.name,
          body: draft.body,
          footer: draft.footer,
          align: draft.align as NoteTemplate['align'],
          fontScale: draft.fontScale as NoteTemplate['fontScale'],
          isActive: true,
          isDefault: editing.isDefault,
        });
      } else {
        await createNoteTemplate({
          kind: 'courier_slip',
          name: draft.name,
          body: draft.body,
          footer: draft.footer,
          align: draft.align as NoteTemplate['align'],
          fontScale: draft.fontScale as NoteTemplate['fontScale'],
          isActive: true,
          isDefault: false,
        });
      }
      onChange();
      startNew();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card>
      <CardHeader title="নোট ডিজাইনার" subtitle="স্লিপে আপনার নিজের বার্তা লিখুন" />
      <CardBody className="space-y-3">
        {templates.length > 0 ? (
          <ul className="space-y-1">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center gap-2">
                <button
                  type="button"
                  className={`flex-1 rounded border px-2 py-1.5 text-left text-xs ${
                    selectedId === template.id ? 'border-brand-500 bg-brand-50' : 'border-ink-200'
                  }`}
                  onClick={() => onSelect(template.id)}
                >
                  <span className="font-medium text-ink-800">{template.name}</span>
                  <span className="ml-1 text-[10px] text-ink-500">
                    {NOTE_KIND_LABEL[template.kind] ?? template.kind}
                  </span>
                </button>
                <Button variant="ghost" size="sm" icon="edit" onClick={() => startEdit(template)} aria-label="সম্পাদনা" />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  onClick={() => void deleteNoteTemplate(template.id).then(onChange).catch((e: unknown) => onError(String(e)))}
                  aria-label="মুছুন"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-500">এখনো কোনো নোট নেই। নিচে থেকে একটি তৈরি করুন।</p>
        )}

        <div className="space-y-2 border-t border-ink-200 pt-3">
          <Field label="নোটের নাম">
            {({ id }) => (
              <Input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            )}
          </Field>
          <Field label="বার্তা">
            {({ id }) => (
              <Textarea
                id={id}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="যেমন: অনুগ্রহ করে পার্সেলটি সাবধানে হ্যান্ডেল করবেন।"
              />
            )}
          </Field>
          <Field label="ফুটার (ঐচ্ছিক)">
            {({ id }) => (
              <Input id={id} value={draft.footer} onChange={(e) => setDraft({ ...draft, footer: e.target.value })} />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="বিন্যাস">
              {({ id }) => (
                <Select
                  id={id}
                  value={draft.align}
                  onChange={(e) => setDraft({ ...draft, align: e.target.value })}
                  options={(Object.keys(ALIGN_LABEL) as Array<keyof typeof ALIGN_LABEL>).map((key) => ({
                    value: key,
                    label: ALIGN_LABEL[key],
                  }))}
                />
              )}
            </Field>
            <Field label="অক্ষরের আকার">
              {({ id }) => (
                <Select
                  id={id}
                  value={draft.fontScale}
                  onChange={(e) => setDraft({ ...draft, fontScale: e.target.value })}
                  options={(Object.keys(FONT_SCALE_LABEL) as Array<keyof typeof FONT_SCALE_LABEL>).map((key) => ({
                    value: key,
                    label: FONT_SCALE_LABEL[key],
                  }))}
                />
              )}
            </Field>
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon="save" onClick={() => void save()}>
              {editing ? 'হালনাগাদ' : 'নোট যোগ করুন'}
            </Button>
            {editing ? (
              <Button size="sm" variant="ghost" onClick={startNew}>
                বাতিল
              </Button>
            ) : null}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
