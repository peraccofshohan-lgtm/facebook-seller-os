/**
 * ParcelLabel.tsx — the sticky label that goes on the box (V2).
 *
 * Much smaller than the booking slip: a label has to carry everything a sorter needs
 * (who, where, how much to collect) in a space the size of a hand. Bangla address text
 * is kept at a readable size because a misread area name is a failed delivery.
 */

import { forwardRef } from 'react';
import { formatMoney } from '@/lib/money';
import { formatPhone } from '@/lib/search';
import { ALIGN_CLASS } from '@/domain/constants';
import type { Settings } from '@/domain/types';
import type { CourierSlip } from '@/services/courierSlipService';

export interface ParcelLabelProps {
  slip: CourierSlip;
  settings: Settings | null;
  size?: 'small' | 'medium';
  /** Force a page break before this label, for bulk printing. */
  pageBreak?: boolean;
}

export const ParcelLabel = forwardRef<HTMLDivElement, ParcelLabelProps>(function ParcelLabel(
  { slip, settings, size = 'medium', pageBreak = false },
  ref,
) {
  const { record, sender, recipient, money, note } = slip;
  const compact = size === 'small';

  const recipientLine = [recipient.address, recipient.area, recipient.district, recipient.postcode]
    .filter(Boolean)
    .join(', ');
  const senderLine = [sender.address, sender.area, sender.district].filter(Boolean).join(', ');
  const showLogo = settings?.branding?.showLogoOn?.parcelLabel && Boolean(sender.logoDataUrl);

  return (
    <div className={pageBreak ? 'break-before-page' : undefined}>
      <div
        ref={ref}
        className={`print-sheet mx-auto bg-white text-ink-900 ${compact ? 'w-[240px] p-2 text-[10px]' : 'w-[320px] p-3 text-[11px]'}`}
      >
        {(record.fragile || record.handleWithCare) && (
          <div className="mb-1 rounded border-2 border-dashed border-rose-500 px-1 text-center font-bold text-rose-700">
            {record.fragile ? 'ভঙ্গুর / FRAGILE' : null}
            {record.fragile && record.handleWithCare ? ' • ' : null}
            {record.handleWithCare ? 'সাবধানে / HANDLE WITH CARE' : null}
          </div>
        )}

        {/* FROM — the business, so a returned parcel knows where to come back to. */}
        <section className="border-b border-ink-300 pb-1">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-ink-500">প্রেরক / FROM</p>
          <div className="flex items-start gap-1.5">
            {showLogo ? (
              <img src={sender.logoDataUrl ?? ''} alt="" className="mt-0.5 h-6 w-6 shrink-0 object-contain" />
            ) : null}
            <div className="min-w-0">
              <p className="font-semibold leading-tight">{sender.name || '—'}</p>
              {senderLine ? <p className="leading-tight text-ink-600">{senderLine}</p> : null}
              <p className="leading-tight text-ink-600" dir="ltr">
                {[formatPhone(sender.phone), formatPhone(sender.altPhone)].filter(Boolean).join(' • ')}
              </p>
            </div>
          </div>
        </section>

        {/* TO — the customer. The most important block on the label. */}
        <section className="border-b border-ink-300 py-1">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-ink-500">প্রাপক / TO</p>
          <p className={`font-semibold leading-tight ${compact ? 'text-[12px]' : 'text-[14px]'}`}>
            {recipient.name}
          </p>
          <p className="leading-tight" dir="ltr">
            <span className="font-semibold">ফোন: </span>
            <span className={compact ? 'text-[12px]' : 'text-[13px]'}>{formatPhone(recipient.phone) || '—'}</span>
          </p>
          {recipientLine ? <p className="whitespace-pre-line leading-tight">{recipientLine}</p> : null}
        </section>

        <section className="space-y-0.5 py-1">
          <div className="flex justify-between gap-2">
            <span className="text-ink-500">অর্ডার</span>
            <span className="tabular font-medium">{record.orderNumber || '—'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-ink-500">কনসাইনমেন্ট</span>
            <span className="tabular font-medium">{record.consignmentId || '—'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-ink-500">কুরিয়ার</span>
            <span className="font-medium">{slip.providerName || '—'}</span>
          </div>
          <div
            className={`flex justify-between gap-2 rounded px-1 ${
              money.fullyPrepaid ? 'bg-emerald-50' : 'bg-ink-100'
            }`}
          >
            <span className="text-ink-600">{money.fullyPrepaid ? 'অগ্রিম পরিশোধিত' : 'COD আদায়'}</span>
            <span className={`tabular font-bold ${compact ? 'text-[13px]' : 'text-[15px]'}`}>
              {formatMoney(money.codToCollect)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-ink-500">পার্সেল</span>
            <span className="tabular">
              {record.parcelCount || 1} / {slip.contents.length || 1} ধরনের পণ্য
            </span>
          </div>
        </section>

        {note?.body ? (
          <p className={`border-t border-ink-200 pt-1 leading-tight text-ink-600 ${ALIGN_CLASS[note.align]}`}>
            {note.body}
          </p>
        ) : null}

        <div className="flex items-end justify-between gap-2 border-t border-ink-200 pt-1">
          {slip.barcodeSvg ? (
            <div
              className="min-w-0 flex-1 [&>svg]:h-9 [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: slip.barcodeSvg }}
              aria-label={`বারকোড ${record.consignmentId}`}
            />
          ) : null}
          {slip.qrSvg ? (
            <div
              className="shrink-0 [&>svg]:h-12 [&>svg]:w-12"
              dangerouslySetInnerHTML={{ __html: slip.qrSvg }}
              aria-label={`QR ${record.consignmentId}`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});
