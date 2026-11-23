/**
 * Lifecycle for financial documents (payable invoices, debtor invoices, payroll batches, ...).
 * Main path: DRAFT -> VALIDATED -> APPROVED -> POSTED -> PARTIALLY_SETTLED -> SETTLED.
 * DISPUTED / ON_HOLD are separately controlled *hold* states (stored in `controlState`),
 * so the posting status is never lost while a hold is applied. REVERSED is terminal.
 */
export const PostingStatus = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  PARTIALLY_SETTLED: 'PARTIALLY_SETTLED',
  SETTLED: 'SETTLED',
  REVERSED: 'REVERSED',
} as const;
export type PostingStatus = (typeof PostingStatus)[keyof typeof PostingStatus];

export const ControlState = {
  NONE: 'NONE',
  DISPUTED: 'DISPUTED',
  ON_HOLD: 'ON_HOLD',
} as const;
export type ControlState = (typeof ControlState)[keyof typeof ControlState];

const TRANSITIONS: Record<PostingStatus, PostingStatus[]> = {
  DRAFT: ['VALIDATED'],
  VALIDATED: ['APPROVED', 'DRAFT'],
  APPROVED: ['POSTED', 'DRAFT'],
  POSTED: ['PARTIALLY_SETTLED', 'SETTLED', 'REVERSED'],
  PARTIALLY_SETTLED: ['PARTIALLY_SETTLED', 'SETTLED', 'REVERSED'],
  SETTLED: ['PARTIALLY_SETTLED', 'REVERSED'], // PARTIALLY_SETTLED only via payment failure / reversal of a settlement
  REVERSED: [],
};

export function canTransition(from: PostingStatus, to: PostingStatus, control: ControlState = 'NONE'): boolean {
  // A document under dispute or on hold may not progress towards posting/settlement.
  if (control !== 'NONE' && to !== from && to !== 'REVERSED') return false;
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PostingStatus, to: PostingStatus, control: ControlState = 'NONE'): void {
  if (!canTransition(from, to, control)) {
    throw new Error(`Illegal status transition ${from} -> ${to} (control=${control})`);
  }
}

export const JournalStatus = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  REVERSED: 'REVERSED',
} as const;
export type JournalStatus = (typeof JournalStatus)[keyof typeof JournalStatus];

export const PeriodStatus = {
  OPEN: 'OPEN',
  SOFT_CLOSED: 'SOFT_CLOSED',
  LOCKED: 'LOCKED',
} as const;
export type PeriodStatus = (typeof PeriodStatus)[keyof typeof PeriodStatus];
