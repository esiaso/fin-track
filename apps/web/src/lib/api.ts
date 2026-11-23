'use client';

import { session } from './session';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = session.token();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body?.code ?? String(res.status), body?.message ?? res.statusText, body?.details);
  return body as T;
}

export interface Company { id: string; code: string; name: string; baseCurrency: string; facilities: { id: string; code: string; name: string }[] }
export interface Account { id: string; code: string; name: string; type: string; controlType: string; isPostable: boolean; active: boolean }
export interface Period { id: string; code: string; startDate: string; endDate: string; status: 'OPEN' | 'SOFT_CLOSED' | 'LOCKED' }
export interface JournalLine { id: string; lineNo: number; accountId: string; currency: string; debit: string; credit: string; description: string | null; account?: { code: string; name: string } }
export interface Journal {
  id: string; journalNo: string | null; journalDate: string; description: string; status: string; source: string;
  sourceEntityType: string | null; sourceEntityId: string | null; sourceVersion: number | null; createdBy: string;
  approvedBy: string | null; postedAt: string | null; reversalOfId: string | null; contentHash: string | null; lines?: JournalLine[];
}
export interface InboxEvent {
  id: string; sourceSystem: string; eventId: string; eventType: string; sourceEntityType: string; sourceEntityId: string;
  sourceVersion: number; status: string; attempts: number; lastError: string | null; receivedAt: string; processedAt: string | null;
}
export interface TrialBalance {
  rows: { accountId: string; accountCode: string; accountName: string; accountType: string; currency: string; debit: string; credit: string; balance: string }[];
  totals: { currency: string; debit: string; credit: string; balanced: boolean }[];
}
