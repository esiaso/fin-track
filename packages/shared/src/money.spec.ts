import { allocateByWeights, d, sum, toCurrencyUnits, toStorage, isValidAmount } from './money';

describe('money', () => {
  it('adds without binary floating point error', () => {
    expect(sum(['0.1', '0.2']).toFixed(4)).toBe('0.3000');
  });
  it('rounds to storage scale with half-even', () => {
    expect(toStorage('1.00005')).toBe('1.0000');
    expect(toStorage('1.00015')).toBe('1.0002');
  });
  it('rounds to currency minor units', () => {
    expect(toCurrencyUnits('1234.565', 'KES')).toBe('1234.56');
    expect(toCurrencyUnits('1234.5', 'UGX')).toBe('1234');
  });
  it('allocates so parts sum exactly to total', () => {
    const parts = allocateByWeights('100.0000', ['1', '1', '1']);
    expect(sum(parts).toFixed(4)).toBe('100.0000');
    expect(parts).toEqual(['33.3334', '33.3333', '33.3333']);
  });
  it('validates amount strings', () => {
    expect(isValidAmount('10.12345')).toBe(false);
    expect(isValidAmount('10.1234')).toBe(true);
    expect(d(null).isZero()).toBe(true);
  });
});
