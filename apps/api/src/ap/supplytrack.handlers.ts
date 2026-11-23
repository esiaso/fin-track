import { Injectable } from '@nestjs/common';
import { InboxEvent } from '@prisma/client';
import { GoodsReceivedPayload, PurchaseOrderApprovedPayload, SupplierApprovedPayload, SupplierInvoicePayload, d } from '@fintrack/shared';
import { z } from 'zod';
import { Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { canonicalJson, sha256 } from '../common/hash';
import { EventHandler, HandlerResult, NonRetryableError } from '../integration/handlers/handler';
import { ApService } from './ap.service';
import { addDays, dec, s4 } from './ap-common';
import { normalizeInvoiceNumber } from './matching';

function parse<T extends z.ZodTypeAny>(schema: T, ev: InboxEvent): z.infer<T> {
  const r = schema.safeParse(ev.payload);
  if (!r.success) throw new NonRetryableError(`Invalid payload: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}

async function resolveFacility(tx: Tx, ev: InboxEvent, companyCode: string) {
  const f = await tx.facility.findUnique({ where: { externalId: ev.facilityExtId }, include: { company: true } });
  if (!f) throw new NonRetryableError(`Unknown facility ${ev.facilityExtId}`);
  if (f.company.code !== companyCode) throw new NonRetryableError(`Facility ${f.code} does not belong to company ${companyCode}`);
  return f;
}

/** supplytrack.supplier.approved: upsert approved supplier master (no bank details, only an opaque payee reference). */
@Injectable()
export class SupplierApprovedHandler implements EventHandler {
  readonly eventType = 'supplytrack.supplier.approved';
  constructor(private readonly audit: AuditService) {}

  async handle(tx: Tx, ev: InboxEvent): Promise<HandlerResult> {
    const p = parse(SupplierApprovedPayload, ev);
    const f = await resolveFacility(tx, ev, p.company_code);
    const data = { code: p.code, name: p.name, taxPin: p.tax_pin, currency: p.currency, paymentTermsDays: p.payment_terms_days, withholdingRate: p.withholding_rate, payeeRef: p.payee_ref, status: p.status, sourceVersion: ev.sourceVersion };
    const s = await tx.supplier.upsert({
      where: { companyId_sourceSystem_sourceSupplierId: { companyId: f.companyId, sourceSystem: 'SUPPLYTRACK', sourceSupplierId: p.supplier_id } },
      update: data,
      create: { companyId: f.companyId, sourceSystem: 'SUPPLYTRACK', sourceSupplierId: p.supplier_id, ...data },
    });
    await this.audit.record(tx, { action: 'SUPPLIER_UPSERTED', entityType: 'supplier', entityId: s.id, companyId: f.companyId, data: { status: s.status, version: ev.sourceVersion } });
    return { traces: [{ targetType: 'SUPPLIER', targetId: s.id }] };
  }
}

/** supplytrack.po.approved: create or amend a PO. Amendments may not cut quantities below what is already received/invoiced. */
@Injectable()
export class PurchaseOrderApprovedHandler implements EventHandler {
  readonly eventType = 'supplytrack.po.approved';

  async handle(tx: Tx, ev: InboxEvent): Promise<HandlerResult> {
    const p = parse(PurchaseOrderApprovedPayload, ev);
    const f = await resolveFacility(tx, ev, p.company_code);
    const supplier = await tx.supplier.findUnique({ where: { companyId_sourceSystem_sourceSupplierId: { companyId: f.companyId, sourceSystem: 'SUPPLYTRACK', sourceSupplierId: p.supplier_id } } });
    if (!supplier) throw new Error(`Supplier ${p.supplier_id} not yet received; will retry`);

    let po = await tx.purchaseOrder.findUnique({ where: { companyId_sourceId: { companyId: f.companyId, sourceId: ev.sourceEntityId } }, include: { lines: true } });
    if (!po) {
      po = await tx.purchaseOrder.create({
        data: { companyId: f.companyId, facilityId: f.id, supplierId: supplier.id, poNumber: p.po_number, sourceId: ev.sourceEntityId, currency: p.currency, orderDate: new Date(p.order_date), sourceVersion: ev.sourceVersion },
        include: { lines: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM purchase_order_lines WHERE po_id = ${po.id}::uuid ORDER BY id FOR UPDATE`;
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { currency: p.currency, sourceVersion: ev.sourceVersion } });
    }
    const existing = new Map(po.lines.map((l) => [l.lineRef, l]));
    for (const l of p.lines) {
      const cur = existing.get(l.line_ref);
      if (cur) {
        const floor = Decimal_max(dec(cur.qtyReceived), dec(cur.qtyInvoiced));
        if (d(l.qty).lt(floor)) throw new NonRetryableError(`PO line ${l.line_ref}: amended qty ${l.qty} is below received/invoiced ${floor.toFixed(4)}`);
        await tx.purchaseOrderLine.update({ where: { id: cur.id }, data: { qtyOrdered: l.qty, unitPrice: l.unit_price, taxRate: l.tax_rate, description: l.description, expenseKey: l.expense_key, itemRef: l.item_ref } });
        existing.delete(l.line_ref);
      } else {
        await tx.purchaseOrderLine.create({ data: { poId: po.id, lineRef: l.line_ref, itemRef: l.item_ref, description: l.description, qtyOrdered: l.qty, unitPrice: l.unit_price, taxRate: l.tax_rate, expenseKey: l.expense_key } });
      }
    }
    for (const gone of existing.values()) {
      if (dec(gone.qtyReceived).gt(0) || dec(gone.qtyInvoiced).gt(0)) throw new NonRetryableError(`PO line ${gone.lineRef} has activity and cannot be removed`);
    }
    if (existing.size) await tx.purchaseOrderLine.deleteMany({ where: { id: { in: [...existing.values()].map((x) => x.id) } } });
    return { traces: [{ targetType: 'PURCHASE_ORDER', targetId: po.id }] };
  }
}

