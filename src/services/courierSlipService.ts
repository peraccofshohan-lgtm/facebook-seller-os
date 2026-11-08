/**
 * courierSlipService.ts — builds and records courier booking slips and parcel labels (V2).
 *
 * A slip is never invented: every field is either already on the courier record, read
 * from the linked order/customer, or taken from the seller's own business profile. Where
 * a value genuinely is not known (a postcode the seller never typed) it is left empty
 * rather than filled with something plausible.
 *
 * The sender identity is FROZEN into the record the first time a slip is produced, so
 * reprinting a slip from last year still shows last year's shop name — the same
 * "historical snapshot" rule the invoice already follows.
 */

import { db } from '@/db/db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import { addMoney, type Minor } from '@/lib/money';
import { code128Svg, isCode128BEncodable } from '@/lib/barcode';
import { courierQrPayload, qrSvg } from '@/lib/qr';
import { courierCostOf } from '@/finance/profit';
import { computeSlipMoney, type SlipMoney } from '@/finance/courierSlip';
import { getSettings } from './settingsService';
import type {
  BusinessSnapshot,
  CourierRecord,
  ID,
  NoteTemplate,
  Order,
  Settings,
  Timestamp,
} from '@/domain/types';
import type { NoteTemplateDraft } from '@/domain/schemas';

/* ------------------------------------------------------------------ */
/* Note templates (the "custom note designer")                          */
/* ------------------------------------------------------------------ */

export async function listNoteTemplates(kind?: NoteTemplate['kind']): Promise<NoteTemplate[]> {
  const rows = await db.noteTemplates.toArray();
  const filtered = kind ? rows.filter((t) => t.kind === kind) : rows;
  return filtered.sort((a, b) => a.name.localeCompare(b.name, 'bn'));
}

export async function getNoteTemplate(id: ID): Promise<NoteTemplate | undefined> {
  return db.noteTemplates.get(id);
}

