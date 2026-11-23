import { Injectable } from '@nestjs/common';
import { ApInvoice, ApInvoiceLine, MatchException, Prisma } from '@prisma/client';
import { d, Decimal, Permission } from '@fintrack/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { JournalsService, LineInput } from '../ledger/journals.service';
import { DomainError, NotFound } from '../common/errors';
import { SYSTEM_ACTOR_ID } from '../common/system-actor';
import { AuthUser } from '../auth/auth.types';
import { assertScope } from '../auth/scope';
import { matchInvoice, Tolerances } from './matching';
import { assertApprovalLimit, dec, iso, lockInvoices, resolveAccounts, s4 } from './ap-common';

type InvoiceFull = ApInvoice & { lines: ApInvoiceLine[]; exceptions: MatchException[] };

export const DEFAULT_TOLERANCES: Tolerances = { qtyPct: '0', pricePct: '0.02', priceAbs: '500', taxAbs: '1' };

/**
 * Accounts payable sub-ledger: matching, exception routing, approval, posting, holds/disputes,
 * credit-note application, ageing and supplier statements. Payment runs live in PaymentsService.
 */
@Injectable()
export class ApService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: JournalsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async tolerances(tx: Tx, companyId: string): Promise<Tolerances & { autoPostMatched: boolean }> {
    const t = await tx.apTolerance.findUnique({ where: { companyId } });
    if (!t) return { ...DEFAULT_TOLERANCES, autoPostMatched: true };
    return { qtyPct: t.qtyPct.toString(), pricePct: t.pricePct.toString(), priceAbs: t.priceAbs.toString(), taxAbs: t.taxAbs.toString(), autoPostMatched: t.autoPostMatched };
  }

  /**
   * Run matching for a freshly ingested (VALIDATED, PENDING) invoice. Matched invoices consume PO quantity and,
   * if configured, are system-approved and posted. Anything else lands in the exception queue; nothing is posted silently.
   */
  async matchAndRoute(
    tx: Tx,
    invoiceId: string,
    extraIssues: { type: MatchException['type']; message: string }[] = [],
    opts: { skipMatcher?: boolean } = {},
  ): Promise<InvoiceFull> {
    const inv = await tx.apInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    const tol = await this.tolerances(tx, inv.companyId);
    if (opts.skipMatcher) return this.route(tx, inv, extraIssues.map((e) => ({ lineNo: null, type: e.type, message: e.message })), tol.autoPostMatched);

    let po: { currency: string; lines: { id: string; lineRef: string; qtyOrdered: string; unitPrice: string; taxRate: string; qtyReceived: string; qtyInvoiced: string }[] } | null = null;
    if (inv.poId) {
      // Lock PO lines: concurrent invoices against the same PO must not both consume the same received quantity.
      await tx.$queryRaw`SELECT id FROM purchase_order_lines WHERE po_id = ${inv.poId}::uuid ORDER BY id FOR UPDATE`;
      const p = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: inv.poId }, include: { lines: true } });
      po = {
        currency: p.currency,
        lines: p.lines.map((l) => ({ id: l.id, lineRef: l.lineRef, qtyOrdered: l.qtyOrdered.toString(), unitPrice: l.unitPrice.toString(), taxRate: l.taxRate.toString(), qtyReceived: l.qtyReceived.toString(), qtyInvoiced: l.qtyInvoiced.toString() })),
      };
    }
    const refById = new Map(po?.lines.map((l) => [l.id, l.lineRef]) ?? []);
    const result = matchInvoice(
      inv.matchType,
      { currency: inv.currency, subtotal: inv.subtotal.toString(), taxAmount: inv.taxAmount.toString(), total: inv.total.toString() },
      inv.lines.map((l) => ({ lineNo: l.lineNo, poLineRef: l.poLineId ? refById.get(l.poLineId) : undefined, qty: l.qty.toString(), unitPrice: l.unitPrice.toString(), taxAmount: l.taxAmount.toString() })),
      po,
      tol,
    );

    const issues = [...result.issues.map((i) => ({ ...i })), ...extraIssues.map((e) => ({ lineNo: null, type: e.type, message: e.message }))];
    return this.route(tx, inv, issues, tol.autoPostMatched);
  }

  private async route(
    tx: Tx,
    inv: ApInvoice & { lines: ApInvoiceLine[] },
    issues: { lineNo: number | null; type: string; message: string; expected?: string; actual?: string }[],
    autoPost: boolean,
  ): Promise<InvoiceFull> {
    const invoiceId = inv.id;
    if (issues.length) {
      await tx.matchException.createMany({
        data: issues.map((i) => ({ invoiceId, lineNo: i.lineNo, type: i.type as MatchException['type'], message: i.message, expected: i.expected ?? null, actual: i.actual ?? null })),
      });
      await tx.apInvoice.update({ where: { id: invoiceId }, data: { matchStatus: 'EXCEPTION', status: 'VALIDATED' } });
      await this.audit.record(tx, { action: 'AP_INVOICE_EXCEPTION', entityType: 'ap_invoice', entityId: invoiceId, companyId: inv.companyId, data: { types: issues.map((i) => i.type) } });
      await this.outbox.add(tx, { aggregateType: 'ap_invoice', aggregateId: invoiceId, eventType: 'fintrack.ap_invoice.exception', payload: { invoiceId, sourceEntityId: inv.sourceEntityId, types: issues.map((i) => i.type) } });
      return this.load(tx, invoiceId);
    }

    await this.consumePoQuantities(tx, inv.lines);
    await tx.apInvoice.update({ where: { id: invoiceId }, data: { matchStatus: 'MATCHED', status: 'VALIDATED' } });
    if (autoPost) await this.approveAndPost(tx, invoiceId, SYSTEM_ACTOR_ID);
    return this.load(tx, invoiceId);
  }

  private async consumePoQuantities(tx: Tx, lines: ApInvoiceLine[]) {
    for (const l of lines) {
      if (l.poLineId) await tx.purchaseOrderLine.update({ where: { id: l.poLineId }, data: { qtyInvoiced: { increment: l.qty } } });
    }
  }

  // ───────────── exception workflow ─────────────

  async overrideException(user: AuthUser, exceptionId: string, note: string) {
    return this.prisma.tx(async (tx) => {
      const ex = await tx.matchException.findUnique({ where: { id: exceptionId }, include: { invoice: { include: { lines: true } } } });
      if (!ex) throw NotFound('Exception', exceptionId);
      assertScope(user, Permission.AP_APPROVE, ex.invoice.companyId, ex.invoice.facilityId);
      await lockInvoices(tx, [ex.invoiceId]);
      if (ex.status !== 'OPEN') throw new DomainError('INVALID_STATUS', `Exception is ${ex.status}`, 409);
      if (ex.type === 'SUPPLIER_BLOCKED') throw new DomainError('SUPPLIER_BLOCKED', 'Unblock the supplier in SupplyTrack; this exception cannot be overridden', 409);
      if (ex.type === 'NON_PO_APPROVAL' && ex.invoice.lines.some((l) => !l.expenseKey)) {
        throw new DomainError('EXPENSE_CODING_REQUIRED', 'Non-PO invoices need an expense code on every line before approval');
      }
      await tx.matchException.update({ where: { id: exceptionId }, data: { status: 'OVERRIDDEN', resolvedBy: user.id, resolvedAt: new Date(), note } });
      const open = await tx.matchException.count({ where: { invoiceId: ex.invoiceId, status: 'OPEN' } });
      if (open === 0) await tx.apInvoice.update({ where: { id: ex.invoiceId }, data: { matchStatus: 'OVERRIDDEN' } });
      await this.audit.record(tx, { actorId: user.id, action: 'AP_EXCEPTION_OVERRIDDEN', entityType: 'ap_invoice', entityId: ex.invoiceId, companyId: ex.invoice.companyId, data: { exceptionId, type: ex.type, note } });
      return tx.matchException.findUniqueOrThrow({ where: { id: exceptionId } });
    });
  }

  /** Human approval of an invoice whose exceptions were overridden (maker-checker: overrider != approver). */
  async approve(user: AuthUser, invoiceId: string) {
    return this.prisma.tx(async (tx) => {
      await lockInvoices(tx, [invoiceId]);
      const inv = await this.load(tx, invoiceId);
      assertScope(user, Permission.AP_APPROVE, inv.companyId, inv.facilityId);
      if (inv.status !== 'VALIDATED') throw new DomainError('INVALID_STATUS', `Invoice is ${inv.status}`, 409);
      if (inv.controlState !== 'NONE') throw new DomainError('ON_HOLD', `Invoice is ${inv.controlState}`, 409);
      if (inv.matchStatus !== 'MATCHED' && inv.matchStatus !== 'OVERRIDDEN') throw new DomainError('UNRESOLVED_EXCEPTIONS', 'Resolve or override all match exceptions first', 409);
      if (inv.exceptions.some((e) => e.resolvedBy === user.id)) throw new DomainError('SOD_VIOLATION', 'The person who overrode an exception cannot approve the invoice', 403);
      await assertApprovalLimit(tx, user, inv.companyId, 'AP_INVOICE', dec(inv.total));
      if (inv.matchStatus === 'OVERRIDDEN') await this.consumePoQuantities(tx, inv.lines);
      return this.approveAndPost(tx, invoiceId, user.id);
    });
  }

  private async approveAndPost(tx: Tx, invoiceId: string, actorId: string): Promise<InvoiceFull> {
    const now = new Date();
    await tx.apInvoice.update({ where: { id: invoiceId }, data: { status: 'APPROVED', approvedBy: actorId, approvedAt: now } });
    const inv = await this.load(tx, invoiceId);
    const journalId = await this.postInvoiceJournal(tx, inv, actorId);
    await tx.apInvoice.update({ where: { id: invoiceId }, data: { status: 'POSTED', postedAt: now, journalId } });
    await this.audit.record(tx, { actorId, action: 'AP_INVOICE_POSTED', entityType: 'ap_invoice', entityId: invoiceId, companyId: inv.companyId, data: { journalId, total: inv.total.toString() } });
    await this.outbox.add(tx, { aggregateType: 'ap_invoice', aggregateId: invoiceId, eventType: 'fintrack.ap_invoice.posted', payload: { invoiceId, sourceEntityId: inv.sourceEntityId, journalId } });
    if (inv.kind === 'CREDIT_NOTE' && inv.creditForId) await this.applyCreditNote(tx, invoiceId, actorId);
    return this.load(tx, invoiceId);
  }

  /**
   * Invoice: DR expense per line (net), DR VAT input (tax), CR AP control (gross).
   * Credit note: the mirror image. Withholding is recognised at payment (A-AP-03).
   */
  private async postInvoiceJournal(tx: Tx, inv: InvoiceFull, actorId: string): Promise<string> {
    const poLineKeys = new Map<string, string | null>();
    const poLineIds = inv.lines.map((l) => l.poLineId).filter((x): x is string => !!x);
    if (poLineIds.length) {
      (await tx.purchaseOrderLine.findMany({ where: { id: { in: poLineIds } } })).forEach((p) => poLineKeys.set(p.id, p.expenseKey));
    }
    const expenseKey = (l: ApInvoiceLine) => l.expenseKey ?? (l.poLineId ? poLineKeys.get(l.poLineId) : null) ?? 'AP_EXPENSE:DEFAULT';
    const keys = ['AP_CONTROL', 'VAT_INPUT', ...inv.lines.map(expenseKey)];
    const acct = await resolveAccounts(tx, inv.companyId, keys);
    const credit = inv.kind === 'CREDIT_NOTE';
    const side = (amount: Decimal, debit: boolean) => (debit !== credit ? { debit: s4(amount), credit: '0' } : { debit: '0', credit: s4(amount) });
    const dims = { supplier_id: inv.supplierId, ap_invoice_id: inv.id, invoice_number: inv.invoiceNumber };

    const lines: LineInput[] = inv.lines
      .filter((l) => dec(l.netAmount).gt(0))
      .map((l) => ({ accountId: acct.get(expenseKey(l))!, currency: inv.currency, ...side(dec(l.netAmount), true), facilityId: inv.facilityId, description: l.description, dimensions: { ...dims, line_no: l.lineNo } }));
    if (dec(inv.taxAmount).gt(0)) lines.push({ accountId: acct.get('VAT_INPUT')!, currency: inv.currency, ...side(dec(inv.taxAmount), true), facilityId: inv.facilityId, description: 'Input VAT', dimensions: dims });
    lines.push({ accountId: acct.get('AP_CONTROL')!, currency: inv.currency, ...side(dec(inv.total), false), facilityId: inv.facilityId, description: `${credit ? 'Credit note' : 'Invoice'} ${inv.invoiceNumber}`, dimensions: dims });

    const { journal } = await this.journals.postSystemJournal(tx, actorId, {
      companyId: inv.companyId,
      facilityId: inv.facilityId,
      journalDate: iso(inv.invoiceDate),
      description: `AP ${credit ? 'credit note' : 'invoice'} ${inv.invoiceNumber}`,
      idempotencyKey: `AP_INVOICE:${inv.id}`,
      source: 'SUPPLYTRACK',
      sourceEntityType: inv.kind === 'CREDIT_NOTE' ? 'supplier_credit_note' : 'supplier_invoice',
      sourceEntityId: inv.sourceEntityId,
      sourceVersion: inv.sourceVersion,
      lines,
    });
    return journal.id;
  }

  /** Apply a posted credit note to its original invoice, up to the amount still open and not already scheduled for payment. */
  private async applyCreditNote(tx: Tx, creditNoteId: string, actorId: string) {
    const cn = await tx.apInvoice.findUniqueOrThrow({ where: { id: creditNoteId } });
    await lockInvoices(tx, [cn.id, cn.creditForId!]);
    const orig = await tx.apInvoice.findUniqueOrThrow({ where: { id: cn.creditForId! } });
    const scheduled = await this.scheduledAmount(tx, orig.id);
    const available = dec(orig.total).minus(dec(orig.amountSettled)).minus(scheduled);
    const apply = Decimal.min(dec(cn.total).minus(dec(cn.amountSettled)), available);
    if (apply.lte(0)) return; // stays as an unapplied supplier credit
    await tx.apAllocation.create({ data: { invoiceId: orig.id, sourceType: 'CREDIT_NOTE', sourceId: cn.id, amount: s4(apply), createdBy: actorId } });
    await this.bumpSettlement(tx, orig.id, apply);
    await this.bumpSettlement(tx, cn.id, apply);
    await this.audit.record(tx, { actorId, action: 'AP_CREDIT_APPLIED', entityType: 'ap_invoice', entityId: orig.id, companyId: orig.companyId, data: { creditNoteId: cn.id, amount: s4(apply) } });
  }

  /** Adjust settled amount and derive settlement status. DB CHECK guarantees 0 <= settled <= total. */
  async bumpSettlement(tx: Tx, invoiceId: string, delta: Decimal) {
    const inv = await tx.apInvoice.update({ where: { id: invoiceId }, data: { amountSettled: { increment: s4(delta) } } });
    const settled = dec(inv.amountSettled);
    const status = settled.isZero() ? 'POSTED' : settled.gte(dec(inv.total)) ? 'SETTLED' : 'PARTIALLY_SETTLED';
    if (status !== inv.status) await tx.apInvoice.update({ where: { id: invoiceId }, data: { status } });
  }

  async scheduledAmount(tx: Tx, invoiceId: string): Promise<Decimal> {
    const rows = await tx.paymentRunItem.findMany({ where: { invoiceId, status: 'PENDING', run: { status: { in: ['DRAFT', 'APPROVED', 'EXECUTING'] } } } });
    return rows.reduce((acc, r) => acc.plus(dec(r.amount)), d(0));
  }

  // ───────────── holds & disputes ─────────────

  async setControl(user: AuthUser, invoiceId: string, state: 'NONE' | 'DISPUTED' | 'ON_HOLD', reason: string) {
    return this.prisma.tx(async (tx) => {
      await lockInvoices(tx, [invoiceId]);
      const inv = await tx.apInvoice.findUnique({ where: { id: invoiceId } });
      if (!inv) throw NotFound('AP invoice', invoiceId);
      assertScope(user, state === 'NONE' ? Permission.AP_APPROVE : Permission.AP_MANAGE, inv.companyId, inv.facilityId);
      if (state !== 'NONE' && (await this.scheduledAmount(tx, invoiceId)).gt(0)) throw new DomainError('SCHEDULED', 'Remove the invoice from its payment run first', 409);
      await tx.apInvoice.update({ where: { id: invoiceId }, data: { controlState: state } });
      await this.audit.record(tx, { actorId: user.id, action: `AP_CONTROL_${state}`, entityType: 'ap_invoice', entityId: invoiceId, companyId: inv.companyId, data: { from: inv.controlState, reason } });
      return tx.apInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });
  }

  // ───────────── queries & reports ─────────────

  load(tx: Tx | PrismaService, id: string): Promise<InvoiceFull> {
    return tx.apInvoice.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } }, exceptions: { orderBy: { createdAt: 'asc' } } } });
  }

  async get(user: AuthUser, id: string) {
    const inv = await this.prisma.apInvoice.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNo: 'asc' } }, exceptions: true, allocations: true, supplier: true, po: true, creditNotes: true, runItems: { include: { run: true } } },
    });
    if (!inv) throw NotFound('AP invoice', id);
    assertScope(user, Permission.AP_READ, inv.companyId, inv.facilityId);
    return { ...inv, amountOpen: s4(dec(inv.total).minus(dec(inv.amountSettled))) };
  }

  async list(user: AuthUser, q: { companyId: string; status?: string; matchStatus?: string; supplierId?: string; take?: number }) {
    assertScope(user, Permission.AP_READ, q.companyId);
    const where: Prisma.ApInvoiceWhereInput = {
      companyId: q.companyId,
      status: q.status as ApInvoice['status'] | undefined,
      matchStatus: q.matchStatus as ApInvoice['matchStatus'] | undefined,
      supplierId: q.supplierId,
    };
    const [items, total] = await Promise.all([
      this.prisma.apInvoice.findMany({ where, include: { supplier: { select: { code: true, name: true } } }, orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }], take: Math.min(q.take ?? 100, 500) }),
      this.prisma.apInvoice.count({ where }),
    ]);
    return { items: items.map((i) => ({ ...i, amountOpen: s4(dec(i.total).minus(dec(i.amountSettled))) })), total };
  }

  exceptions(user: AuthUser, companyId: string, status = 'OPEN') {
    assertScope(user, Permission.AP_READ, companyId);
    return this.prisma.matchException.findMany({
      where: { status: status as MatchException['status'], invoice: { companyId } },
      include: { invoice: { select: { id: true, invoiceNumber: true, total: true, currency: true, supplier: { select: { name: true, code: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  suppliers(user: AuthUser, companyId: string) {
    assertScope(user, Permission.AP_READ, companyId);
    return this.prisma.supplier.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  /** Invoices eligible for payment: posted, matched/overridden, not held, open amount net of retention and scheduled payments. */
  async due(user: AuthUser, companyId: string, asOf: string) {
    assertScope(user, Permission.AP_READ, companyId);
    const rows = await this.prisma.apInvoice.findMany({
      where: { companyId, kind: 'INVOICE', status: { in: ['POSTED', 'PARTIALLY_SETTLED'] }, controlState: 'NONE', dueDate: { lte: new Date(asOf) } },
      include: { supplier: { select: { code: true, name: true, status: true } }, runItems: { where: { status: 'PENDING' }, include: { run: { select: { status: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
    return rows
      .filter((r) => r.supplier.status === 'ACTIVE')
      .map((r) => {
        const scheduled = r.runItems.filter((i) => ['DRAFT', 'APPROVED', 'EXECUTING'].includes(i.run.status)).reduce((a, i) => a.plus(dec(i.amount)), d(0));
        const payable = dec(r.total).minus(dec(r.amountSettled)).minus(dec(r.retentionAmount)).minus(scheduled);
        return { id: r.id, invoiceNumber: r.invoiceNumber, supplier: r.supplier, dueDate: r.dueDate, currency: r.currency, total: r.total, amountSettled: r.amountSettled, retention: r.retentionAmount, scheduled: s4(scheduled), payable: s4(Decimal.max(payable, 0)) };
      })
      .filter((r) => d(r.payable).gt(0));
  }

  /** Supplier ageing by days past due on open balances (credit notes reduce the supplier's balance). */
  async ageing(user: AuthUser, companyId: string, asOf: string) {
    assertScope(user, Permission.AP_READ, companyId);
    const at = new Date(asOf);
    const open = await this.prisma.apInvoice.findMany({
      where: { companyId, status: { in: ['POSTED', 'PARTIALLY_SETTLED'] } },
      include: { supplier: { select: { id: true, code: true, name: true } } },
    });
    const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
    const bySupplier = new Map<string, { supplier: { id: string; code: string; name: string }; currency: string } & Record<(typeof buckets)[number] | 'total', Decimal>>();
    for (const inv of open) {
      const sign = inv.kind === 'CREDIT_NOTE' ? -1 : 1;
      const amt = dec(inv.total).minus(dec(inv.amountSettled)).mul(sign);
      const days = Math.floor((at.getTime() - inv.dueDate.getTime()) / 86_400_000);
      const b = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
      const key = `${inv.supplierId}|${inv.currency}`;
      const row = bySupplier.get(key) ?? { supplier: inv.supplier, currency: inv.currency, current: d(0), d1_30: d(0), d31_60: d(0), d61_90: d(0), d90_plus: d(0), total: d(0) };
      row[b] = row[b].plus(amt);
      row.total = row.total.plus(amt);
      bySupplier.set(key, row);
    }
    return [...bySupplier.values()]
      .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name))
      .map((r) => ({ supplier: r.supplier, currency: r.currency, ...Object.fromEntries([...buckets, 'total'].map((k) => [k, s4(r[k as keyof typeof r] as Decimal)])) }));
  }

  /** Supplier statement: invoices (credit), credit notes and payments (debit) with running balance owed. */
  async statement(user: AuthUser, supplierId: string, from?: string, to?: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw NotFound('Supplier', supplierId);
    assertScope(user, Permission.AP_READ, supplier.companyId);
    const docs = await this.prisma.apInvoice.findMany({ where: { supplierId, status: { notIn: ['DRAFT', 'VALIDATED', 'APPROVED', 'REVERSED'] } } });
    const payments = await this.prisma.paymentRunItem.findMany({ where: { status: 'PAID', invoice: { supplierId } }, include: { run: true, invoice: true } });
    type Entry = { date: string; type: string; reference: string; debit: string; credit: string };
    const entries: Entry[] = [
      ...docs.map((x) => ({ date: iso(x.invoiceDate), type: x.kind, reference: x.invoiceNumber, debit: x.kind === 'CREDIT_NOTE' ? s4(dec(x.total)) : '0.0000', credit: x.kind === 'INVOICE' ? s4(dec(x.total)) : '0.0000' })),
      ...payments.map((p) => ({ date: iso(p.run.paymentDate), type: 'PAYMENT', reference: `${p.run.runNo} / ${p.invoice.invoiceNumber}${p.bankReference ? ` / ${p.bankReference}` : ''}`, debit: s4(dec(p.amount)), credit: '0.0000' })),
    ]
      .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
    let bal = d(0);
    const lines = entries.map((e) => {
      bal = bal.plus(d(e.credit)).minus(d(e.debit));
      return { ...e, balance: s4(bal) };
    });
    return { supplier: { id: supplier.id, code: supplier.code, name: supplier.name, currency: supplier.currency }, lines, closingBalance: s4(bal) };
  }
}
