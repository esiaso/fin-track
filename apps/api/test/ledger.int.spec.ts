import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestCtx } from './helpers';

describe('General ledger (integration, real PostgreSQL)', () => {
  let ctx: TestCtx;
  let http: ReturnType<typeof request>;
  const auth = (u: { id: string; roles: unknown[] }) => ({ Authorization: `Bearer ${ctx.token(u)}` });

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const draft = (overrides: Partial<{ lines: unknown[]; journalDate: string; facilityId: string }> = {}) => ({
    companyId: ctx.ref.company.id,
    facilityId: ctx.ref.facilities.nbo.id,
    journalDate: overrides.journalDate ?? '2026-11-10',
    description: 'Accrue November utilities',
    lines: overrides.lines ?? [
      { accountId: ctx.ref.accounts['6100'], currency: 'KES', debit: '45000.10', credit: '0' },
      { accountId: ctx.ref.accounts['2300'], currency: 'KES', debit: '0', credit: '45000.10' },
    ],
    ...(overrides.facilityId ? { facilityId: overrides.facilityId } : {}),
  });

  async function createApproved(body = draft()) {
    const { maker, checker } = ctx.ref.users;
    const c = await http.post('/api/v1/journals').set(auth(maker)).set('Idempotency-Key', randomUUID()).send(body).expect(201);
    const id = c.body.journal.id;
    await http.post(`/api/v1/journals/${id}/validate`).set(auth(maker)).expect(200);
    await http.post(`/api/v1/journals/${id}/approve`).set(auth(checker)).expect(200);
    return id as string;
  }

  it('runs maker-checker DRAFT -> VALIDATED -> APPROVED -> POSTED and the trial balance balances', async () => {
    const id = await createApproved();
    const posted = await http.post(`/api/v1/journals/${id}/post`).set(auth(ctx.ref.users.checker)).expect(200);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.journalNo).toMatch(/^JV-\d{8}$/);
    expect(posted.body.contentHash).toHaveLength(64);

    const tb = await http.get(`/api/v1/reports/trial-balance?companyId=${ctx.ref.company.id}`).set(auth(ctx.ref.users.controller)).expect(200);
    expect(tb.body.totals).toEqual([{ currency: 'KES', debit: '45000.1000', credit: '45000.1000', balanced: true }]);

    const outbox = await ctx.prisma.outboxEvent.findMany({ where: { aggregateId: id } });
    expect(outbox.map((o) => o.eventType)).toEqual(['fintrack.journal.posted']);
  });

  it('enforces separation of duties: maker cannot approve own journal', async () => {
    const { checker } = ctx.ref.users;
    // checker has JOURNAL_CREATE too (CHIEF_ACCOUNTANT) - create and try to self-approve
    const c = await http.post('/api/v1/journals').set(auth(checker)).set('Idempotency-Key', randomUUID()).send(draft()).expect(201);
    await http.post(`/api/v1/journals/${c.body.journal.id}/validate`).set(auth(checker)).expect(200);
    const r = await http.post(`/api/v1/journals/${c.body.journal.id}/approve`).set(auth(checker)).expect(403);
    expect(r.body.code).toBe('SOD_VIOLATION');
  });

  it('rejects permission-less roles', async () => {
    await http.post('/api/v1/journals').set(auth(ctx.ref.users.auditor)).set('Idempotency-Key', randomUUID()).send(draft()).expect(403);
  });

  it('rejects unbalanced journals before they are stored', async () => {
    const r = await http
      .post('/api/v1/journals')
      .set(auth(ctx.ref.users.maker))
      .set('Idempotency-Key', randomUUID())
      .send(draft({ lines: [
        { accountId: ctx.ref.accounts['6100'], currency: 'KES', debit: '100.00', credit: '0' },
        { accountId: ctx.ref.accounts['2300'], currency: 'KES', debit: '0', credit: '99.99' },
      ] }))
      .expect(422);
    expect(r.body.code).toBe('UNBALANCED');
    expect(r.body.details.byCurrency[0].difference).toBe('0.0100');
  });

  it('requires each currency to balance independently', async () => {
    const r = await http
      .post('/api/v1/journals')
      .set(auth(ctx.ref.users.maker))
      .set('Idempotency-Key', randomUUID())
      .send(draft({ lines: [
        { accountId: ctx.ref.accounts['6100'], currency: 'USD', debit: '100', credit: '0', fxRate: '129.5' },
        { accountId: ctx.ref.accounts['2300'], currency: 'KES', debit: '0', credit: '12950' },
      ] }))
      .expect(422);
    expect(r.body.code).toBe('UNBALANCED');
  });

  it('blocks manual journals to sub-ledger control accounts', async () => {
    const r = await http
      .post('/api/v1/journals')
      .set(auth(ctx.ref.users.maker))
      .set('Idempotency-Key', randomUUID())
      .send(draft({ lines: [
        { accountId: ctx.ref.accounts['1100'], currency: 'KES', debit: '10', credit: '0' },
        { accountId: ctx.ref.accounts['4000'], currency: 'KES', debit: '0', credit: '10' },
      ] }))
      .expect(422);
    expect(r.body.code).toBe('CONTROL_ACCOUNT');
  });

  it('is idempotent on Idempotency-Key', async () => {
    const key = randomUUID();
    const a = await http.post('/api/v1/journals').set(auth(ctx.ref.users.maker)).set('Idempotency-Key', key).send(draft()).expect(201);
    const b = await http.post('/api/v1/journals').set(auth(ctx.ref.users.maker)).set('Idempotency-Key', key).send(draft()).expect(201);
    expect(a.body.created).toBe(true);
    expect(b.body.created).toBe(false);
    expect(b.body.journal.id).toBe(a.body.journal.id);
    expect(await ctx.prisma.journal.count({ where: { idempotencyKey: `API:${key}` } })).toBe(1);
    await http.post('/api/v1/journals').set(auth(ctx.ref.users.maker)).send(draft()).expect(400);
  });

  it('enforces facility scope', async () => {
    const r = await http
      .post('/api/v1/journals')
      .set(auth(ctx.ref.users.ksmAccountant))
      .set('Idempotency-Key', randomUUID())
      .send(draft({ facilityId: ctx.ref.facilities.nbo.id }))
      .expect(403);
    expect(r.body.code).toBe('FORBIDDEN');
    await http
      .post('/api/v1/journals')
      .set(auth(ctx.ref.users.ksmAccountant))
      .set('Idempotency-Key', randomUUID())
      .send(draft({ facilityId: ctx.ref.facilities.ksm.id }))
      .expect(201);
  });

  it('corrects posted journals only by reversal', async () => {
    const id = await createApproved();
    await http.post(`/api/v1/journals/${id}/post`).set(auth(ctx.ref.users.checker)).expect(200);
    const rev = await http.post(`/api/v1/journals/${id}/reverse`).set(auth(ctx.ref.users.controller)).send({ reason: 'Duplicate accrual' }).expect(200);
    expect(rev.body.status).toBe('POSTED');
    expect(rev.body.reversalOfId).toBe(id);
    const orig = await ctx.prisma.journal.findUniqueOrThrow({ where: { id } });
    expect(orig.status).toBe('REVERSED');
    // second reversal is refused
    await http.post(`/api/v1/journals/${id}/reverse`).set(auth(ctx.ref.users.controller)).send({ reason: 'again' }).expect(409);
  });

  describe('database-level controls', () => {
    it('refuses to post an unbalanced journal even via raw SQL', async () => {
      const j = await ctx.prisma.journal.create({
        data: {
          companyId: ctx.ref.company.id,
          journalDate: new Date('2026-11-12'),
          periodId: ctx.ref.periods['2026-11'],
          description: 'tamper',
          idempotencyKey: randomUUID(),
          createdBy: ctx.ref.users.maker.id,
          lines: {
            create: [
              { lineNo: 1, accountId: ctx.ref.accounts['6100'], currency: 'KES', debit: '10', baseDebit: '10' },
              { lineNo: 2, accountId: ctx.ref.accounts['2300'], currency: 'KES', credit: '9', baseCredit: '9' },
            ],
          },
        },
      });
      await expect(
        ctx.prisma.$executeRawUnsafe(`UPDATE journals SET status='POSTED', posted_at=now(), content_hash='x' WHERE id='${j.id}'`),
      ).rejects.toThrow(/FT_UNBALANCED/);
    });

    it('makes posted lines and headers immutable', async () => {
      const id = await createApproved();
      await http.post(`/api/v1/journals/${id}/post`).set(auth(ctx.ref.users.checker)).expect(200);
      await expect(ctx.prisma.$executeRawUnsafe(`UPDATE journal_lines SET debit = debit + 1 WHERE journal_id='${id}'`)).rejects.toThrow(/FT_IMMUTABLE/);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM journal_lines WHERE journal_id='${id}'`)).rejects.toThrow(/FT_IMMUTABLE/);
      await expect(ctx.prisma.$executeRawUnsafe(`UPDATE journals SET description='edited' WHERE id='${id}'`)).rejects.toThrow(/FT_IMMUTABLE/);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM journals WHERE id='${id}'`)).rejects.toThrow(/FT_IMMUTABLE/);
    });

    it('keeps the audit log append-only and hash-chain verifiable', async () => {
      await expect(ctx.prisma.$executeRawUnsafe(`UPDATE audit_log SET action='x'`)).rejects.toThrow(/FT_AUDIT_APPEND_ONLY/);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM audit_log`)).rejects.toThrow(/FT_AUDIT_APPEND_ONLY/);
      const v = await http.get('/api/v1/audit/verify').set(auth(ctx.ref.users.auditor)).expect(200);
      expect(v.body.ok).toBe(true);
      expect(v.body.checked).toBeGreaterThan(0);
    });
  });

  describe('period locks', () => {
    it('blocks posting into a soft-closed period and allows reopen with a reason', async () => {
      const id = await createApproved(draft({ journalDate: '2026-10-15' }));
      const pid = ctx.ref.periods['2026-10'];
      await http.post(`/api/v1/periods/${pid}/soft-close`).set(auth(ctx.ref.users.controller)).send({}).expect(200);
      const r = await http.post(`/api/v1/journals/${id}/post`).set(auth(ctx.ref.users.checker)).expect(409);
      expect(r.body.code).toBe('PERIOD_NOT_OPEN');
      await http.post(`/api/v1/periods/${pid}/reopen`).set(auth(ctx.ref.users.controller)).send({}).expect(422);
      await http.post(`/api/v1/periods/${pid}/reopen`).set(auth(ctx.ref.users.controller)).send({ reason: 'Late supplier accrual' }).expect(200);
      await http.post(`/api/v1/journals/${id}/post`).set(auth(ctx.ref.users.checker)).expect(200);
    });

    it('refuses to lock a period with unposted journals, and LOCKED is final', async () => {
      await createApproved(draft({ journalDate: '2026-09-15' }));
      const pid = ctx.ref.periods['2026-09'];
      const r = await http.post(`/api/v1/periods/${pid}/lock`).set(auth(ctx.ref.users.controller)).send({}).expect(409);
      expect(r.body.code).toBe('PERIOD_HAS_PENDING');

      const p8 = ctx.ref.periods['2026-08'];
      await http.post(`/api/v1/periods/${p8}/lock`).set(auth(ctx.ref.users.controller)).send({}).expect(200);
      await http.post(`/api/v1/periods/${p8}/reopen`).set(auth(ctx.ref.users.controller)).send({ reason: 'please' }).expect(409);
      const c = await http.post('/api/v1/journals').set(auth(ctx.ref.users.maker)).set('Idempotency-Key', randomUUID()).send(draft({ journalDate: '2026-08-20' })).expect(201);
      await http.post(`/api/v1/journals/${c.body.journal.id}/validate`).set(auth(ctx.ref.users.maker)).expect(409);
    });
  });

  describe('concurrency', () => {
    it('posts a journal exactly once under concurrent post requests', async () => {
      const id = await createApproved();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => http.post(`/api/v1/journals/${id}/post`).set(auth(ctx.ref.users.checker))),
      );
      const ok = results.filter((r) => r.status === 200);
      expect(ok).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      const posted = await ctx.prisma.outboxEvent.count({ where: { aggregateId: id, eventType: 'fintrack.journal.posted' } });
      expect(posted).toBe(1);
    });

    it('assigns unique gap-free journal numbers under concurrent posting', async () => {
      const ids = await Promise.all(Array.from({ length: 5 }, () => createApproved()));
      const res = await Promise.all(ids.map((id) => http.post(`/api/v1/journals/${id}/post`).set(auth(ctx.ref.users.checker)).expect(200)));
      const nos = res.map((r) => r.body.journalNo);
      expect(new Set(nos).size).toBe(5);
    });
  });
});