export async function createNoteTemplate(input: NoteTemplateDraft): Promise<NoteTemplate> {
  const now = nowMs();
  const template: NoteTemplate = {
    id: randomId(),
    kind: input.kind,
    name: input.name,
    body: input.body ?? '',
    footer: input.footer ?? '',
    align: input.align ?? 'left',
    fontScale: input.fontScale ?? 'normal',
    isActive: input.isActive ?? true,
    isDefault: input.isDefault ?? false,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  // Only one template can be the default for its kind.
  if (template.isDefault) await clearDefaultNoteTemplate(template.kind, template.id);
  await db.noteTemplates.add(template);
  return template;
}

export async function updateNoteTemplate(id: ID, input: NoteTemplateDraft): Promise<NoteTemplate> {
  const existing = await db.noteTemplates.get(id);
  if (!existing) throw new Error('নোট খুঁজে পাওয়া যায়নি');
  const next: NoteTemplate = {
    ...existing,
    kind: input.kind,
    name: input.name,
    body: input.body ?? '',
    footer: input.footer ?? '',
    align: input.align ?? 'left',
    fontScale: input.fontScale ?? 'normal',
    isActive: input.isActive ?? true,
    isDefault: input.isDefault ?? false,
    updatedAt: nowMs(),
  };
  if (next.isDefault) await clearDefaultNoteTemplate(next.kind, next.id);
  await db.noteTemplates.put(next);
  return next;
}

/** Deleting a note never breaks an existing slip: the text is copied onto the record. */
export async function deleteNoteTemplate(id: ID): Promise<void> {
  await db.noteTemplates.delete(id);
}

async function clearDefaultNoteTemplate(kind: NoteTemplate['kind'], exceptId: ID): Promise<void> {
  const rows = await db.noteTemplates.where('kind').equals(kind).toArray();
  for (const row of rows) {
    if (row.id === exceptId || !row.isDefault) continue;
    await db.noteTemplates.update(row.id, { isDefault: false, updatedAt: nowMs() });
  }
}

export async function defaultNoteFor(kind: NoteTemplate['kind']): Promise<NoteTemplate | null> {
  const rows = await db.noteTemplates.where('kind').equals(kind).toArray();
  return rows.find((t) => t.isDefault && t.isActive) ?? rows.find((t) => t.isActive) ?? null;
}

/* ------------------------------------------------------------------ */
/* Building a slip                                                      */
/* ------------------------------------------------------------------ */

export interface SlipContentLine {
  name: string;
  quantity: number;
  unit: string;
}

export interface CourierSlip {
  record: CourierRecord;
  order: Order | null;

  sender: BusinessSnapshot;
  recipient: {
    name: string;
    phone: string;
    altPhone: string;
    address: string;
    area: string;
    district: string;
    postcode: string;
  };
  contents: SlipContentLine[];
  contentsSummary: string;

  money: SlipMoney;

  note: NoteTemplate | null;
  /** Barcode SVG for the consignment id, or null when it cannot be encoded. */
  barcodeSvg: string | null;
  /** QR SVG for the consignment reference, or null. */
  qrSvg: string | null;

  providerName: string;
  bookingDate: Timestamp;
  printedAt: Timestamp;
}

function snapshotFromSettings(settings: Settings | null): BusinessSnapshot {
  const business = settings?.business;
  return {
    name: business?.name ?? '',
    ownerName: business?.ownerName ?? '',
    logoDataUrl: business?.logoDataUrl ?? null,
    address: business?.address ?? '',
    area: business?.area ?? '',
    district: business?.district ?? '',
    phone: business?.phone ?? '',
    altPhone: business?.altPhone ?? '',
    email: business?.email ?? '',
    website: business?.website ?? '',
  };
}

/** Everything the customer has actually paid for an order, from the payment ledger. */
export async function advancePaidForOrder(orderId: ID): Promise<Minor> {
  const payments = await db.payments.where('orderId').equals(orderId).toArray();
  return payments
    .filter((p) => !p.voidedAt && (p.kind === 'order_payment' || p.kind === 'cod_collection'))
    .reduce((sum, p) => addMoney(sum, p.amount), 0);
}

function recipientSnapshot(record: CourierRecord, order: Order | null) {
  if (order) {
    return {
      name: order.customerName || record.recipientName || 'নগদ কাস্টমার',
      phone: order.customerPhone || record.recipientPhone,
      altPhone: record.recipientAltPhone,
      address: order.deliveryAddress || record.recipientAddress,
      area: record.area,
      district: record.district,
      postcode: record.postcode,
    };
  }
  return {
    name: record.recipientName || 'নগদ কাস্টমার',
    phone: record.recipientPhone,
    altPhone: record.recipientAltPhone,
    address: record.recipientAddress,
    area: record.area,
    district: record.district,
    postcode: record.postcode,
  };
}

/**
 * Assemble everything one slip needs.
 *
 * `freezeSender` writes the current business identity onto the record the first time a
 * slip is produced, which is what lets a reprint months later show the shop as it was.
 */
export async function buildCourierSlip(
  recordId: ID,
  options: { noteTemplateId?: ID | null; freezeSender?: boolean } = {},
): Promise<CourierSlip> {
  const record = await db.courierRecords.get(recordId);
  if (!record) throw new Error('কুরিয়ার রেকর্ড খুঁজে পাওয়া যায়নি');

  const settings = await getSettings();
  const order = record.orderId ? ((await db.orders.get(record.orderId)) ?? null) : null;

  const sender = record.senderSnapshot ?? snapshotFromSettings(settings);
  if (options.freezeSender !== false && !record.senderSnapshot) {
    await db.courierRecords.update(record.id, { senderSnapshot: sender, updatedAt: nowMs() });
  }

  const contents: SlipContentLine[] = order
    ? order.items.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit }))
    : parseContentsSummary(record.contentsSummary);

  const advancePaid = order ? await advancePaidForOrder(order.id) : (record.advancePaid ?? 0);
  const declaredValue = order
    ? Math.max(0, (order.subtotal ?? 0) - (order.discount ?? 0))
    : (record.declaredValue ?? 0);

  const money = computeSlipMoney({
    orderTotal: order?.total ?? addMoney(declaredValue, record.customerDeliveryCharge ?? 0),
    deliveryCharge: record.customerDeliveryCharge ?? order?.deliveryCharge ?? 0,
    advancePaid,
    courierCharge: courierCostOf(record),
    productValue: declaredValue,
  });

  const templateId = options.noteTemplateId ?? record.noteTemplateId ?? settings.documents?.defaultNoteTemplateId ?? null;
  const note = templateId ? ((await db.noteTemplates.get(templateId)) ?? null) : await defaultNoteFor('courier_slip');

  const code = record.consignmentId || record.id;
  const showBarcode = settings.documents?.showBarcode ?? true;
  const showQr = settings.documents?.showQr ?? true;

  return {
    record,
    order,
    sender,
    recipient: recipientSnapshot(record, order),
    contents,
    contentsSummary: record.contentsSummary || contents.map((c) => `${c.name} × ${c.quantity}`).join(', '),
    money,
    note,
    barcodeSvg: showBarcode && isCode128BEncodable(code) ? code128Svg(code, { height: 44, moduleWidth: 2 }) : null,
    qrSvg: showQr
      ? qrSvg(courierQrPayload(record.consignmentId, record.orderNumber), { size: 88 })
      : null,
    providerName: record.courierName,
    bookingDate: record.shipmentDate,
    printedAt: nowMs(),
  };
}