function Decimal_max(a: ReturnType<typeof d>, b: ReturnType<typeof d>) {
  return a.gt(b) ? a : b;
}

/** supplytrack.grn.accepted: goods received / service accepted. Increments received quantity under row lock. */
@Injectable()
export class GoodsReceivedHandler implements EventHandler {
  readonly eventType = 'supplytrack.grn.accepted';

  async handle(tx: Tx, ev: InboxEvent): Promise<HandlerResult> {
    const p = parse(GoodsReceivedPayload, ev);
    const f = await resolveFacility(tx, ev, p.company_code);
    const po = await tx.purchaseOrder.findUnique({ where: { companyId_poNumber: { companyId: f.companyId, poNumber: p.po_number } } });
    if (!po) throw new Error(`PO ${p.po_number} not yet received; will retry`);
    await tx.$queryRaw`SELECT id FROM purchase_order_lines WHERE po_id = ${po.id}::uuid ORDER BY id FOR UPDATE`;
    const lines = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } });
    const byRef = new Map(lines.map((l) => [l.lineRef, l]));
    const grn = await tx.goodsReceipt.create({ data: { companyId: f.companyId, poId: po.id, grnNumber: p.grn_number, sourceId: ev.sourceEntityId, kind: p.kind, receivedDate: new Date(p.received_date) } });
    for (const l of p.lines) {
      const pol = byRef.get(l.po_line_ref);
      if (!pol) throw new NonRetryableError(`GRN references unknown PO line ${l.po_line_ref}`);
      await tx.goodsReceiptLine.create({ data: { receiptId: grn.id, poLineId: pol.id, qtyAccepted: l.qty_accepted } });
      await tx.purchaseOrderLine.update({ where: { id: pol.id }, data: { qtyReceived: { increment: l.qty_accepted } } });
    }
    return { traces: [{ targetType: 'GOODS_RECEIPT', targetId: grn.id }] };
  }
}

/**
 * supplytrack.invoice.received: supplier invoice or credit note.
 *  - Hard duplicate (same company + supplier + normalised number + kind from a different source document) is rejected
 *    to the dead-letter queue and never posted.
 *  - Soft duplicate (same supplier, date, gross, currency; different number) is accepted into the exception queue.
 *  - One liability per valid invoice: idempotent on (company, source system, source entity id).
 */
@Injectable()
export class SupplierInvoiceHandler implements EventHandler {
  readonly eventType = 'supplytrack.invoice.received';
  constructor(
    private readonly ap: ApService,
    private readonly audit: AuditService,
  ) {}

