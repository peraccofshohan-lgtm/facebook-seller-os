/**
 * CourierBookingSlip.tsx — the printable booking slip (V2).
 *
 * Rendered inside the normal React tree and hidden until print, exactly like the invoice:
 * that way Bangla uses the font the app already loaded, the business logo is the same
 * data URL the seller uploaded, and the browser's own "Save as PDF" produces the PDF.
 * No PDF library, no paid service, no network.
 */

import { forwardRef } from 'react';
import { formatDate } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { formatPhone } from '@/lib/search';
import { ALIGN_CLASS, FONT_SCALE_CLASS } from '@/domain/constants';
import { BrandingBlock, BrandingFooter } from '@/features/branding/BrandingBlock';
import type { Settings } from '@/domain/types';
import type { CourierSlip } from '@/services/courierSlipService';

export interface CourierBookingSlipProps {
  slip: CourierSlip;
  settings: Settings | null;
  /** 'a4' prints one slip per page; 'pos' prints a narrow strip suitable for aThermal roll. */
  paper?: 'a4' | 'pos';
  /** Force a page break before this slip, for bulk printing. */
  pageBreak?: boolean;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-ink-200 py-1">
      <span className="text-[11px] text-ink-500">{label}</span>
      <span className={`tabular ${strong ? 'text-[15px] font-bold text-ink-900' : 'text-[13px] text-ink-800'}`}>
        {value}
      </span>
    </div>
  );
}