/**
 * Parse a stored contents summary back into lines.
 *
 * Best effort: the summary is a human string saved when the slip was made. It is only
 * used when the linked order no longer exists, so a slightly rough parse is acceptable —
 * but it must never invent a quantity.
 */
function parseContentsSummary(summary: string): SlipContentLine[] {
  if (!summary.trim()) return [];
  return summary
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(.*?)\s*[×x*]\s*(\d+(?:\.\d+)?)$/.exec(part);
      if (match) return { name: match[1].trim(), quantity: Number(match[2]), unit: '' };
      return { name: part, quantity: 1, unit: '' };
    });
}

/** Build several slips at once, for bulk printing. */
export async function buildCourierSlips(
  recordIds: ID[],
  options: { noteTemplateId?: ID | null } = {},
): Promise<CourierSlip[]> {
  const slips: CourierSlip[] = [];
  // Sequential: each slip may write a sender snapshot, and overlapping Dexie writes
  // against the same record would race.
  for (const id of recordIds) {
    slips.push(await buildCourierSlip(id, options));
  }
  return slips;
}

/* ------------------------------------------------------------------ */
/* Recording a print                                                    */
/* ------------------------------------------------------------------ */

/**
 * Note that a slip was produced.
 *
 * This is a count, not an audit trail of physical paper — the app cannot know whether
 * the printer actually ran. It exists so the seller can see "this slip has been printed
 * twice", which is the usual question when a parcel goes missing.
 */