  async handle(tx: Tx, ev: InboxEvent): Promise<HandlerResult> {
    const p = parse(SupplierInvoicePayload, ev);
    const f = await resolveFacility(tx, ev, p.company_code);
    const supplier = await tx.supplier.findUnique({ where: { companyId_sourceSystem_sourceSupplierId: { companyId: f.companyId, sourceSystem: 'SUPPLYTRACK', sourceSupplierId: p.supplier_id } } });
    if (!supplier) throw new Error(`Supplier ${p.supplier_id} not yet received; will retry`);

    const prior = await tx.apInvoice.findUnique({ where: { companyId_sourceSystem_sourceEntityId: { companyId: f.companyId, sourceSystem: 'SUPPLYTRACK', sourceEntityId: ev.sourceEntityId } } });
    if (prior) {
      if (['POSTED', 'PARTIALLY_SETTLED', 'SETTLED'].includes(prior.status)) {
        throw new NonRetryableError(`Invoice ${prior.invoiceNumber} is already posted; corrections must arrive as a supplier credit note`);
      }
      // Unposted earlier version: replace it (exceptions and lines are rebuilt).
      await tx.matchException.deleteMany({ where: { invoiceId: prior.id } });
      await tx.apInvoiceLine.deleteMany({ where: { invoiceId: prior.id } });
      await tx.apInvoice.delete({ where: { id: prior.id } });
      await this.audit.record(tx, { action: 'AP_INVOICE_SUPERSEDED', entityType: 'ap_invoice', entityId: prior.id, companyId: f.companyId, data: { byVersion: ev.sourceVersion } });
    }

    const normalized = normalizeInvoiceNumber(p.invoice_number);
    const dup = await tx.apInvoice.findUnique({ where: { companyId_supplierId_normalizedNumber_kind: { companyId: f.companyId, supplierId: supplier.id, normalizedNumber: normalized, kind: p.kind } } });
    if (dup) {
      await this.audit.record(tx, { action: 'AP_DUPLICATE_REJECTED', entityType: 'ap_invoice', entityId: dup.id, companyId: f.companyId, data: { invoiceNumber: p.invoice_number, sourceEntityId: ev.sourceEntityId } });
      throw new NonRetryableError(`DUPLICATE_INVOICE: ${supplier.code} ${p.invoice_number} already recorded as ${dup.invoiceNumber} (${dup.id})`);
    }

    let poId: string | null = null;
    let poLines = new Map<string, string>();
    if (p.kind === 'INVOICE' && p.match_type !== 'NON_PO') {
      if (!p.po_number) throw new NonRetryableError('po_number is required for 2-way/3-way matching');
      const po = await tx.purchaseOrder.findUnique({ where: { companyId_poNumber: { companyId: f.companyId, poNumber: p.po_number } }, include: { lines: true } });
      if (!po) throw new Error(`PO ${p.po_number} not yet received; will retry`);
      if (po.supplierId !== supplier.id) throw new NonRetryableError(`PO ${p.po_number} belongs to another supplier`);
      poId = po.id;
      poLines = new Map(po.lines.map((l) => [l.lineRef, l.id]));
    }

    let creditForId: string | null = null;
    if (p.kind === 'CREDIT_NOTE') {
      if (!p.credits_invoice_number) throw new NonRetryableError('credits_invoice_number is required for a credit note');
      const orig = await tx.apInvoice.findUnique({ where: { companyId_supplierId_normalizedNumber_kind: { companyId: f.companyId, supplierId: supplier.id, normalizedNumber: normalizeInvoiceNumber(p.credits_invoice_number), kind: 'INVOICE' } } });
      if (!orig) throw new Error(`Original invoice ${p.credits_invoice_number} not yet received; will retry`);
      creditForId = orig.id;
    }

    const fingerprint = sha256(canonicalJson({ s: supplier.id, d: p.invoice_date, t: d(p.total).toFixed(4), c: p.currency, k: p.kind }));
    const soft = await tx.apInvoice.findFirst({ where: { companyId: f.companyId, supplierId: supplier.id, fingerprint } });
    const invDate = new Date(p.invoice_date);
    const wht = d(p.subtotal).mul(dec(supplier.withholdingRate));

    const inv = await tx.apInvoice.create({
      data: {
        companyId: f.companyId,
        facilityId: f.id,
        supplierId: supplier.id,
        poId,
        kind: p.kind,
        invoiceNumber: p.invoice_number,
        normalizedNumber: normalized,
        fingerprint,
        invoiceDate: invDate,
        dueDate: addDays(invDate, supplier.paymentTermsDays),
        currency: p.currency,
        subtotal: p.subtotal,
        taxAmount: p.tax_amount,
        total: p.total,
        withholdingAmount: p.kind === 'INVOICE' ? s4(wht) : '0',
        retentionAmount: p.retention_amount,
        status: 'VALIDATED',
        // Credit notes are matched against their original invoice, not a PO receipt.
        matchType: p.kind === 'CREDIT_NOTE' ? 'TWO_WAY' : p.match_type,
        creditForId,
        sourceEntityId: ev.sourceEntityId,
        sourceVersion: ev.sourceVersion,
        lines: {
          create: p.lines.map((l, i) => ({
            lineNo: i + 1,
            poLineId: p.kind === 'INVOICE' && l.po_line_ref ? poLines.get(l.po_line_ref) ?? null : null,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unit_price,
            netAmount: s4(d(l.qty).mul(d(l.unit_price))),
            taxAmount: l.tax_amount,
            expenseKey: l.expense_key,
          })),
        },
      },
    });

    const extra: { type: 'DUPLICATE_SUSPECT' | 'SUPPLIER_BLOCKED' | 'TOTAL'; message: string }[] = [];
    if (soft) extra.push({ type: 'DUPLICATE_SUSPECT', message: `Same supplier, date, amount and currency as ${soft.invoiceNumber}` });
    if (supplier.status === 'BLOCKED') extra.push({ type: 'SUPPLIER_BLOCKED', message: `Supplier ${supplier.code} is blocked` });

    if (p.kind === 'CREDIT_NOTE') {
      const orig = await tx.apInvoice.findUniqueOrThrow({ where: { id: creditForId! } });
      const priorCredits = await tx.apInvoice.findMany({ where: { creditForId: orig.id, id: { not: inv.id }, status: { notIn: ['REVERSED'] } } });
      const credited = priorCredits.reduce((a, c) => a.plus(dec(c.total)), d(0));
      if (credited.plus(d(p.total)).gt(dec(orig.total))) extra.push({ type: 'TOTAL', message: `Credits (${credited.plus(d(p.total)).toFixed(2)}) would exceed original invoice ${orig.total.toString()}` });
      // Credit-note header arithmetic is still checked by the matcher via a 2-way run with no PO lines.
      return this.routeCreditNote(tx, inv.id, extra);
    }

    const routed = await this.ap.matchAndRoute(tx, inv.id, extra);
    const traces = [{ targetType: 'AP_INVOICE', targetId: routed.id }];
    if (routed.journalId) traces.push({ targetType: 'JOURNAL', targetId: routed.journalId });
    return { traces };
  }

