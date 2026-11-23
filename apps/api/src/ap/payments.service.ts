import { Injectable } from '@nestjs/common';
import { PaymentMethod, PaymentRunItem } from '@prisma/client';
import { d, Decimal, Permission } from '@fintrack/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { JournalsService } from '../ledger/journals.service';
import { DomainError, NotFound } from '../common/errors';
import { AuthUser } from '../auth/auth.types';
import { assertScope } from '../auth/scope';
import { ApService } from './ap.service';
import { assertApprovalLimit, dec, iso, lockInvoices, resolveAccounts, s4 } from './ap-common';

export interface RunItemInput {
  invoiceId: string;
  amount: string;
}

/**
 * Supplier payment runs: DRAFT -> APPROVED (checker != maker) -> EXECUTING (file released to bank/M-PESA)
 * -> COMPLETED once every item has a result. Each item is PENDING -> PAID | FAILED; a PAID item that the bank later
 * returns is reversed (journal reversal + allocation reversed), restoring the payable.
 * Postings happen only on a confirmed PAID result, so failed payments never touch the ledger.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ap: ApService,
    private readonly journals: JournalsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(user: AuthUser, input: { companyId: string; paymentDate: string; currency: string; method?: PaymentMethod; bankMappingKey?: string; items: RunItemInput[] }) {
    assertScope(user, Permission.AP_MANAGE, input.companyId);
    if (!input.items.length) throw new DomainError('EMPTY_RUN', 'A payment run needs at least one item');
    return this.prisma.tx(async (tx) => {
      await lockInvoices(tx, input.items.map((i) => i.invoiceId));
      const runNo = await this.nextRunNo(tx, input.companyId);
      const run = await tx.paymentRun.create({
        data: { companyId: input.companyId, runNo, paymentDate: new Date(input.paymentDate), currency: input.currency, method: input.method ?? 'BANK_TRANSFER', bankMappingKey: input.bankMappingKey ?? 'BANK:DEFAULT', createdBy: user.id },
      });
      const perInvoice = new Map<string, Decimal>();
      for (const item of input.items) perInvoice.set(item.invoiceId, (perInvoice.get(item.invoiceId) ?? d(0)).plus(d(item.amount)));

      for (const [invoiceId, amount] of perInvoice) {
        if (amount.lte(0)) throw new DomainError('INVALID_AMOUNT', 'Payment amounts must be positive');
        const inv = await tx.apInvoice.findUnique({ where: { id: invoiceId }, include: { supplier: true } });
        if (!inv || inv.companyId !== input.companyId) throw NotFound('AP invoice', invoiceId);
        if (inv.kind !== 'INVOICE') throw new DomainError('NOT_PAYABLE', `${inv.invoiceNumber} is a credit note`);
        if (!['POSTED', 'PARTIALLY_SETTLED'].includes(inv.status)) throw new DomainError('NOT_PAYABLE', `${inv.invoiceNumber} is ${inv.status}`, 409);
        if (inv.controlState !== 'NONE') throw new DomainError('NOT_PAYABLE', `${inv.invoiceNumber} is ${inv.controlState}`, 409);
        if (inv.supplier.status !== 'ACTIVE') throw new DomainError('SUPPLIER_BLOCKED', `Supplier ${inv.supplier.code} is blocked`, 409);
        if (inv.currency !== input.currency) throw new DomainError('CURRENCY_MISMATCH', `${inv.invoiceNumber} is in ${inv.currency}`);
        const scheduled = await this.ap.scheduledAmount(tx, invoiceId);
        const payable = dec(inv.total).minus(dec(inv.amountSettled)).minus(dec(inv.retentionAmount)).minus(scheduled);
        if (amount.gt(payable)) {
          throw new DomainError('OVER_ALLOCATION', `${inv.invoiceNumber}: ${amount.toFixed(2)} exceeds payable ${payable.toFixed(2)} (open, less retention and amounts already scheduled)`, 409, { payable: s4(payable) });
        }
        const wht = this.withholdingFor(inv.withholdingAmount, inv.total, inv.amountSettled, amount, scheduled);
        await tx.paymentRunItem.create({ data: { runId: run.id, invoiceId, amount: s4(amount), withholding: s4(wht), netPaid: s4(amount.minus(wht)) } });
      }
      await this.audit.record(tx, { actorId: user.id, action: 'AP_RUN_CREATED', entityType: 'ap_payment_run', entityId: run.id, companyId: input.companyId, data: { runNo, items: perInvoice.size } });
      return this.load(tx, run.id);
    });
  }

  /** Withholding pro-rata to the gross being paid; the payment that clears the invoice takes the remainder (no rounding drift). */
  private withholdingFor(totalWht: unknown, total: unknown, settled: unknown, amount: Decimal, scheduled: Decimal): Decimal {
    const W = dec(totalWht as string);
    if (W.isZero()) return d(0);
    const T = dec(total as string);
    const already = W.mul(dec(settled as string).plus(scheduled)).div(T).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
    if (dec(settled as string).plus(scheduled).plus(amount).gte(T)) return W.minus(already);
    return W.mul(amount).div(T).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
  }

  async approve(user: AuthUser, runId: string) {
    return this.prisma.tx(async (tx) => {
      const run = await this.lockRun(tx, runId);
      assertScope(user, Permission.AP_APPROVE, run.companyId);
      if (run.status !== 'DRAFT') throw new DomainError('INVALID_STATUS', `Run is ${run.status}`, 409);
      if (run.createdBy === user.id) throw new DomainError('SOD_VIOLATION', 'The preparer cannot approve their own payment run', 403);
      const total = run.items.reduce((a, i) => a.plus(dec(i.amount)), d(0));
      await assertApprovalLimit(tx, user, run.companyId, 'PAYMENT_RUN', total);
      await tx.paymentRun.update({ where: { id: runId }, data: { status: 'APPROVED', approvedBy: user.id, approvedAt: new Date() } });
      await this.audit.record(tx, { actorId: user.id, action: 'AP_RUN_APPROVED', entityType: 'ap_payment_run', entityId: runId, companyId: run.companyId, data: { total: s4(total) } });
      return this.load(tx, runId);
    });
  }

  /** Release to the bank / M-PESA channel. Returns the payment instructions (payee references only; no account numbers). */
  async execute(user: AuthUser, runId: string) {
    return this.prisma.tx(async (tx) => {
      const run = await this.lockRun(tx, runId);
      assertScope(user, Permission.AP_PAY_EXECUTE, run.companyId);
      if (run.status !== 'APPROVED') throw new DomainError('INVALID_STATUS', `Run is ${run.status}; it must be APPROVED`, 409);
      if (run.createdBy === user.id) throw new DomainError('SOD_VIOLATION', 'The preparer cannot release the payment run', 403);
      await tx.paymentRun.update({ where: { id: runId }, data: { status: 'EXECUTING' } });
      const full = await this.load(tx, runId);
      const instructions = full.items.map((i) => ({ itemId: i.id, payeeRef: i.invoice.supplier.payeeRef, supplierCode: i.invoice.supplier.code, amount: s4(dec(i.netPaid)), currency: full.currency, reference: `${full.runNo}/${i.invoice.invoiceNumber}` }));
      await this.outbox.add(tx, { aggregateType: 'ap_payment_run', aggregateId: runId, eventType: 'fintrack.payment_run.released', payload: { runId, runNo: full.runNo, method: full.method, instructions } });
      await this.audit.record(tx, { actorId: user.id, action: 'AP_RUN_RELEASED', entityType: 'ap_payment_run', entityId: runId, companyId: run.companyId });
      return { run: full, instructions };
    });
  }

  async cancel(user: AuthUser, runId: string) {
    return this.prisma.tx(async (tx) => {
      const run = await this.lockRun(tx, runId);
      assertScope(user, Permission.AP_MANAGE, run.companyId);
      if (!['DRAFT', 'APPROVED'].includes(run.status)) throw new DomainError('INVALID_STATUS', `Run is ${run.status}`, 409);
      await tx.paymentRunItem.updateMany({ where: { runId }, data: { status: 'CANCELLED' } });
      await tx.paymentRun.update({ where: { id: runId }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, { actorId: user.id, action: 'AP_RUN_CANCELLED', entityType: 'ap_payment_run', entityId: runId, companyId: run.companyId });
      return this.load(tx, runId);
    });
  }

  /**
   * Bank/M-PESA result for one item. Idempotent: repeating the same result is a no-op.
   *  PENDING -> PAID: post DR AP control / CR bank (net) / CR WHT payable, allocate, settle invoice.
   *  PENDING -> FAILED: release the scheduled amount; nothing posted.
   *  PAID -> RETURNED (FAILED): reverse the payment journal and the allocation.
   */
  async recordResult(user: AuthUser, itemId: string, result: { status: 'PAID' | 'FAILED'; bankReference?: string; reason?: string; valueDate?: string }) {
    return this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; invoice_id: string; run_id: string }[]>`SELECT id, invoice_id, run_id FROM ap_payment_run_items WHERE id = ${itemId}::uuid FOR UPDATE`;
      if (!rows.length) throw NotFound('Payment item', itemId);
      await lockInvoices(tx, [rows[0].invoice_id]);
      const item = await tx.paymentRunItem.findUniqueOrThrow({ where: { id: itemId }, include: { run: true, invoice: true } });
      assertScope(user, Permission.AP_PAY_EXECUTE, item.run.companyId);
      if (item.run.status !== 'EXECUTING' && item.run.status !== 'COMPLETED') throw new DomainError('INVALID_STATUS', `Run is ${item.run.status}; results can only be recorded after release`, 409);
      if (item.status === result.status) return this.load(tx, item.runId); // idempotent replay
      if (item.status === 'CANCELLED') throw new DomainError('INVALID_STATUS', 'Item was cancelled', 409);

      if (item.status === 'PENDING' && result.status === 'PAID') await this.settle(tx, item, user.id, result.bankReference, result.valueDate);
      else if (item.status === 'PENDING' && result.status === 'FAILED') {
        await tx.paymentRunItem.update({ where: { id: itemId }, data: { status: 'FAILED', failureReason: result.reason ?? 'Rejected by bank' } });
        await this.audit.record(tx, { actorId: user.id, action: 'AP_PAYMENT_FAILED', entityType: 'ap_payment_item', entityId: itemId, companyId: item.run.companyId, data: { reason: result.reason } });
      } else if (item.status === 'PAID' && result.status === 'FAILED') await this.unsettle(tx, item, user.id, result.reason ?? 'Returned by bank');
      else throw new DomainError('INVALID_STATUS', `Cannot move item from ${item.status} to ${result.status}`, 409);

      const pending = await tx.paymentRunItem.count({ where: { runId: item.runId, status: 'PENDING' } });
      if (pending === 0) await tx.paymentRun.update({ where: { id: item.runId }, data: { status: 'COMPLETED' } });
      return this.load(tx, item.runId);
    });
  }

  private async settle(tx: Tx, item: PaymentRunItem & { run: { companyId: string; runNo: string; paymentDate: Date; bankMappingKey: string; currency: string }; invoice: { id: string; facilityId: string; supplierId: string; invoiceNumber: string; total: unknown; amountSettled: unknown } }, actorId: string, bankReference?: string, valueDate?: string) {
    const amount = dec(item.amount);
    const open = dec(item.invoice.total as string).minus(dec(item.invoice.amountSettled as string));
    if (amount.gt(open)) throw new DomainError('OVER_ALLOCATION', `Payment ${amount.toFixed(2)} exceeds open balance ${open.toFixed(2)}`, 409);
    const acct = await resolveAccounts(tx, item.run.companyId, ['AP_CONTROL', item.run.bankMappingKey, 'WHT_PAYABLE']);
    const dims = { supplier_id: item.invoice.supplierId, ap_invoice_id: item.invoiceId, payment_item_id: item.id, bank_reference: bankReference ?? null };
    const lines = [
      { accountId: acct.get('AP_CONTROL')!, currency: item.run.currency, debit: s4(amount), credit: '0', facilityId: item.invoice.facilityId, description: `Pay ${item.invoice.invoiceNumber}`, dimensions: dims },
      { accountId: acct.get(item.run.bankMappingKey)!, currency: item.run.currency, debit: '0', credit: s4(dec(item.netPaid)), facilityId: item.invoice.facilityId, description: `${item.run.runNo} ${bankReference ?? ''}`.trim(), dimensions: dims },
    ];
    if (dec(item.withholding).gt(0)) lines.push({ accountId: acct.get('WHT_PAYABLE')!, currency: item.run.currency, debit: '0', credit: s4(dec(item.withholding)), facilityId: item.invoice.facilityId, description: `Withholding on ${item.invoice.invoiceNumber}`, dimensions: dims });
    const { journal } = await this.journals.postSystemJournal(tx, actorId, {
      companyId: item.run.companyId,
      facilityId: item.invoice.facilityId,
      journalDate: valueDate ?? iso(item.run.paymentDate),
      description: `Supplier payment ${item.run.runNo} / ${item.invoice.invoiceNumber}`,
      idempotencyKey: `AP_PAYMENT:${item.id}`,
      source: 'FINTRACK',
      sourceEntityType: 'ap_payment_item',
      sourceEntityId: item.id,
      lines,
    });
    const alloc = await tx.apAllocation.create({ data: { invoiceId: item.invoiceId, sourceType: 'PAYMENT', sourceId: item.id, amount: s4(amount), journalId: journal.id, createdBy: actorId } });
    await tx.paymentRunItem.update({ where: { id: item.id }, data: { status: 'PAID', bankReference, journalId: journal.id, allocationId: alloc.id, failureReason: null } });
    await this.ap.bumpSettlement(tx, item.invoiceId, amount);
    await this.audit.record(tx, { actorId, action: 'AP_PAYMENT_SETTLED', entityType: 'ap_invoice', entityId: item.invoiceId, companyId: item.run.companyId, data: { itemId: item.id, amount: s4(amount), journalId: journal.id } });
    await this.outbox.add(tx, { aggregateType: 'ap_invoice', aggregateId: item.invoiceId, eventType: 'fintrack.ap_payment.settled', payload: { invoiceId: item.invoiceId, itemId: item.id, amount: s4(amount), bankReference: bankReference ?? null } });
  }

  private async unsettle(tx: Tx, item: PaymentRunItem & { run: { companyId: string } }, actorId: string, reason: string) {
    const j = await tx.journal.findUniqueOrThrow({ where: { id: item.journalId! }, include: { lines: true } });
    await this.journals.reverseInTx(tx, j, actorId, `Payment returned: ${reason}`);
    await tx.apAllocation.update({ where: { id: item.allocationId! }, data: { reversedAt: new Date() } });
    await tx.paymentRunItem.update({ where: { id: item.id }, data: { status: 'FAILED', failureReason: reason, allocationId: null } });
    await this.ap.bumpSettlement(tx, item.invoiceId, dec(item.amount).neg());
    await this.audit.record(tx, { actorId, action: 'AP_PAYMENT_RETURNED', entityType: 'ap_invoice', entityId: item.invoiceId, companyId: item.run.companyId, data: { itemId: item.id, reason } });
  }

  private async lockRun(tx: Tx, runId: string) {
    const r = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ap_payment_runs WHERE id = ${runId}::uuid FOR UPDATE`;
    if (!r.length) throw NotFound('Payment run', runId);
    return tx.paymentRun.findUniqueOrThrow({ where: { id: runId }, include: { items: true } });
  }

  private async nextRunNo(tx: Tx, companyId: string) {
    await tx.documentSequence.upsert({ where: { companyId_docType: { companyId, docType: 'PAYMENT_RUN' } }, update: {}, create: { companyId, docType: 'PAYMENT_RUN', prefix: 'PR' } });
    const rows = await tx.$queryRaw<{ v: number; prefix: string }[]>`
      UPDATE document_sequences SET next_value = next_value + 1 WHERE company_id = ${companyId}::uuid AND doc_type = 'PAYMENT_RUN' RETURNING next_value - 1 AS v, prefix`;
    return `${rows[0].prefix}-${String(rows[0].v).padStart(6, '0')}`;
  }

  load(tx: Tx | PrismaService, runId: string) {
    return tx.paymentRun.findUniqueOrThrow({
      where: { id: runId },
      include: { items: { include: { invoice: { include: { supplier: { select: { code: true, name: true, payeeRef: true } } } } }, orderBy: { id: 'asc' } } },
    });
  }

  async get(user: AuthUser, runId: string) {
    const run = await this.load(this.prisma, runId).catch(() => null);
    if (!run) throw NotFound('Payment run', runId);
    assertScope(user, Permission.AP_READ, run.companyId);
    return run;
  }

  list(user: AuthUser, companyId: string) {
    assertScope(user, Permission.AP_READ, companyId);
    return this.prisma.paymentRun.findMany({ where: { companyId }, include: { _count: { select: { items: true } }, items: { select: { amount: true, status: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}
