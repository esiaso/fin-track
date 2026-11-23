import { canTransition } from './statuses';

describe('posting status transitions', () => {
  it('follows the main path', () => {
    expect(canTransition('DRAFT', 'VALIDATED')).toBe(true);
    expect(canTransition('VALIDATED', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'POSTED')).toBe(true);
    expect(canTransition('POSTED', 'PARTIALLY_SETTLED')).toBe(true);
    expect(canTransition('PARTIALLY_SETTLED', 'SETTLED')).toBe(true);
  });
  it('blocks skipping approval', () => {
    expect(canTransition('DRAFT', 'POSTED')).toBe(false);
    expect(canTransition('VALIDATED', 'POSTED')).toBe(false);
  });
  it('blocks progress while disputed or on hold but allows reversal', () => {
    expect(canTransition('POSTED', 'SETTLED', 'DISPUTED')).toBe(false);
    expect(canTransition('APPROVED', 'POSTED', 'ON_HOLD')).toBe(false);
    expect(canTransition('POSTED', 'REVERSED', 'DISPUTED')).toBe(true);
  });
  it('treats REVERSED as terminal', () => {
    expect(canTransition('REVERSED', 'POSTED')).toBe(false);
  });
});