  private async routeCreditNote(tx: Tx, invoiceId: string, extra: { type: 'DUPLICATE_SUSPECT' | 'SUPPLIER_BLOCKED' | 'TOTAL'; message: string }[]): Promise<HandlerResult> {
    const inv = await tx.apInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
    const net = inv.lines.reduce((a, l) => a.plus(dec(l.netAmount)), d(0));
    const tax = inv.lines.reduce((a, l) => a.plus(dec(l.taxAmount)), d(0));
    if (!net.eq(dec(inv.subtotal)) || !tax.eq(dec(inv.taxAmount)) || !dec(inv.subtotal).plus(dec(inv.taxAmount)).eq(dec(inv.total))) {
      extra.push({ type: 'TOTAL', message: 'Credit note header does not agree with its lines' });
    }
    // Reuse the invoice routing: with no PO the matcher is bypassed, so build the outcome directly.
    const routed = await this.ap.matchAndRoute(tx, invoiceId, extra, { skipMatcher: true });
    const traces = [{ targetType: 'AP_INVOICE', targetId: routed.id }];
    if (routed.journalId) traces.push({ targetType: 'JOURNAL', targetId: routed.journalId });
    return { traces };
  }
}

export const SUPPLYTRACK_HANDLERS = [SupplierApprovedHandler, PurchaseOrderApprovedHandler, GoodsReceivedHandler, SupplierInvoiceHandler];
