import request from 'supertest';
import { randomUUID } from 'crypto';
import { d } from '@fintrack/shared';
import { createTestApp, signedEvent, TestCtx } from './helpers';
import { InboxService } from '../src/integration/inbox.service';

const SECRET = 'supply-test-secret';

describe('Accounts payable (SupplyTrack -> AP -> payment)', () => {
  let ctx: TestCtx;
  let http: ReturnType<typeof request>;
  let inbox: InboxService;
  const auth = (u: { id: string; roles: unknown[] }) => ({ Authorization: `Bearer ${ctx.token(u)}` });

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    inbox = ctx.app.get(InboxService);
  });
  afterAll(async () => ctx.app.close());

  // ── event helpers ──
  function envelope(eventType: string, entityType: string, entityId: string, payload: Record<string, unknown>, version = 1) {
    return {
      source_system: 'SUPPLYTRACK',
      event_type: eventType,
      source_entity_type: entityType,
      source_entity_id: entityId,
      event_id: randomUUID(),
      source_version: version,
      occurred_at: new Date().toISOString(),
      facility_id: ctx.ref.facilities.nbo.externalId,
      correlation_id: `corr-${entityId}`,
      payload: { company_code: ctx.ref.company.code, ...payload },
    };
  }
  async function deliver(env: Record<string, unknown>) {
    const s = signedEvent(env, SECRET);
    const r = await http.post('/api/v1/integration/events').set(s.headers).send(s.body);
    if (r.status >= 300) throw new Error(`ingest ${r.status} ${JSON.stringify(r.body)}`);
    const status = await inbox.process(r.body.id);
    return { inboxId: r.body.id as string, status };
  }

  async function supplier(opts: { wht?: string; status?: 'ACTIVE' | 'BLOCKED' } = {}) {
    const sid = `SUP-${randomUUID().slice(0, 6)}`;
    await deliver(envelope('supplytrack.supplier.approved', 'supplier', sid, { supplier_id: sid, code: sid, name: `Supplier ${sid}`, currency: 'KES', payment_terms_days: 30, withholding_rate: opts.wht ?? '0', payee_ref: `vault:${sid}`, status: opts.status ?? 'ACTIVE' }));
    return ctx.prisma.supplier.findFirstOrThrow({ where: { sourceSupplierId: sid } });
  }
  async function po(supplierRef: string, lines: { ref: string; qty: string; price: string; tax?: string }[]) {
    const poNo = `PO-${randomUUID().slice(0, 6)}`;
    await deliver(envelope('supplytrack.po.approved', 'purchase_order', poNo, {
      po_number: poNo, supplier_id: supplierRef, currency: 'KES', order_date: '2026-11-01',
      lines: lines.map((l) => ({ line_ref: l.ref, description: `Item ${l.ref}`, qty: l.qty, unit_price: l.price, tax_rate: l.tax ?? '0.16', expense_key: 'AP_EXPENSE:MEDICAL_SUPPLIES' })),
    }));
    return poNo;
  }
  async function grn(poNo: string, lines: { ref: string; qty: string }[]) {
    const g = `GRN-${randomUUID().slice(0, 6)}`;
    return deliver(envelope('supplytrack.grn.accepted', 'goods_receipt', g, { grn_number: g, po_number: poNo, received_date: '2026-11-03', lines: lines.map((l) => ({ po_line_ref: l.ref, qty_accepted: l.qty })) }));
  }
  function invoicePayload(supplierRef: string, poNo: string | undefined, number: string, lines: { ref?: string; qty: string; price: string; taxRate?: number; tax?: string; expense?: string }[], extra: Record<string, unknown> = {}) {
    const ls = lines.map((l) => {
      const net = d(l.qty).mul(d(l.price));
      const tax = l.tax ?? net.mul(l.taxRate ?? 0.16).toFixed(4);
      return { po_line_ref: l.ref, description: 'line', qty: l.qty, unit_price: l.price, tax_amount: tax, expense_key: l.expense, net };
    });
    const subtotal = ls.reduce((a, l) => a.plus(l.net), d(0));
    const tax = ls.reduce((a, l) => a.plus(d(l.tax_amount)), d(0));
    return {
      supplier_id: supplierRef, invoice_number: number, po_number: poNo, match_type: poNo ? 'THREE_WAY' : 'NON_PO', invoice_date: '2026-11-05', currency: 'KES',
      subtotal: subtotal.toFixed(4), tax_amount: tax.toFixed(4), total: subtotal.plus(tax).toFixed(4),
      lines: ls.map(({ net: _n, ...rest }) => rest),
      ...extra,
    };
  }
  async function invoice(payload: Record<string, unknown>, entityId = `SINV-${randomUUID().slice(0, 8)}`) {
    const res = await deliver(envelope('supplytrack.invoice.received', 'supplier_invoice', entityId, payload));
    const inv = await ctx.prisma.apInvoice.findFirst({ where: { sourceEntityId: entityId }, include: { exceptions: true } });
    return { ...res, inv, entityId };
  }
  async function journalLines(journalId: string) {
    return ctx.prisma.journalLine.findMany({ where: { journalId }, include: { account: true }, orderBy: { lineNo: 'asc' } });
  }
  async function scenario(opts: { wht?: string; qty?: string; price?: string; received?: string } = {}) {
    const s = await supplier({ wht: opts.wht });
    const poNo = await po(s.sourceSupplierId, [{ ref: '1', qty: '100', price: '50' }]);
    await grn(poNo, [{ ref: '1', qty: opts.received ?? '100' }]);
    const r = await invoice(invoicePayload(s.sourceSupplierId, poNo, `INV-${randomUUID().slice(0, 5)}`, [{ ref: '1', qty: opts.qty ?? '100', price: opts.price ?? '50' }]));
    return { s, poNo, ...r };
  }

  function payRun(invoiceId: string, amount: string, preparer = ctx.ref.users.apOfficer) {
    return http.post('/api/v1/ap/payment-runs').set(auth(preparer)).send({ companyId: ctx.ref.company.id, paymentDate: '2026-11-25', currency: 'KES', items: [{ invoiceId, amount }] });
  }
  async function releaseRun(runId: string) {
    await http.post(`/api/v1/ap/payment-runs/${runId}/approve`).set(auth(ctx.ref.users.checker)).expect(200);
    const ex = await http.post(`/api/v1/ap/payment-runs/${runId}/execute`).set(auth(ctx.ref.users.treasury)).expect(200);
    return ex.body.instructions as { itemId: string; amount: string }[];
  }
  const result = (itemId: string, body: Record<string, unknown>) => http.post(`/api/v1/ap/payment-items/${itemId}/result`).set(auth(ctx.ref.users.treasury)).send(body);

  // ── 3-way matching ──
  it('auto-posts a 3-way matched invoice: DR expense + DR input VAT, CR AP control; links PO and receipt', async () => {
    const { inv, status } = await scenario();
    expect(status).toBe('PROCESSED');
    expect(inv!.status).toBe('POSTED');
    expect(inv!.matchStatus).toBe('MATCHED');
    const lines = await journalLines(inv!.journalId!);
    expect(lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()])).toEqual([
      ['6000', '5000', '0'],
      ['1400', '800', '0'],
      ['2000', '0', '5800'],
    ]);
    const pol = await ctx.prisma.purchaseOrderLine.findFirstOrThrow({ where: { poId: inv!.poId! } });
    expect(pol.qtyInvoiced.toString()).toBe('100');
  });

  it('accepts price variance inside tolerance and routes variance beyond it to the exception queue (never posted)', async () => {
    const ok = await scenario({ price: '51' }); // +2%
    expect(ok.inv!.status).toBe('POSTED');
    const bad = await scenario({ price: '52' }); // +4%
    expect(bad.inv!.status).toBe('VALIDATED');
    expect(bad.inv!.matchStatus).toBe('EXCEPTION');
    expect(bad.inv!.journalId).toBeNull();
    expect(bad.inv!.exceptions.map((e) => e.type)).toEqual(['PRICE']);
  });

  it('flags invoicing beyond received quantity (3-way) and supports override + separate approver', async () => {
    const { inv } = await scenario({ qty: '100', received: '60' });
    expect(inv!.exceptions.map((e) => e.type)).toEqual(['QTY']);
    const ex = inv!.exceptions[0];
    await http.post(`/api/v1/ap/exceptions/${ex.id}/override`).set(auth(ctx.ref.users.apOfficer)).send({ note: 'x' }).expect(403); // AP officer cannot override
    await http.post(`/api/v1/ap/exceptions/${ex.id}/override`).set(auth(ctx.ref.users.controller)).send({ note: 'Balance delivered, GRN pending in SupplyTrack' }).expect(200);
    const sod = await http.post(`/api/v1/ap/invoices/${inv!.id}/approve`).set(auth(ctx.ref.users.controller)).expect(403);
    expect(sod.body.code).toBe('SOD_VIOLATION');
    const ok = await http.post(`/api/v1/ap/invoices/${inv!.id}/approve`).set(auth(ctx.ref.users.checker)).expect(200);
    expect(ok.body.status).toBe('POSTED');
    expect(ok.body.approvedBy).toBe(ctx.ref.users.checker.id);
  });

  it('keeps non-PO invoices in a controlled exception until coded and approved', async () => {
    const s = await supplier();
    const r = await invoice(invoicePayload(s.sourceSupplierId, undefined, 'UTIL-001', [{ qty: '1', price: '12000' }]));
    expect(r.inv!.exceptions.map((e) => e.type)).toEqual(['NON_PO_APPROVAL']);
    const res = await http.post(`/api/v1/ap/exceptions/${r.inv!.exceptions[0].id}/override`).set(auth(ctx.ref.users.controller)).send({ note: 'KPLC' }).expect(422);
    expect(res.body.code).toBe('EXPENSE_CODING_REQUIRED');

    const coded = await invoice(invoicePayload(s.sourceSupplierId, undefined, 'UTIL-002', [{ qty: '1', price: '12500', expense: 'AP_EXPENSE:UTILITIES' }]));
    await http.post(`/api/v1/ap/exceptions/${coded.inv!.exceptions[0].id}/override`).set(auth(ctx.ref.users.controller)).send({ note: 'Utility bill, no PO by policy' }).expect(200);
    await http.post(`/api/v1/ap/invoices/${coded.inv!.id}/approve`).set(auth(ctx.ref.users.checker)).expect(200);
    const posted = await ctx.prisma.apInvoice.findUniqueOrThrow({ where: { id: coded.inv!.id } });
    const lines = await journalLines(posted.journalId!);
    expect(lines[0].account.code).toBe('6100');
  });

  // ── duplicates ──
  it('rejects hard duplicate invoices (formatting variants) and never posts them twice', async () => {
    const s = await supplier();
    const poNo = await po(s.sourceSupplierId, [{ ref: '1', qty: '10', price: '100' }]);
    await grn(poNo, [{ ref: '1', qty: '10' }]);
    const first = await invoice(invoicePayload(s.sourceSupplierId, poNo, 'INV-00077', [{ ref: '1', qty: '5', price: '100' }]));
    expect(first.inv!.status).toBe('POSTED');
    const dup = await invoice(invoicePayload(s.sourceSupplierId, poNo, 'inv 77', [{ ref: '1', qty: '5', price: '100' }]));
    expect(dup.status).toBe('DEAD_LETTER');
    expect(dup.inv).toBeNull();
    const ev = await ctx.prisma.inboxEvent.findUniqueOrThrow({ where: { id: dup.inboxId } });
    expect(ev.lastError).toMatch(/DUPLICATE_INVOICE/);
    expect(await ctx.prisma.apInvoice.count({ where: { supplierId: s.id } })).toBe(1);
  });

  it('flags a soft duplicate (same supplier/date/amount, different number) for review', async () => {
    const s = await supplier();
    const poNo = await po(s.sourceSupplierId, [{ ref: '1', qty: '10', price: '100' }]);
    await grn(poNo, [{ ref: '1', qty: '10' }]);
    await invoice(invoicePayload(s.sourceSupplierId, poNo, 'A-1', [{ ref: '1', qty: '5', price: '100' }]));
    const second = await invoice(invoicePayload(s.sourceSupplierId, poNo, 'A-2', [{ ref: '1', qty: '5', price: '100' }]));
    expect(second.inv!.exceptions.map((e) => e.type)).toEqual(['DUPLICATE_SUSPECT']);
    expect(second.inv!.journalId).toBeNull();
  });

  // ── settlement ──
  it('settles partially then fully, posting withholding separately and exactly', async () => {
    const { inv } = await scenario({ wht: '0.05' }); // total 5800, WHT 5% of 5000 = 250
    expect(inv!.withholdingAmount.toString()).toBe('250');

    const r1 = await payRun(inv!.id, '2000.00').expect(201);
    const [i1] = await releaseRun(r1.body.id);
    expect(i1.amount).toBe('1913.7931'); // 2000 - 250*2000/5800
    await result(i1.itemId, { status: 'PAID', bankReference: 'FT123' }).expect(200);
    let cur = await ctx.prisma.apInvoice.findUniqueOrThrow({ where: { id: inv!.id } });
    expect(cur.status).toBe('PARTIALLY_SETTLED');
    expect(cur.amountSettled.toString()).toBe('2000');

    const r2 = await payRun(inv!.id, '3800.00').expect(201);
    const [i2] = await releaseRun(r2.body.id);
    await result(i2.itemId, { status: 'PAID', bankReference: 'FT124' }).expect(200);
    cur = await ctx.prisma.apInvoice.findUniqueOrThrow({ where: { id: inv!.id } });
    expect(cur.status).toBe('SETTLED');

    const items = await ctx.prisma.paymentRunItem.findMany({ where: { invoiceId: inv!.id, status: 'PAID' } });
    expect(items.reduce((a, i) => a.plus(d(i.withholding.toString())), d(0)).toFixed(4)).toBe('250.0000');
    const payJ = await journalLines(items[0].journalId!);
    expect(payJ.map((l) => l.account.code)).toEqual(['2000', '1000', '2120']);

    const stmt = await http.get(`/api/v1/ap/suppliers/${inv!.supplierId}/statement`).set(auth(ctx.ref.users.apOfficer)).expect(200);
    expect(stmt.body.closingBalance).toBe('0.0000');
  });

  it('prevents over-allocation, including across concurrent payment runs', async () => {
    const { inv } = await scenario();
    const over = await payRun(inv!.id, '5800.01').expect(409);
    expect(over.body.code).toBe('OVER_ALLOCATION');
    const results = await Promise.all([payRun(inv!.id, '5800.00'), payRun(inv!.id, '5800.00'), payRun(inv!.id, '3000.00')]);
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).length).toBe(2);
  });

  it('records each payment result exactly once under concurrent bank callbacks', async () => {
    const { inv } = await scenario();
    const run = await payRun(inv!.id, '5800.00').expect(201);
    const [item] = await releaseRun(run.body.id);
    const res = await Promise.all(Array.from({ length: 5 }, () => result(item.itemId, { status: 'PAID', bankReference: 'FT9' })));
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(await ctx.prisma.journal.count({ where: { idempotencyKey: `AP_PAYMENT:${item.itemId}` } })).toBe(1);
    expect((await ctx.prisma.apInvoice.findUniqueOrThrow({ where: { id: inv!.id } })).amountSettled.toString()).toBe('5800');
  });

  it('handles payment failures: rejected items post nothing; returned payments are reversed', async () => {
    const { inv } = await scenario();
    const run = await payRun(inv!.id, '5800.00').expect(201);
    const [item] = await releaseRun(run.body.id);
    await result(item.itemId, { status: 'FAILED', reason: 'Invalid account' }).expect(200);
    let cur = await ctx.prisma.apInvoice.findUniqueOrThrow({ where: { id: inv!.id } });
    expect(cur.status).toBe('POSTED');
    expect(await ctx.prisma.journal.count({ where: { idempotencyKey: `AP_PAYMENT:${item.itemId}` } })).toBe(0);

    // Re-schedule after failure (the failed item no longer reserves the amount).
    const run2 = await payRun(inv!.id, '5800.00').expect(201);
    const [item2] = await releaseRun(run2.body.id);
    await result(item2.itemId, { status: 'PAID', bankReference: 'FT77' }).expect(200);
    await result(item2.itemId, { status: 'FAILED', reason: 'Returned: account closed' }).expect(200);
    cur = await ctx.prisma.apInvoice.findUniqueOrThrow({ where: { id: inv!.id } });
    expect(cur.status).toBe('POSTED');
    expect(cur.amountSettled.toString()).toBe('0');
    const payJ = await ctx.prisma.journal.findFirstOrThrow({ where: { idempotencyKey: `AP_PAYMENT:${item2.itemId}` } });
    expect(payJ.status).toBe('REVERSED');
  });

  it('requires maker-checker on payment runs and blocks held invoices', async () => {
    const { inv } = await scenario();
    await http.post(`/api/v1/ap/invoices/${inv!.id}/control`).set(auth(ctx.ref.users.apOfficer)).send({ state: 'DISPUTED', reason: 'Short delivery query' }).expect(200);
    const held = await payRun(inv!.id, '100.00').expect(409);
    expect(held.body.code).toBe('NOT_PAYABLE');
    await http.post(`/api/v1/ap/invoices/${inv!.id}/control`).set(auth(ctx.ref.users.controller)).send({ state: 'NONE', reason: 'Resolved with supplier' }).expect(200);

    await payRun(inv!.id, '100.00', ctx.ref.users.controller).expect(403); // controller lacks ap:manage (segregation)
    const run = await payRun(inv!.id, '100.00').expect(201);
    await http.post(`/api/v1/ap/payment-runs/${run.body.id}/approve`).set(auth(ctx.ref.users.apOfficer)).expect(403);
    await http.post(`/api/v1/ap/payment-runs/${run.body.id}/execute`).set(auth(ctx.ref.users.treasury)).expect(409); // not approved yet
  });

  it('applies supplier credit notes against the original invoice', async () => {
    const { inv, s } = await scenario();
    const cn = await invoice(
      invoicePayload(s.sourceSupplierId, undefined, `CN-${inv!.invoiceNumber}`, [{ qty: '10', price: '50', expense: 'AP_EXPENSE:MEDICAL_SUPPLIES' }], {
        kind: 'CREDIT_NOTE',
        credits_invoice_number: inv!.invoiceNumber,
        match_type: 'TWO_WAY',
      }),
    );
    expect(cn.inv!.status).toBe('SETTLED');
    const lines = await journalLines(cn.inv!.journalId!);
    expect(lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()])).toEqual([
      ['6000', '0', '500'],
      ['1400', '0', '80'],
      ['2000', '580', '0'],
    ]);
    const orig = await ctx.prisma.apInvoice.findUniqueOrThrow({ where: { id: inv!.id } });
    expect(orig.status).toBe('PARTIALLY_SETTLED');
    expect(orig.amountSettled.toString()).toBe('580');
    const tooMuch = await payRun(inv!.id, '5800.00').expect(409);
    expect(tooMuch.body.details.payable).toBe('5220.0000');
  });

  it('reports ageing per supplier', async () => {
    const { inv } = await scenario();
    const r = await http.get(`/api/v1/ap/ageing?companyId=${ctx.ref.company.id}&asOf=2026-12-20`).set(auth(ctx.ref.users.apOfficer)).expect(200);
    const row = r.body.find((x: { supplier: { id: string } }) => x.supplier.id === inv!.supplierId);
    expect(row).toMatchObject({ d1_30: '5800.0000', total: '5800.0000' }); // due 2026-12-05
  });

  it('keeps AP control equal to the sum of open payables (sub-ledger reconciles to GL)', async () => {
    const lines = await ctx.prisma.journalLine.findMany({ where: { accountId: ctx.ref.accounts['2000'], journal: { status: { in: ['POSTED', 'REVERSED'] } } } });
    const gl = lines.reduce((a, l) => a.plus(d(l.credit.toString())).minus(d(l.debit.toString())), d(0));
    const open = await ctx.prisma.apInvoice.findMany({ where: { companyId: ctx.ref.company.id, status: { in: ['POSTED', 'PARTIALLY_SETTLED', 'SETTLED'] } } });
    const sub = open.reduce((a, i) => a.plus(d(i.total.toString()).minus(d(i.amountSettled.toString())).mul(i.kind === 'CREDIT_NOTE' ? -1 : 1)), d(0));
    expect(gl.toFixed(4)).toBe(sub.toFixed(4));
  });
});