export const CourierBookingSlip = forwardRef<HTMLDivElement, CourierBookingSlipProps>(
  function CourierBookingSlip({ slip, settings, paper = 'a4', pageBreak = false }, ref) {
    const { record, sender, recipient, money, note, order } = slip;
    const align = ALIGN_CLASS[note?.align ?? 'left'];
    const scale = FONT_SCALE_CLASS[note?.fontScale ?? settings?.branding?.fontScale ?? 'normal'];

    const senderLine = [sender.address, sender.area, sender.district].filter(Boolean).join(', ');
    const senderPhones = [sender.phone, sender.altPhone].filter(Boolean).join(' • ');
    const recipientLine = [recipient.address, recipient.area, recipient.district, recipient.postcode]
      .filter(Boolean)
      .join(', ');

    return (
      <div className={pageBreak ? 'break-before-page' : undefined}>
        <div
          ref={ref}
          className={`print-sheet mx-auto bg-white p-5 text-ink-900 ${paper === 'pos' ? 'max-w-[320px]' : 'max-w-[800px]'}`}
        >
          <BrandingBlock
            settings={settings}
            surface="courierSlip"
            meta={
              <div className="text-right">
                <p className="text-base font-bold">কুরিয়ার বুকিং স্লিপ</p>
                <p className="text-xs text-ink-600">কুরিয়ার: {slip.providerName || '—'}</p>
                <p className="text-xs text-ink-600">বুকিং: {formatDate(slip.bookingDate)}</p>
              </div>
            }
          />

          {/* Fragile / handle-with-care band — printed loud because it is the one thing
              a courier hub worker must not miss. */}
          {(record.fragile || record.handleWithCare) && (
            <div className="mt-3 flex flex-wrap gap-2 rounded border-2 border-dashed border-rose-500 bg-rose-50 px-3 py-2">
              {record.fragile && <span className="text-sm font-bold text-rose-700">⚠ ভঙ্গুর — FRAGILE</span>}
              {record.handleWithCare && (
                <span className="text-sm font-bold text-rose-700">সাবধানে হ্যান্ডেল করুন — HANDLE WITH CARE</span>
              )}
            </div>
          )}

          <div className={`mt-4 grid gap-4 ${paper === 'pos' ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <section className="rounded border border-ink-200 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">প্রেরক (ব্যবসা)</p>
              <p className="mt-1 font-semibold">{sender.name || '—'}</p>
              {sender.ownerName ? <p className="text-xs text-ink-600">{sender.ownerName}</p> : null}
              {senderLine ? <p className="whitespace-pre-line text-xs text-ink-600">{senderLine}</p> : null}
              {senderPhones ? <p className="text-xs text-ink-600">{senderPhones}</p> : null}
            </section>

            <section className="rounded border border-ink-200 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">প্রাপক (কাস্টমার)</p>
              <p className="mt-1 font-semibold">{recipient.name}</p>
              <p className="text-xs text-ink-600" dir="ltr">
                ফোন: {formatPhone(recipient.phone) || '—'}
              </p>
              {recipient.altPhone ? (
                <p className="text-xs text-ink-600" dir="ltr">
                  বিকল্প: {formatPhone(recipient.altPhone)}
                </p>
              ) : null}
              {recipientLine ? <p className="whitespace-pre-line text-xs text-ink-600">{recipientLine}</p> : null}
            </section>
          </div>

          <div className={`mt-4 grid gap-4 ${paper === 'pos' ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <section>
              <Row label="কনসাইনমেন্ট / ট্র্যাকিং আইডি" value={record.consignmentId || '—'} strong />
              <Row label="অর্ডার নম্বর" value={record.orderNumber || order?.orderNumber || '—'} />
              <Row label="পার্সেল সংখ্যা" value={String(record.parcelCount || 1)} />
              <Row label="পণ্যের মূল্য" value={formatMoney(money.productValue)} />
            </section>
            <section>
              <Row label="ডেলিভারি চার্জ (কাস্টমার)" value={formatMoney(money.deliveryCharge)} />
              <Row label="অগ্রিম পরিশোধিত" value={formatMoney(money.advancePaid)} />
              <Row
                label={money.fullyPrepaid ? 'COD (সম্পূর্ণ অগ্রিম পরিশোধিত)' : 'COD — কুরিয়ার আদায় করবে'}
                value={formatMoney(money.codToCollect)}
                strong
              />
              <Row label="অর্ডারের সর্বমোট" value={formatMoney(money.orderTotal)} />
            </section>
          </div>

          {slip.contents.length > 0 && (
            <table className="mt-4 w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-y border-ink-300 bg-ink-100/60">
                  <th className="px-2 py-1 text-left">#</th>
                  <th className="px-2 py-1 text-left">পণ্য</th>
                  <th className="px-2 py-1 text-right">পরিমাণ</th>
                </tr>
              </thead>
              <tbody>
                {slip.contents.map((line, index) => (
                  <tr key={`${line.name}-${index}`} className="border-b border-ink-200">
                    <td className="px-2 py-1">{index + 1}</td>
                    <td className="px-2 py-1">{line.name}</td>
                    <td className="tabular px-2 py-1 text-right">
                      {line.quantity} {line.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {record.specialInstructions ? (
            <p className="mt-3 rounded border border-ink-200 p-2 text-xs">
              <span className="font-semibold">বিশেষ নির্দেশ: </span>
              {record.specialInstructions}
            </p>
          ) : null}

          {/* The seller's own note. Body and footer come from the note template they
              designed; the alignment and font size are theirs too. */}
          {(note?.body || record.sellerNote) && (
            <div className={`mt-3 rounded border border-ink-200 bg-ink-50 p-2 ${align} ${scale}`}>
              {note?.body ? <p className="whitespace-pre-line">{note.body}</p> : null}
              {record.sellerNote ? <p className="mt-1 whitespace-pre-line">{record.sellerNote}</p> : null}
              {note?.footer ? <p className="mt-1 text-[11px] text-ink-500">{note.footer}</p> : null}
            </div>
          )}

          {(slip.barcodeSvg || slip.qrSvg) && (
            <div className="mt-4 flex items-end justify-between gap-4 border-t border-ink-200 pt-3">
              <div className="flex-1">
                {slip.barcodeSvg ? (
                  <div
                    className="[&>svg]:h-11 [&>svg]:w-auto"
                    // The SVG is generated by this app from the consignment id, never
                    // from user-supplied markup, and contains no script.
                    dangerouslySetInnerHTML={{ __html: slip.barcodeSvg }}
                    aria-label={`বারকোড ${record.consignmentId}`}
                  />
                ) : null}
              </div>
              {slip.qrSvg ? (
                <div
                  className="shrink-0"
                  dangerouslySetInnerHTML={{ __html: slip.qrSvg }}
                  aria-label={`QR ${record.consignmentId}`}
                />
              ) : null}
            </div>
          )}

          <BrandingFooter settings={settings} thankYou={note?.footer || undefined}>
            {record.note ? <p className="whitespace-pre-line">{record.note}</p> : null}
          </BrandingFooter>

          <p className="mt-2 text-center text-[10px] text-ink-400">
            এই স্লিপটি Facebook Seller OS থেকে তৈরি — সব তথ্য আপনার ডিভাইসেই সংরক্ষিত। এটি কোনো
            কুরিয়ার প্রতিষ্ঠানের সরকারি রশিদ নয়।
          </p>
        </div>
      </div>
    );
  },
);
