/**
 * courierSlip.ts — the money printed on a courier booking slip (V2).
 *
 * Pure arithmetic, integer paisa, no database. The rule that matters:
 *
 *   COD to collect = what the customer still owes, not what the order was worth.
 *
 * If a customer already paid 500 taka in advance, the courier must collect the REMAINING
 * 960, not the full 1,460 — otherwise a shop that took a bKash advance would have its
 * customer charged twice. Everything here is clamped at zero, because a courier cannot
 * collect a negative amount.
 */

import { addMoney, subMoney, type Minor } from '@/lib/money';

export interface SlipMoneyInput {
  /** What the customer is being charged in total for the goods. */
  orderTotal: Minor;
  /** Delivery charge the customer pays (already inside `orderTotal`). */
  deliveryCharge: Minor;
  /** Everything the customer has already paid, from real payment records. */
  advancePaid: Minor;
  /** What the courier charges the BUSINESS for this parcel. */
  courierCharge: Minor;
  /** Value of the goods for insurance/declaration purposes (excludes delivery). */
  productValue: Minor;
}

export interface SlipMoney {
  /** Declared value of the goods. */
  productValue: Minor;
  /** Delivery charge billed to the customer. */
  deliveryCharge: Minor;
  /** Already collected from the customer before shipment. */
  advancePaid: Minor;
  /** What the courier must collect on delivery. Never negative. */
  codToCollect: Minor;
  /** What the courier charges the business. */
  courierCharge: Minor;
  /** The customer's total, for reference on the slip. */
  orderTotal: Minor;
  /** True when the customer has already paid in full — nothing left to collect. */
  fullyPrepaid: boolean;
}

export function computeSlipMoney(input: SlipMoneyInput): SlipMoney {
  const orderTotal = input.orderTotal ?? 0;
  const advancePaid = input.advancePaid ?? 0;

  // Anything already paid comes straight off what the courier is asked to collect.
  const remaining = subMoney(orderTotal, advancePaid);
  const codToCollect = remaining > 0 ? remaining : 0;

  return {
    productValue: input.productValue ?? 0,
    deliveryCharge: input.deliveryCharge ?? 0,
    advancePaid,
    codToCollect,
    courierCharge: input.courierCharge ?? 0,
    orderTotal,
    fullyPrepaid: codToCollect === 0 && orderTotal > 0,
  };
}

/**
 * What the business should ultimately receive from the courier for a parcel:
 * the collected COD minus the courier's own charges.
 */
export function slipNetReceivable(money: SlipMoney): Minor {
  return subMoney(money.codToCollect, money.courierCharge);
}

/** A one-line Bengali summary used on the slip and in the print preview. */
export function describeSlipMoney(money: SlipMoney): string {
  if (money.fullyPrepaid) return 'অগ্রিম পরিশোধিত — কুরিয়ারকে কিছু আদায় করতে হবে না';
  return `কুরিয়ার ${money.codToCollect / 100} টাকা আদায় করবে`;
}

/** Total COD across several slips, for the bulk-print cover sheet. */
export function totalCodToCollect(items: SlipMoney[]): Minor {
  return items.reduce((sum, item) => addMoney(sum, item.codToCollect), 0);
}