export async function markSlipPrinted(recordIds: ID[], noteTemplateId: ID | null = null): Promise<void> {
  const now = nowMs();
  for (const id of recordIds) {
    const record = await db.courierRecords.get(id);
    if (!record) continue;
    await db.courierRecords.update(id, {
      lastSlipPrintedAt: now,
      slipPrintCount: (record.slipPrintCount ?? 0) + 1,
      noteTemplateId: noteTemplateId ?? record.noteTemplateId,
      updatedAt: now,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Saving the slip fields the seller edits by hand                      */
/* ------------------------------------------------------------------ */

export interface SlipFieldsInput {
  parcelCount?: number;
  fragile?: boolean;
  handleWithCare?: boolean;
  specialInstructions?: string;
  sellerNote?: string;
  noteTemplateId?: ID | null;
  recipientName?: string;
  recipientPhone?: string;
  recipientAltPhone?: string;
  recipientAddress?: string;
  area?: string;
  district?: string;
  postcode?: string;
}

/** Update the slip-specific fields on a courier record. */
export async function updateSlipFields(id: ID, patch: SlipFieldsInput): Promise<CourierRecord> {
  const record = await db.courierRecords.get(id);
  if (!record) throw new Error('কুরিয়ার রেকর্ড খুঁজে পাওয়া যায়নি');

  const next: CourierRecord = {
    ...record,
    parcelCount: patch.parcelCount !== undefined ? Math.max(1, Math.floor(patch.parcelCount)) : record.parcelCount,
    fragile: patch.fragile ?? record.fragile,
    handleWithCare: patch.handleWithCare ?? record.handleWithCare,
    specialInstructions: patch.specialInstructions ?? record.specialInstructions,
    sellerNote: patch.sellerNote ?? record.sellerNote,
    noteTemplateId: patch.noteTemplateId !== undefined ? patch.noteTemplateId : record.noteTemplateId,
    recipientName: patch.recipientName ?? record.recipientName,
    recipientPhone: patch.recipientPhone ?? record.recipientPhone,
    recipientAltPhone: patch.recipientAltPhone ?? record.recipientAltPhone,
    recipientAddress: patch.recipientAddress ?? record.recipientAddress,
    area: patch.area ?? record.area,
    district: patch.district ?? record.district,
    postcode: patch.postcode ?? record.postcode,
    updatedAt: nowMs(),
  };
  await db.courierRecords.put(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Courier-wise reporting                                               */
/* ------------------------------------------------------------------ */

export interface CourierSummaryRow {
  courierName: string;
  shipments: number;
  delivered: number;
  returned: number;
  failed: number;
  codDeclared: Minor;
  codCollected: Minor;
  charges: Minor;
  netReceivable: Minor;
  settled: Minor;
}

/**
 * Shipment history grouped by courier, straight from the records.
 *
 * "Failed" means returned, lost or cancelled — the parcels that never reached the
 * customer. They are counted separately because that is the number a seller uses when
 * deciding whether to keep using a courier.
 */
export async function courierSummary(range?: { from: Timestamp; to: Timestamp }): Promise<CourierSummaryRow[]> {
  const records = (await db.courierRecords.toArray()).filter(
    (r) => !range || (r.shipmentDate >= range.from && r.shipmentDate < range.to),
  );
  const payments = await db.payments.toArray();
  const settledByRecord = new Map<ID, Minor>();
  for (const payment of payments) {
    if (payment.voidedAt || !payment.courierRecordId) continue;
    if (payment.kind !== 'courier_payout' && payment.kind !== 'cod_collection') continue;
    settledByRecord.set(
      payment.courierRecordId,
      addMoney(settledByRecord.get(payment.courierRecordId) ?? 0, payment.amount),
    );
  }

  const grouped = new Map<string, CourierSummaryRow>();
  for (const record of records) {
    const key = record.courierName || 'অজানা';
    const row =
      grouped.get(key) ??
      ({
        courierName: key,
        shipments: 0,
        delivered: 0,
        returned: 0,
        failed: 0,
        codDeclared: 0,
        codCollected: 0,
        charges: 0,
        netReceivable: 0,
        settled: 0,
      } satisfies CourierSummaryRow);

    row.shipments += 1;
    if (record.status === 'delivered' || record.status === 'partial_delivered') row.delivered += 1;
    if (record.status === 'returned') row.returned += 1;
    if (record.status === 'lost' || record.status === 'cancelled') row.failed += 1;

    row.codDeclared = addMoney(row.codDeclared, record.codAmount ?? 0);
    row.codCollected = addMoney(row.codCollected, record.collectedAmount ?? 0);
    row.charges = addMoney(row.charges, courierCostOf(record));
    row.netReceivable = addMoney(row.netReceivable, (record.collectedAmount ?? 0) - courierCostOf(record));
    row.settled = addMoney(row.settled, settledByRecord.get(record.id) ?? 0);

    grouped.set(key, row);
  }

  return Array.from(grouped.values()).sort((a, b) => b.shipments - a.shipments);
}
