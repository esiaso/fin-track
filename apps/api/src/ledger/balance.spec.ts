import { checkBalance } from './balance';

describe('checkBalance', () => {
  it('accepts a balanced single-currency journal', () => {
    const r = checkBalance([
      { currency: 'KES', debit: '1000.00', credit: '0' },
      { currency: 'KES', debit: '0', credit: '600.10' },
      { currency: 'KES', debit: '0', credit: '399.90' },
    ]);
    expect(r.balanced).toBe(true);
    expect(r.byCurrency).toEqual([{ currency: 'KES', debit: '1000.0000', credit: '1000.0000', difference: '0.0000' }]);
  });

  it('rejects when off by the smallest unit', () => {
    const r = checkBalance([
      { currency: 'KES', debit: '100.0001', credit: '0' },
      { currency: 'KES', debit: '0', credit: '100' },
    ]);
    expect(r.balanced).toBe(false);
    expect(r.errors[0]).toContain('KES out of balance by 0.0001');
  });

  it('requires each currency to balance independently even if base balances', () => {
    const r = checkBalance([
      { currency: 'USD', debit: '10', credit: '0', baseDebit: '1290', baseCredit: '0' },
      { currency: 'KES', debit: '0', credit: '1290', baseDebit: '0', baseCredit: '1290' },
    ]);
    expect(r.balanced).toBe(false);
    expect(r.errors.join()).toMatch(/USD out of balance/);
    expect(r.errors.join()).toMatch(/KES out of balance/);
    expect(r.base.difference).toBe('0.0000');
  });

  it('accepts a multi-currency journal that balances per currency and in base', () => {
    const r = checkBalance([
      { currency: 'USD', debit: '10', credit: '0', baseDebit: '1290', baseCredit: '0' },
      { currency: 'USD', debit: '0', credit: '10', baseDebit: '0', baseCredit: '1290' },
      { currency: 'KES', debit: '50', credit: '0' },
      { currency: 'KES', debit: '0', credit: '50' },
    ]);
    expect(r.balanced).toBe(true);
  });

  it('rejects two-sided, zero and negative lines', () => {
    expect(checkBalance([{ currency: 'KES', debit: '1', credit: '1' }, { currency: 'KES', debit: '0', credit: '0' }]).balanced).toBe(false);
    expect(checkBalance([{ currency: 'KES', debit: '-5', credit: '0' }, { currency: 'KES', debit: '0', credit: '-5' }]).balanced).toBe(false);
  });

  it('rejects a single-line journal', () => {
    expect(checkBalance([{ currency: 'KES', debit: '1', credit: '0' }]).balanced).toBe(false);
  });
});
