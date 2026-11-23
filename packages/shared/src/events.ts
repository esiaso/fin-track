import { z } from 'zod';

export const SourceSystem = z.enum(['CLINITRACK', 'SUPPLYTRACK', 'PEOPLETRACK']);
export type SourceSystem = z.infer<typeof SourceSystem>;

/**
 * Canonical envelope for every inbound integration event.
 * Signature is carried in headers (X-FinTrack-Signature / X-FinTrack-Timestamp), not in the body.
 */
export const IntegrationEventEnvelope = z.object({
  source_system: SourceSystem,
  event_type: z.string().min(3).max(120).regex(/^[a-z0-9_.]+$/),
  source_entity_type: z.string().min(1).max(80),
  source_entity_id: z.string().min(1).max(120),
  event_id: z.string().min(8).max(120),
  source_version: z.number().int().nonnegative(),
  occurred_at: z.string().datetime({ offset: true }),
  facility_id: z.string().min(1).max(64),
  correlation_id: z.string().min(1).max(120),
  payload: z.record(z.unknown()),
});
export type IntegrationEventEnvelope = z.infer<typeof IntegrationEventEnvelope>;

const amount = z.string().regex(/^-?\d{1,16}(\.\d{1,4})?$/, 'amount must be a decimal string with <=4dp');

/** CliniTrack: a patient/payer invoice was finalised and is ready to be recognised in the ledger. */
export const CliniTrackInvoiceFinalizedPayload = z.object({
  invoice_number: z.string().min(1),
  company_code: z.string().min(1),
  currency: z.string().length(3),
  invoice_date: z.string().date(),
  debtor_type: z.enum(['SHA', 'PRIVATE_INSURER', 'CORPORATE', 'GOVERNMENT', 'PATIENT', 'DONOR', 'STAFF']),
  debtor_ref: z.string().min(1),
  lines: z
    .array(
      z.object({
        line_id: z.string().min(1),
        service_line: z.string().min(1),
        revenue_mapping_key: z.string().min(1),
        department_code: z.string().optional(),
        amount,
        doctor_ref: z.string().optional(),
      }),
    )
    .min(1),
});
export type CliniTrackInvoiceFinalizedPayload = z.infer<typeof CliniTrackInvoiceFinalizedPayload>;
