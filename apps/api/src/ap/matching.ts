import { d, Decimal } from '@fintrack/shared';

export type MatchMode = 'TWO_WAY' | 'THREE_WAY' | 'NON_PO';

export interface Tolerances {
  qtyPct: string; // fraction, 0 = exact
  pricePct: string; // fraction of PO unit price
  priceAbs: string; // max absolute variance per line (qty x price delta)
  taxAbs: string; // max absolute tax variance per line and header
}

export interface PoLineView {
  id: string;
  lineRef: string;
  qtyOrdered: string;
  unitPrice: string;
  taxRate: string;
  qtyReceived: string;
  /** Quantity already invoiced on OTHER invoices. */
  qtyInvoiced: string;
}

export interface InvoiceLineView {
  lineNo: number;
  poLineRef?: string | null;
  qty: string;
  unitPrice: string;
  taxAmount: string;
}

export interface InvoiceHeaderView {
  currency: string;
  subtotal: string;
  taxAmount: string;
  total: string;
}

export interface MatchIssue {
  lineNo: number | null;
  type: 'QTY' | 'PRICE' | 'TAX' | 'TOTAL' | 'CURRENCY' | 'NO_RECEIPT' | 'NO_PO_LINE' | 'NON_PO_APPROVAL';
  message: string;
  expected?: string;
  actual?: string;
}

export interface MatchResult {
  matched: boolean;
  issues: MatchIssue[];
  /** Resolved PO line per invoice line (for qty_invoiced bookkeeping). */
  lineLinks: Record<number, string | null>;
}

/**
 * Pure 2-way / 3-way matcher. Never decides to post: it only reports issues; the caller routes any issue to the
 * exception queue. Tolerances are inclusive (variance exactly at the limit passes).
 *  - Quantity: invoice qty <= billable x (1 + qtyPct), where billable = received - invoiced (3-way) or ordered - invoiced (2-way).
 *  - Price: unit variance <= pricePct x PO price AND line variance (|Δprice| x qty) <= priceAbs.
 *  - Tax: |invoice line tax - qty x price x taxRate| <= taxAbs.
 *  - Header: subtotal = Σ line net (exact), total = subtotal + tax (exact), header tax = Σ line tax (exact).
 */
export function matchInvoice(mode: MatchMode, header: InvoiceHeaderView, lines: InvoiceLineView[], po: { currency: string; lines: PoLineView[] } | null, tol: Tolerances): MatchResult {
  const issues: MatchIssue[] = [];
  const lineLinks: Record<number, string | null> = {};

  // Header arithmetic applies to every invoice, PO or not.
  const net = lines.reduce((acc, l) => acc.plus(d(l.qty).mul(d(l.unitPrice))), d(0)).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
  const lineTax = lines.reduce((acc, l) => acc.plus(d(l.taxAmount)), d(0));
  if (!net.eq(d(header.subtotal))) issues.push({ lineNo: null, type: 'TOTAL', message: 'Subtotal does not equal the sum of line amounts', expected: net.toFixed(4), actual: d(header.subtotal).toFixed(4) });
  if (!lineTax.eq(d(header.taxAmount))) issues.push({ lineNo: null, type: 'TAX', message: 'Header tax does not equal the sum of line tax', expected: lineTax.toFixed(4), actual: d(header.taxAmount).toFixed(4) });
  if (!d(header.subtotal).plus(d(header.taxAmount)).eq(d(header.total))) issues.push({ lineNo: null, type: 'TOTAL', message: 'Total does not equal subtotal + tax', expected: d(header.subtotal).plus(d(header.taxAmount)).toFixed(4), actual: d(header.total).toFixed(4) });

  if (mode === 'NON_PO') {
    issues.push({ lineNo: null, type: 'NON_PO_APPROVAL', message: 'Invoice without a purchase order requires controlled exception approval' });
    lines.forEach((l) => (lineLinks[l.lineNo] = null));
    return { matched: false, issues, lineLinks };
  }
  if (!po) {
    issues.push({ lineNo: null, type: 'NO_PO_LINE', message: 'Referenced purchase order not found' });
    return { matched: false, issues, lineLinks };
  }
  if (po.currency !== header.currency) issues.push({ lineNo: null, type: 'CURRENCY', message: 'Invoice currency differs from PO currency', expected: po.currency, actual: header.currency });

  const byRef = new Map(po.lines.map((l) => [l.lineRef, l]));
  // Track quantity consumed by earlier lines of this same invoice against the same PO line.
  const consumed = new Map<string, Decimal>();

  for (const l of lines) {
    const pol = l.poLineRef ? byRef.get(l.poLineRef) : undefined;
    lineLinks[l.lineNo] = pol?.id ?? null;
    if (!pol) {
      issues.push({ lineNo: l.lineNo, type: 'NO_PO_LINE', message: `No PO line ${l.poLineRef ?? '(missing)'}` });
      continue;
    }
    const qty = d(l.qty);
    const prior = d(pol.qtyInvoiced).plus(consumed.get(pol.id) ?? d(0));
    consumed.set(pol.id, (consumed.get(pol.id) ?? d(0)).plus(qty));

    const base = mode === 'THREE_WAY' ? d(pol.qtyReceived) : d(pol.qtyOrdered);
    const billable = base.minus(prior);
    if (mode === 'THREE_WAY' && d(pol.qtyReceived).lte(prior)) {
      issues.push({ lineNo: l.lineNo, type: 'NO_RECEIPT', message: 'Nothing received (or already fully invoiced) for this PO line', expected: billable.toFixed(4), actual: qty.toFixed(4) });
    } else if (qty.gt(billable.mul(d(1).plus(d(tol.qtyPct))))) {
      issues.push({ lineNo: l.lineNo, type: 'QTY', message: `Invoiced quantity exceeds ${mode === 'THREE_WAY' ? 'received' : 'ordered'} quantity`, expected: billable.toFixed(4), actual: qty.toFixed(4) });
    }

    const poPrice = d(pol.unitPrice);
    const delta = d(l.unitPrice).minus(poPrice).abs();
    const pctLimit = poPrice.mul(d(tol.pricePct));
    const lineVariance = delta.mul(qty);
    if (delta.gt(pctLimit) || lineVariance.gt(d(tol.priceAbs))) {
      issues.push({ lineNo: l.lineNo, type: 'PRICE', message: 'Unit price outside tolerance', expected: poPrice.toFixed(4), actual: d(l.unitPrice).toFixed(4) });
    }

    const expectedTax = qty.mul(d(l.unitPrice)).mul(d(pol.taxRate)).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
    if (d(l.taxAmount).minus(expectedTax).abs().gt(d(tol.taxAbs))) {
      issues.push({ lineNo: l.lineNo, type: 'TAX', message: 'Line tax outside tolerance', expected: expectedTax.toFixed(4), actual: d(l.taxAmount).toFixed(4) });
    }
  }
  return { matched: issues.length === 0, issues, lineLinks };
}

/** Normalise a supplier invoice number for duplicate detection: "inv-00123 " -> "INV123". */
export function normalizeInvoiceNumber(n: string): string {
  const up = n.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return up.replace(/(^|[A-Z])0+(?=\d)/g, '$1');
}
