import { Injectable } from '@nestjs/common';
import { InboxEvent } from '@prisma/client';
import { CliniTrackInvoiceFinalizedPayload, d } from '@fintrack/shared';
import { Tx } from '../../prisma/prisma.service';
import { JournalsService, LineInput } from '../../ledger/journals.service';
import { SYSTEM_ACTOR_ID } from '../../common/system-actor';
import { EventHandler, HandlerResult, NonRetryableError } from './handler';

/**
 * CliniTrack `clinitrack.invoice.finalized` -> revenue recognition journal:
 *   DR  AR control (per debtor type)      total
 *   CR  Revenue (per service mapping key) per line
 * A higher source_version of the same invoice reverses the previously posted journal(s) and posts the new version
 * (corrections are reversal + repost, never edits). The full debtor sub-ledger arrives in Increment 3.
 */
@Injectable()
export class CliniTrackInvoiceFinalizedHandler implements EventHandler {
  readonly eventType = 'clinitrack.invoice.finalized';

  constructor(private readonly journals: JournalsService) {}

  async handle(tx: Tx, ev: InboxEvent): Promise<HandlerResult> {
    const parsed = CliniTrackInvoiceFinalizedPayload.safeParse(ev.payload);
    if (!parsed.success) throw new NonRetryableError(`Invalid payload: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const p = parsed.data;

    const facility = await tx.facility.findUnique({ where: { externalId: ev.facilityExtId }, include: { company: true } });
    if (!facility) throw new NonRetryableError(`Unknown facility ${ev.facilityExtId}`);
    if (facility.company.code !== p.company_code) throw new NonRetryableError(`Facility ${facility.code} does not belong to company ${p.company_code}`);
    const company = facility.company;
    if (p.currency !== company.baseCurrency) throw new NonRetryableError(`Foreign-currency invoices need an FX rate source (A-FX-01); got ${p.currency}`);

    const keys = [`AR_CONTROL:${p.debtor_type}`, ...new Set(p.lines.map((l) => `REVENUE:${l.revenue_mapping_key}`))];
    const maps = await tx.accountMapping.findMany({ where: { companyId: company.id, mappingKey: { in: keys } } });
    const acct = new Map(maps.map((m) => [m.mappingKey, m.accountId]));
    const missing = keys.filter((k) => !acct.has(k));
    // Missing mapping is a config gap: retry (finance can add the mapping) and eventually dead-letter.
    if (missing.length) throw new Error(`Missing account mapping(s): ${missing.join(', ')}`);

    const departments = await tx.department.findMany({ where: { facilityId: facility.id } });
    const deptByCode = new Map(departments.map((x) => [x.code, x.id]));

    const total = p.lines.reduce((acc, l) => acc.plus(d(l.amount)), d(0));
    if (total.lte(0)) throw new NonRetryableError('Invoice total must be positive; credit notes use clinitrack.invoice.credited');

    const trace: HandlerResult['traces'] = [];
    const traceRef = { invoice_number: p.invoice_number, source_entity_id: ev.sourceEntityId, source_version: ev.sourceVersion };

    // Supersede earlier versions.
    const prior = await tx.journal.findMany({
      where: {
        companyId: company.id,
        source: 'CLINITRACK',
        sourceEntityType: ev.sourceEntityType,
        sourceEntityId: ev.sourceEntityId,
        status: 'POSTED',
        sourceVersion: { lt: ev.sourceVersion },
      },
      include: { lines: true },
    });
    for (const j of prior) {
      const rev = await this.journals.reverseInTx(tx, j, SYSTEM_ACTOR_ID, `Superseded by ${ev.sourceEntityType} ${ev.sourceEntityId} v${ev.sourceVersion}`, p.invoice_date);
      trace.push({ targetType: 'JOURNAL', targetId: rev.id });
    }

    const lines: LineInput[] = [
      {
        accountId: acct.get(`AR_CONTROL:${p.debtor_type}`)!,
        currency: p.currency,
        debit: total.toFixed(4),
        credit: '0',
        facilityId: facility.id,
        description: `Invoice ${p.invoice_number}`,
        dimensions: { ...traceRef, debtor_type: p.debtor_type, debtor_ref: p.debtor_ref },
      },
      ...p.lines.map((l) => ({
        accountId: acct.get(`REVENUE:${l.revenue_mapping_key}`)!,
        currency: p.currency,
        debit: '0',
        credit: l.amount,
        facilityId: facility.id,
        departmentId: l.department_code ? deptByCode.get(l.department_code) ?? null : null,
        description: `${p.invoice_number} / ${l.service_line}`,
        dimensions: { ...traceRef, source_line_id: l.line_id, service_line: l.service_line, doctor_ref: l.doctor_ref ?? null },
      })),
    ];

    const { journal } = await this.journals.postSystemJournal(tx, SYSTEM_ACTOR_ID, {
      companyId: company.id,
      facilityId: facility.id,
      journalDate: p.invoice_date,
      description: `CliniTrack invoice ${p.invoice_number} v${ev.sourceVersion}`,
      idempotencyKey: `CLINITRACK:${ev.sourceEntityType}:${ev.sourceEntityId}:v${ev.sourceVersion}`,
      source: 'CLINITRACK',
      sourceEntityType: ev.sourceEntityType,
      sourceEntityId: ev.sourceEntityId,
      sourceVersion: ev.sourceVersion,
      sourceEventId: ev.id,
      correlationId: ev.correlationId,
      lines,
    });
    trace.push({ targetType: 'JOURNAL', targetId: journal.id });
    return { traces: trace };
  }
}
