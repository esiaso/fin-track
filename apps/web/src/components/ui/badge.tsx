import { cn } from '@/lib/utils';

const tones: Record<string, string> = {
  POSTED: 'bg-green-soft text-green',
  PROCESSED: 'bg-green-soft text-green',
  OPEN: 'bg-green-soft text-green',
  SETTLED: 'bg-green-soft text-green',
  MATCHED: 'bg-green-soft text-green',
  PAID: 'bg-green-soft text-green',
  COMPLETED: 'bg-green-soft text-green',
  PARTIALLY_SETTLED: 'bg-blue-soft text-blue',
  OVERRIDDEN: 'bg-blue-soft text-blue',
  EXECUTING: 'bg-blue-soft text-blue',
  PENDING: 'bg-primary-soft text-primary',
  EXCEPTION: 'bg-amber-soft text-amber',
  ON_HOLD: 'bg-amber-soft text-amber',
  DISPUTED: 'bg-red-soft text-red',
  CANCELLED: 'bg-gray-2 text-dark-4 dark:bg-white/5 dark:text-dark-6',
  APPROVED: 'bg-blue-soft text-blue',
  VALIDATED: 'bg-primary-soft text-primary',
  RECEIVED: 'bg-primary-soft text-primary',
  DRAFT: 'bg-gray-2 text-dark-4 dark:bg-white/5 dark:text-dark-6',
  SOFT_CLOSED: 'bg-amber-soft text-amber',
  FAILED: 'bg-amber-soft text-amber',
  IGNORED_DUPLICATE: 'bg-gray-2 text-dark-4 dark:bg-white/5 dark:text-dark-6',
  REVERSED: 'bg-red-soft text-red',
  LOCKED: 'bg-red-soft text-red',
  DEAD_LETTER: 'bg-red-soft text-red',
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-3 py-1 text-xs font-medium', tones[status] ?? 'bg-gray-2 text-dark-4', className)}>
      {label ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}
