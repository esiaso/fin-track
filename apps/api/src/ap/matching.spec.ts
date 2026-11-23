import { matchInvoice, normalizeInvoiceNumber, Tolerances } from './matching';

const tol: Tolerances = { qtyPct: '0', pricePct: '0.02', priceAbs: '500', taxAbs: '1' };
const po = (over: Partial<{ received: string; invoiced: string; price: string }> = {}) => ({
  currency: 'KES',
  lines: [{ id: 'pl1', lineRef: '1', qtyOrdered: '100', unitPrice: over.price ?? '50', taxRate: '0.16', qtyReceived: over.received ?? '100', qtyInvoiced: over.invoiced ?? '0' }],
});
const inv = (qty: string, price: string, tax?: string) => {
  const net = (Number(qty) * Number(price)).toFixed(4);
  const t = tax ?? (Number(net) * 0.16).toFixed(4);
  return {
    header: { currency: 'KES', subtotal: net, taxAmount: t, total: (Number(net) + Number(t)).toFixed(4) },
    lines: [{ lineNo: 1, poLineRef: '1', qty, unitPrice: price, taxAmount: t }],
  };
};

describe('3-way matching', () => {
  it('matches an exact invoice', () => {
    const i = inv('100', '50');
    expect(matchInvoice('THREE_WAY', i.header, i.lines, po(), tol)).toMatchObject({ matched: true, issues: [] });
  });

  it('accepts price variance within 2% and within KES 500 per line', () => {
    const i = inv('100', '51'); // +2% exactly, line variance 100
    expect(matchInvoice('THREE_WAY', i.header, i.lines, po(), tol).matched).toBe(true);
  });

  it('flags price variance beyond the percentage', () => {
    const i = inv('100', '51.5');
    expect(matchInvoice('THREE_WAY', i.header, i.lines, po(), tol).issues.map((x) => x.type)).toEqual(['PRICE']);
  });

  it('flags price within % but beyond the absolute line cap (lower of the two wins)', () => {
    const big = { currency: 'KES', lines: [{ id: 'pl1', lineRef: '1', qtyOrdered: '1000', unitPrice: '50', taxRate: '0.16', qtyReceived: '1000', qtyInvoiced: '0' }] };
    const i = inv('1000', '50.9'); // 1.8% but 900 line variance
    expect(matchInvoice('THREE_WAY', i.header, i.lines, big, tol).issues.map((x) => x.type)).toEqual(['PRICE']);
  });

  it('flags quantity above received in 3-way but not in 2-way', () => {
    const i = inv('80', '50');
    expect(matchInvoice('THREE_WAY', i.header, i.lines, po({ received: '60' }), tol).issues.map((x) => x.type)).toEqual(['QTY']);
    expect(matchInvoice('TWO_WAY', i.header, i.lines, po({ received: '60' }), tol).matched).toBe(true);
  });

  it('respects quantity already invoiced on earlier invoices', () => {
    const i = inv('50', '50');
    expect(matchInvoice('THREE_WAY', i.header, i.lines, po({ invoiced: '60' }), tol).issues.map((x) => x.type)).toEqual(['QTY']);
    expect(matchInvoice('THREE_WAY', i.header, i.lines, po({ invoiced: '100' }), tol).issues.map((x) => x.type)).toEqual(['NO_RECEIPT']);
  });

  it('applies qty tolerance', () => {
    const i = inv('105', '50');
    expect(matchInvoice('THREE_WAY', i.header, i.lines, po(), { ...tol, qtyPct: '0.05' }).matched).toBe(true);
    expect(matchInvoice('THREE_WAY', i.header, i.lines, po(), tol).matched).toBe(false);
  });

  it('flags tax variance beyond tolerance', () => {
    const i = inv('100', '50', '805.0000');
    expect(matchInvoice('THREE_WAY', i.header, i.lines, po(), tol).issues.map((x) => x.type)).toEqual(['TAX']);
  });

  it('flags header arithmetic and currency', () => {
    const i = inv('100', '50');
    const r = matchInvoice('THREE_WAY', { ...i.header, total: '1.0000', currency: 'USD' }, i.lines, po(), tol);
    expect(r.issues.map((x) => x.type).sort()).toEqual(['CURRENCY', 'TOTAL']);
  });

  it('never auto-matches a non-PO invoice', () => {
    const i = inv('1', '50');
    expect(matchInvoice('NON_PO', i.header, i.lines, null, tol).issues.map((x) => x.type)).toEqual(['NON_PO_APPROVAL']);
  });
});

describe('normalizeInvoiceNumber', () => {
  it('treats formatting variants as the same invoice', () => {
    expect(normalizeInvoiceNumber('inv-00123 ')).toBe('INV123');
    expect(normalizeInvoiceNumber('INV 123')).toBe('INV123');
    expect(normalizeInvoiceNumber('000456')).toBe('456');
    expect(normalizeInvoiceNumber('A0B01')).toBe('A0B1');
  });
});
