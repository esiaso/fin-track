import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a decimal string for display without converting through float arithmetic for sums. */
export function formatAmount(value: string | number | null | undefined, currency = 'KES') {
  if (value === null || value === undefined || value === '') return '—';
  const [int, frac = ''] = String(value).split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${currency} ${grouped}.${(frac + '00').slice(0, 2)}`;
}

export function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: '2-digit' });
}
