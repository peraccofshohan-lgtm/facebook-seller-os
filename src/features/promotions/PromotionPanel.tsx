/**
 * PromotionPanel.tsx — live promotion preview on the order form (V2).
 *
 * Shows the seller, before they save, exactly which offers will apply, what each one is
 * worth, and — just as importantly — which offers will NOT apply and why. The preview
 * calls the same engine the order service calls, so what is shown is what is charged.
 */

import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { InfoBanner } from '@/components/ui/Feedback';
import { formatMoney } from '@/lib/money';
import { evaluateForBasket } from '@/services/promotionService';
import type { PromotionEvaluation } from '@/finance/promotions';
import { PROMOTION_TYPE_LABEL } from '@/domain/constants';
import type { Minor } from '@/lib/money';

export interface PromotionPanelLine {
  productId: string | null;
  variantId: string | null;
  quantity: number;
  unitPrice: Minor;
  unitCost: Minor;
  lineDiscount: Minor;
  name: string;
  unit: string;
}

export interface PromotionPanelProps {
  lines: PromotionPanelLine[];
  deliveryCharge: Minor;
  otherCharge: Minor;
  customerId: string | null;
  couponCode: string;
  pointsToRedeem: number;
  enabled: boolean;
  loyaltyEnabled: boolean;
  onCouponChange: (value: string) => void;
  onPointsChange: (value: number) => void;
}

export function PromotionPanel({
  lines,
  deliveryCharge,
  otherCharge,
  customerId,
  couponCode,
  pointsToRedeem,
  enabled,
  loyaltyEnabled,
  onCouponChange,
  onPointsChange,
}: PromotionPanelProps) {
  const [evaluation, setEvaluation] = useState<PromotionEvaluation | null>(null);
  // A stable key for the basket: the engine only cares about these numbers.
  const basketKey = JSON.stringify(lines);

  // Re-run whenever anything the engine looks at changes. This is a read-only query, so
  // a stale result is harmless — the service re-evaluates inside the write transaction.
  useEffect(() => {
    if (!enabled) {
      setEvaluation(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const result = await evaluateForBasket({
          lines,
          deliveryCharge,
          otherCharge,
          customerId,
          couponCode,
          pointsToRedeem,
        });
        if (!cancelled) setEvaluation(result);
      } catch {
        if (!cancelled) setEvaluation(null);
      }
    };
    const timer = setTimeout(() => void run(), 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    basketKey,
    deliveryCharge,
    otherCharge,
    customerId,
    couponCode,
    pointsToRedeem,
  ]);

  if (!enabled) return null;

  const applied = evaluation?.applied ?? [];
  const rejected = evaluation?.rejected ?? [];
  const totalDiscount = evaluation?.totalDiscount ?? 0;

  return (
    <Card>
      <CardHeader
        title="অফার ও প্রমোশন"
        subtitle="অর্ডার জমা দেওয়ার আগে কোন অফার প্রযোজ্য হবে তা দেখুন"
      />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="কুপন কোড" hint="কাস্টমার কোড দিলে লিখুন">
            {({ id }) => (
              <Input
                id={id}
                value={couponCode}
                onChange={(event) => onCouponChange(event.target.value)}
                placeholder="যেমন EID20"
                autoComplete="off"
              />
            )}
          </Field>
          {loyaltyEnabled ? (
            <Field label="লয়্যালটি পয়েন্ট খরচ করুন" hint="কাস্টমারের জমা করা পয়েন্ট">
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={pointsToRedeem || ''}
                  onChange={(event) => onPointsChange(Math.max(0, Number(event.target.value) || 0))}
                  placeholder="০"
                />
              )}
            </Field>
          ) : null}
        </div>

        {applied.length > 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold text-emerald-800">প্রযোজ্য অফার</p>
            <ul className="mt-1.5 space-y-1">
              {applied.map((item) => (
                <li key={item.promotionId} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-emerald-900">
                    {item.name}
                    <span className="ml-1 text-[11px] text-emerald-700">
                      ({PROMOTION_TYPE_LABEL[item.type] ?? item.type})
                    </span>
                  </span>
                  <span className="tabular shrink-0 font-semibold text-emerald-900">
                    − {formatMoney(item.itemDiscount + item.orderDiscount + item.deliveryDiscount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2 text-sm font-semibold text-emerald-900">
              <span>মোট ছাড়</span>
              <span className="tabular">− {formatMoney(totalDiscount)}</span>
            </div>
            {evaluation && evaluation.pointsEarned > 0 ? (
              <p className="mt-1 text-[11px] text-emerald-700">
                এই অর্ডারে {evaluation.pointsEarned} পয়েন্ট জমা হবে।
              </p>
            ) : null}
            {evaluation && evaluation.pointsRedeemed > 0 ? (
              <p className="mt-1 text-[11px] text-emerald-700">
                {evaluation.pointsRedeemed} পয়েন্ট ব্যবহার করা হচ্ছে (
                {formatMoney(evaluation.loyaltyDiscount)} ছাড়)।
              </p>
            ) : null}
          </div>
        ) : (
          <InfoBanner>
            {lines.length === 0
              ? 'পণ্য যোগ করলে প্রযোজ্য অফার এখানে দেখা যাবে।'
              : 'এই অর্ডারে কোনো অফার প্রযোজ্য হচ্ছে না।'}
          </InfoBanner>
        )}

        {rejected.length > 0 ? (
          <details className="rounded-lg border border-ink-200 bg-ink-50 p-2.5">
            <summary className="cursor-pointer text-xs font-medium text-ink-600">
              কেন কোনো অফার প্রযোজ্য হলো না ({rejected.length})
            </summary>
            <ul className="mt-1.5 space-y-1 text-[11px] text-ink-500">
              {rejected.map((item) => (
                <li key={item.promotionId}>
                  <span className="font-medium text-ink-700">{item.name}</span> — {item.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}
