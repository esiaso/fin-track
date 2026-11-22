import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedReference, Reference } from '../prisma/fixtures';
import { signBody } from '../src/integration/signature';
import { AuthUser } from '../src/auth/auth.types';
import { permissionsFor } from '@fintrack/shared';

export interface TestCtx {
  app: INestApplication;
  prisma: PrismaService;
  ref: Reference;
  token(user: { id: string; roles: unknown[] }): string;
  authUser(user: { id: string; roles: { role: string; companyId?: string | null; facilityId?: string | null }[] }): AuthUser;
}

export async function createTestApp(): Promise<TestCtx> {
  const mod = await Test.createTestingModule({ imports: [AppModule.register({ queue: false })] }).compile();
  const app = mod.createNestApplication({ rawBody: true, logger: false });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  const ref = await seedReference(prisma, suffix);
  const jwt = app.get(JwtService);
  return {
    app,
    prisma,
    ref,
    token: (u) => jwt.sign({ sub: u.id, roles: u.roles }),
    authUser: (u) => ({ id: u.id, roles: u.roles, permissions: permissionsFor(u.roles.map((r) => r.role)) }),
  };
}

export function signedEvent(envelope: Record<string, unknown>, secret = 'clini-test-secret', ts = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(envelope);
  return { body, headers: { 'content-type': 'application/json', 'x-fintrack-timestamp': String(ts), 'x-fintrack-signature': signBody(secret, String(ts), body) } };
}

export function invoiceEvent(ref: Reference, opts: { invoice?: string; version?: number; eventId?: string; amounts?: string[]; date?: string; debtorType?: string } = {}) {
  const invoice = opts.invoice ?? `INV-${randomUUID().slice(0, 8)}`;
  const amounts = opts.amounts ?? ['1500.00', '2350.50'];
  const keys = ['CONSULTATION', 'LAB', 'PHARMACY'];
  return {
    source_system: 'CLINITRACK',
    event_type: 'clinitrack.invoice.finalized',
    source_entity_type: 'invoice',
    source_entity_id: invoice,
    event_id: opts.eventId ?? randomUUID(),
    source_version: opts.version ?? 1,
    occurred_at: new Date().toISOString(),
    facility_id: ref.facilities.nbo.externalId,
    correlation_id: `corr-${invoice}`,
    payload: {
      invoice_number: invoice,
      company_code: ref.company.code,
      currency: 'KES',
      invoice_date: opts.date ?? '2026-11-15',
      debtor_type: opts.debtorType ?? 'SHA',
      debtor_ref: 'SHA-MEMBER-REDACTED',
      lines: amounts.map((amount, i) => ({ line_id: `${invoice}-L${i + 1}`, service_line: keys[i % 3], revenue_mapping_key: keys[i % 3], department_code: 'OPD', amount })),
    },
  };
}
