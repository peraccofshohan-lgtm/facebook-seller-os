import { forwardRef } from 'react';
import { formatDate } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { PAYMENT_STATUS_LABEL } from '@/domain/constants';
import type { Order, Settings } from '@/domain/types';

export interface InvoicePrintProps {
  order: Order;
  settings: Settings | null;
  paidIn: number;
  refunded: number;
}

/**
 * Print-ready invoice. Renders inside the normal React tree (hidden until print) so that
 * Bengali text uses the same font stack the app already loaded — no external font or
 * paid PDF service is required. The browser's own "Save as PDF" produces the PDF.
 */
export const InvoicePrint = forwardRef<HTMLDivElement, InvoicePrintProps>(function InvoicePrint(
  { order, settings, paidIn, refunded },
  ref,
) {
  const business = settings?.business;
  const due = Math.max(order.total - paidIn + refunded, 0);

  return (
    <div className="hidden print:block">
      <div ref={ref} className="print-sheet mx-auto max-w-[800px] bg-white p-6 text-[13px] text-ink-900">
        <header className="flex items-start justify-between gap-6 border-b border-ink-300 pb-4">
          <div className="flex items-start gap-3">
            {settings?.invoice.showLogo && business?.logoDataUrl ? (
              <img src={business.logoDataUrl} alt="লোগো" className="h-14 w-14 rounded object-contain" />
            ) : null}
            <div>
              <h1 className="text-lg font-bold">{business?.name || 'আমার ব্যবসা'}</h1>
              {business?.address && <p className="whitespace-pre-line text-xs text-ink-600">{business.address}</p>}
              <p className="text-xs text-ink-600">
                {[business?.phone, business?.email].filter(Boolean).join(' • ')}
              </p>
              {business?.registrationNote && <p className="text-[11px] text-ink-500">{business.registrationNote}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-base font-bold">ইনভয়েস</p>
            <p className="text-xs">নং: {order.orderNumber}</p>
            <p className="text-xs">তারিখ: {formatDate(order.orderDate)}</p>
            <p className="text-xs">পেমেন্ট: {PAYMENT_STATUS_LABEL[order.paymentStatus] ?? order.paymentStatus}</p>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">কাস্টমার</p>
            <p className="font-medium">{order.customerName || 'নগদ কাস্টমার'}</p>
            {order.customerPhone && <p className="text-xs">ফোন: {order.customerPhone}</p>}
            {order.deliveryAddress && <p className="whitespace-pre-line text-xs">{order.deliveryAddress}</p>}
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">ডেলিভারি</p>
            <p className="text-xs">কুরিয়ার: {order.courierName || '—'}</p>
            <p className="text-xs">কনসাইনমেন্ট: {order.trackingNumber || '—'}</p>
            <p className="text-xs">অর্ডার স্ট্যাটাস: {order.status}</p>
          </div>
        </section>

        <table className="mt-5 w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-ink-300 bg-ink-100/60">
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">পণ্য</th>
              <th className="px-2 py-1.5 text-right">পরিমাণ</th>
              <th className="px-2 py-1.5 text-right">দর</th>
              <th className="px-2 py-1.5 text-right">ছাড়</th>
              <th className="px-2 py-1.5 text-right">মোট</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, index) => (
              <tr key={item.id} className="border-b border-ink-200">
                <td className="px-2 py-1.5">{index + 1}</td>
                <td className="px-2 py-1.5">
                  {item.name}
                  {item.sku ? <span className="block text-[11px] text-ink-500">SKU: {item.sku}</span> : null}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {item.quantity} {item.unit}
                </td>
                <td className="px-2 py-1.5 text-right">{formatMoney(item.unitPrice)}</td>
                <td className="px-2 py-1.5 text-right">{item.discount ? formatMoney(item.discount) : '—'}</td>
                <td className="px-2 py-1.5 text-right font-medium">{formatMoney(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-64 space-y-1 text-[13px]">
            <div className="flex justify-between">
              <dt>সাবটোটাল</dt>
              <dd className="tabular">{formatMoney(order.subtotal)}</dd>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between">
                <dt>ছাড়</dt>
                <dd className="tabular">- {formatMoney(order.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>ডেলিভারি চার্জ</dt>
              <dd className="tabular">{formatMoney(order.deliveryCharge)}</dd>
            </div>
            {order.otherCharge > 0 && (
              <div className="flex justify-between">
                <dt>অন্যান্য চার্জ</dt>
                <dd className="tabular">{formatMoney(order.otherCharge)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-ink-300 pt-1 text-[15px] font-bold">
              <dt>সর্বমোট</dt>
              <dd className="tabular">{formatMoney(order.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>পরিশোধিত</dt>
              <dd className="tabular">{formatMoney(paidIn)}</dd>
            </div>
            {refunded > 0 && (
              <div className="flex justify-between">
                <dt>রিফান্ড</dt>
                <dd className="tabular">{formatMoney(refunded)}</dd>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <dt>বাকি</dt>
              <dd className="tabular">{formatMoney(due)}</dd>
            </div>
          </dl>
        </div>

        {order.customerInstructions && (
          <p className="mt-4 rounded border border-ink-200 p-2 text-xs">
            <span className="font-semibold">কাস্টমারের নির্দেশ: </span>
            {order.customerInstructions}
          </p>
        )}

        <footer className="mt-6 border-t border-ink-300 pt-3 text-[11px] text-ink-600">
          {settings?.invoice.terms && <p className="whitespace-pre-line">{settings.invoice.terms}</p>}
          <p className="mt-1">{settings?.invoice.footerNote}</p>
          <p className="mt-2 text-[10px] text-ink-400">এই ইনভয়েসটি Facebook Seller OS থেকে তৈরি — সব তথ্য আপনার ডিভাইসেই সংরক্ষিত।</p>
        </footer>
      </div>
    </div>
  );
});
