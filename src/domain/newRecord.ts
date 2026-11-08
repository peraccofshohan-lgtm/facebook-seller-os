/**
 * newRecord.ts — V2 defaults for the fields that V1 records do not have.
 *
 * Two problems, one file:
 *
 *  1. Every place that builds a NEW record must include the V2 fields, otherwise the
 *     object does not typecheck and a later read of `order.promotionIds` would be
 *     `undefined`. Spreading `...newOrderFields()` makes that impossible to forget.
 *
 *  2. Records written by V1 are missing those same fields because they were saved before
 *     the fields existed. `migrations.ts` backfills them with these very same defaults,
 *     so "a brand-new record" and "a migrated V1 record" are guaranteed to be identical
 *     in shape.
 */

import type {
  CourierRecord,
  Customer,
  Expense,
  Order,
  OrderItem,
} from './types';
import { randomId } from '@/lib/id';

/** V2 fields on an order line. */
export function newOrderItemFields(): Pick<OrderItem, 'isFreeGift' | 'promotionId'> {
  return { isFreeGift: false, promotionId: null };
}

/** V2 fields on an order. */
export function newOrderFields(): Pick<
  Order,
  | 'promotionIds'
  | 'promotionDiscount'
  | 'couponCode'
  | 'loyaltyPointsEarned'
  | 'loyaltyPointsRedeemed'
  | 'loyaltyDiscount'
  | 'referralId'
> {
  return {
    promotionIds: [],
    promotionDiscount: 0,
    couponCode: '',
    loyaltyPointsEarned: 0,
    loyaltyPointsRedeemed: 0,
    loyaltyDiscount: 0,
    referralId: null,
  };
}

/** V2 fields on a customer. */
export function newCustomerFields(referralCode = randomId().slice(0, 8).toUpperCase()): Pick<
  Customer,
  'segment' | 'loyaltyPoints' | 'referralCode' | 'referredByCustomerId'
> {
  return { segment: '', loyaltyPoints: 0, referralCode, referredByCustomerId: null };
}

/** V2 fields on an expense. */
export function newExpenseFields(): Pick<Expense, 'recurringExpenseId'> {
  return { recurringExpenseId: null };
}

/** V2 courier booking-slip / parcel-label fields. */
export function newCourierFields(): Pick<
  CourierRecord,
  | 'parcelCount'
  | 'declaredValue'
  | 'advancePaid'
  | 'fragile'
  | 'handleWithCare'
  | 'specialInstructions'
  | 'sellerNote'
  | 'noteTemplateId'
  | 'recipientName'
  | 'recipientPhone'
  | 'recipientAltPhone'
  | 'recipientAddress'
  | 'area'
  | 'district'
  | 'postcode'
  | 'contentsSummary'
  | 'senderSnapshot'
  | 'lastSlipPrintedAt'
  | 'slipPrintCount'
> {
  return {
    parcelCount: 1,
    declaredValue: 0,
    advancePaid: 0,
    fragile: false,
    handleWithCare: false,
    specialInstructions: '',
    sellerNote: '',
    noteTemplateId: null,
    recipientName: '',
    recipientPhone: '',
    recipientAltPhone: '',
    recipientAddress: '',
    area: '',
    district: '',
    postcode: '',
    contentsSummary: '',
    senderSnapshot: null,
    lastSlipPrintedAt: null,
    slipPrintCount: 0,
  };
}
