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

// ───────────── SupplyTrack payloads (Increment 2) ─────────────
const qty = z.string().regex(/^\d{1,16}(\.\d{1,4})?$/, 'quantity must be a decimal string with <=4dp');
const rate = z.string().regex(/^0(\.\d{1,6})?$|^1(\.0{1,6})?$/, 'rate must be a fraction between 0 and 1');

export const SupplierApprovedPayload = z.object({
  company_code: z.string().min(1),
  supplier_id: z.string().min(1),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  tax_pin: z.string().max(40).optional(),
  currency: z.string().length(3),
  payment_terms_days: z.number().int().min(0).max(365),
  withholding_rate: rate.default('0'),
  payee_ref: z.string().max(120).optional(),
  status: z.enum(['ACTIVE', 'BLOCKED']).default('ACTIVE'),
});
export type SupplierApprovedPayload = z.infer<typeof SupplierApprovedPayload>;

export const PurchaseOrderApprovedPayload = z.object({
  company_code: z.string().min(1),
  po_number: z.string().min(1),
  supplier_id: z.string().min(1),
  currency: z.string().length(3),
  order_date: z.string().date(),
  lines: z
    .array(
      z.object({
        line_ref: z.string().min(1),
        item_ref: z.string().optional(),
        description: z.string().min(1),
        qty: qty,
        unit_price: amount,
        tax_rate: rate.default('0'),
        expense_key: z.string().optional(),
      }),
    )
    .min(1),
});
export type PurchaseOrderApprovedPayload = z.infer<typeof PurchaseOrderApprovedPayload>;

export const GoodsReceivedPayload = z.object({
  company_code: z.string().min(1),
  grn_number: z.string().min(1),
  po_number: z.string().min(1),
  kind: z.enum(['GOODS', 'SERVICE']).default('GOODS'),
  received_date: z.string().date(),
  lines: z.array(z.object({ po_line_ref: z.string().min(1), qty_accepted: qty })).min(1),
});
export type GoodsReceivedPayload = z.infer<typeof GoodsReceivedPayload>;

export const SupplierInvoicePayload = z.object({
  company_code: z.string().min(1),
  supplier_id: z.string().min(1),
  invoice_number: z.string().min(1).max(60),
  kind: z.enum(['INVOICE', 'CREDIT_NOTE']).default('INVOICE'),
  /// For credit notes: the supplier invoice number being credited.
  credits_invoice_number: z.string().optional(),
  po_number: z.string().optional(),
  match_type: z.enum(['TWO_WAY', 'THREE_WAY', 'NON_PO']).default('THREE_WAY'),
  invoice_date: z.string().date(),
  currency: z.string().length(3),
  subtotal: amount,
  tax_amount: amount,
  total: amount,
  retention_amount: amount.default('0'),
  lines: z
    .array(
      z.object({
        po_line_ref: z.string().optional(),
        description: z.string().min(1),
        qty: qty,
        unit_price: amount,
        tax_amount: amount,
        expense_key: z.string().optional(),
      }),
    )
    .min(1),
});
export type SupplierInvoicePayload = z.infer<typeof SupplierInvoicePayload>;
