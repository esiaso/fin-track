import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, invoiceEvent, signedEvent, TestCtx } from './helpers';
import { InboxService } from '../src/integration/inbox.service';
import { d } from '@fintrack/shared';

describe('Integration inbox (CliniTrack invoice -> GL)', () => {
  let ctx: TestCtx;
  let http: ReturnType<typeof request>;
  let inbox: InboxService;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    inbox = ctx.app.get(InboxService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  function send(env: Record<string, unknown>, secret?: string) {
    const s = signedEvent(env, secret);
    return http.post('/api/v1/integration/events').set(s.headers).send(s.body);
  }

  async function arBalance(code = '1100') {
    const lines = await ctx.prisma.journalLine.findMany({
      where: { accountId: ctx.ref.accounts[code], journal: { status: { in: ['POSTED', 'REVERSED'] } } },
    });
    return lines.reduce((acc, l) => acc.plus(d(l.debit.toString())).minus(d(l.credit.toString())), d(0)).toFixed(4);
  }

  it('ingests, posts a balanced journal and links it to the source event', async () => {
    const env = invoiceEvent(ctx.ref);
    const r = await send(env).expect(202);
    expect(r.body.status).toBe('ACCEPTED');
    expect(await inbox.process(r.body.id)).toBe('PROCESSED');

    const j = await ctx.prisma.journal.findFirstOrThrow({ where: { sourceEventId: r.body.id }, include: { lines: true } });
    expect(j.status).toBe('POSTED');
    expect(j.source).toBe('CLINITRACK');
    expect(j.sourceEntityId).toBe(env.source_entity_id);
    const dr = j.lines.reduce((a, l) => a.plus(d(l.debit.toString())), d(0));
    const cr = j.lines.reduce((a, l) => a.plus(d(l.credit.toString())), d(0));
    expect(dr.toFixed(2)).toBe('3850.50');
    expect(dr.eq(cr)).toBe(true);

    const trace = await http
      .get(`/api/v1/integration/trace?journalId=${j.id}`)
      .set({ Authorization: `Bearer ${ctx.token(ctx.ref.users.controller)}` })
      .expect(200);
    expect(trace.body[0].eventId).toBe(env.event_id);
  });

  it('treats redelivery of the same event as a duplicate and never double-posts', async () => {
    const env = invoiceEvent(ctx.ref);
    const first = await send(env).expect(202);
    await inbox.process(first.body.id);
    const again = await send(env).expect(200);
    expect(again.body).toMatchObject({ id: first.body.id, status: 'DUPLICATE', inboxStatus: 'PROCESSED' });
    expect(await inbox.process(first.body.id)).toBe('SKIPPED');
    expect(await ctx.prisma.journal.count({ where: { sourceEntityId: env.source_entity_id } })).toBe(1);
  });

  it('rejects reuse of an event_id with different content', async () => {
    const env = invoiceEvent(ctx.ref);
    await send(env).expect(202);
    const tampered = { ...env, payload: { ...env.payload, invoice_number: 'OTHER' } };
    const r = await send(tampered).expect(409);
    expect(r.body.code).toBe('EVENT_ID_REUSED');
  });

  it('rejects bad signatures and malformed envelopes', async () => {
    const env = invoiceEvent(ctx.ref);
    const r = await send(env, 'wrong-secret').expect(401);
    expect(r.body.code).toBe('BAD_SIGNATURE');
    await send({ ...env, event_id: 'x' }).expect(400);
  });

  it('does not repost the same source version delivered under a new event_id (payroll/invoice replay)', async () => {
    const env = invoiceEvent(ctx.ref);
    const a = await send(env).expect(202);
    await inbox.process(a.body.id);
    const b = await send({ ...env, event_id: randomUUID() }).expect(202);
    expect(await inbox.process(b.body.id)).toBe('IGNORED_DUPLICATE');
    expect(await ctx.prisma.journal.count({ where: { sourceEntityId: env.source_entity_id } })).toBe(1);
  });

  it('applies a corrected version as reversal + repost, and ignores a stale older version', async () => {
    const before = await arBalance();
    const v1 = invoiceEvent(ctx.ref, { amounts: ['1000.00'] });
    const v2 = { ...invoiceEvent(ctx.ref, { invoice: v1.source_entity_id, version: 2, amounts: ['800.00', '50.25'] }) };
    const r1 = await send(v1).expect(202);
    await inbox.process(r1.body.id);
    expect(d(await arBalance()).minus(d(before)).toFixed(2)).toBe('1000.00');

    const r2 = await send(v2).expect(202);
    expect(await inbox.process(r2.body.id)).toBe('PROCESSED');
    expect(d(await arBalance()).minus(d(before)).toFixed(2)).toBe('850.25');

    const journals = await ctx.prisma.journal.findMany({ where: { sourceEntityId: v1.source_entity_id } });
    expect(journals.map((j) => `${j.sourceVersion}:${j.status}`).sort()).toEqual(['1:REVERSED', '2:POSTED']);
    const traces = await ctx.prisma.postingTrace.findMany({ where: { inboxEventId: r2.body.id } });
    expect(traces).toHaveLength(2); // reversal + new posting

    // A late redelivery of v1 under a new event id is stale and ignored.
    const late = await send({ ...v1, event_id: randomUUID() }).expect(202);
    expect(await inbox.process(late.body.id)).toBe('IGNORED_DUPLICATE');
    expect(d(await arBalance()).minus(d(before)).toFixed(2)).toBe('850.25');
  });

  it('processes an event exactly once under concurrent workers', async () => {
    const env = invoiceEvent(ctx.ref);
    const r = await send(env).expect(202);
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => inbox.process(r.body.id)));
    expect(outcomes.filter((o) => o === 'PROCESSED')).toHaveLength(1);
    expect(await ctx.prisma.journal.count({ where: { sourceEntityId: env.source_entity_id } })).toBe(1);
  });

  it('retries config failures, dead-letters after max attempts, and replays after the fix', async () => {
    const env = invoiceEvent(ctx.ref, { debtorType: 'DONOR' });
    await ctx.prisma.accountMapping.delete({ where: { companyId_mappingKey: { companyId: ctx.ref.company.id, mappingKey: 'AR_CONTROL:DONOR' } } });
    const r = await send(env).expect(202);
    expect(await inbox.process(r.body.id)).toBe('FAILED');
    expect(await inbox.process(r.body.id)).toBe('FAILED');
    expect(await inbox.process(r.body.id)).toBe('DEAD_LETTER');
    const ev = await ctx.prisma.inboxEvent.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(ev.lastError).toContain('AR_CONTROL:DONOR');
    expect(await ctx.prisma.journal.count({ where: { sourceEntityId: env.source_entity_id } })).toBe(0);

    await ctx.prisma.accountMapping.create({ data: { companyId: ctx.ref.company.id, mappingKey: 'AR_CONTROL:DONOR', accountId: ctx.ref.accounts['1120'] } });
    await http
      .post(`/api/v1/integration/inbox/${r.body.id}/replay`)
      .set({ Authorization: `Bearer ${ctx.token(ctx.ref.users.controller)}` })
      .expect(200);
    expect(await inbox.process(r.body.id)).toBe('PROCESSED');
  });

  it('dead-letters invalid payloads immediately and never posts them', async () => {
    const env = invoiceEvent(ctx.ref);
    (env.payload as { lines: unknown[] }).lines = [];
    const r = await send(env).expect(202);
    expect(await inbox.process(r.body.id)).toBe('DEAD_LETTER');
  });

  it('refuses to post into a closed period (event fails, nothing posted)', async () => {
    await ctx.prisma.fiscalPeriod.update({ where: { id: ctx.ref.periods['2026-07'] }, data: { status: 'SOFT_CLOSED' } });
    const env = invoiceEvent(ctx.ref, { date: '2026-07-10' });
    const r = await send(env).expect(202);
    expect(await inbox.process(r.body.id)).toBe('FAILED');
    expect(await ctx.prisma.journal.count({ where: { sourceEntityId: env.source_entity_id } })).toBe(0);
  });
});
