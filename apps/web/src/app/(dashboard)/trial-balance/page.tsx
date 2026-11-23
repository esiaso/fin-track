'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Period, TrialBalance } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { formatAmount } from '@/lib/utils';

export default function TrialBalancePage() {
  const { companyId } = useCompany();
  const [periodId, setPeriodId] = useState('');
  const periods = useQuery({ queryKey: ['periods', companyId], enabled: !!companyId, queryFn: () => api<Period[]>(`/periods?companyId=${companyId}`) });
  const tb = useQuery({
    queryKey: ['tb', companyId, periodId],
    enabled: !!companyId,
    queryFn: () => api<TrialBalance>(`/reports/trial-balance?companyId=${companyId}${periodId ? `&periodId=${periodId}` : ''}`),
  });
  return (
    <>
      <PageTitle
        title="Trial balance"
        crumbs={[{ label: 'Trial balance' }]}
        action={
          <select className="input w-auto" value={periodId} onChange={(e) => setPeriodId(e.target.value)} aria-label="Period">
            <option value="">All periods</option>
            {periods.data?.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
        }
      />
      {tb.error ? <div className="mb-4"><ErrorNotice error={tb.error} /></div> : null}
      <Card>
        <Table>
          <THead><tr><TH>Code</TH><TH>Account</TH><TH>Type</TH><TH>Currency</TH><TH className="text-right">Debit</TH><TH className="text-right">Credit</TH><TH className="text-right">Balance</TH></tr></THead>
          <tbody>
            {tb.data?.rows.map((r) => (
              <TR key={r.accountId + r.currency}>
                <TD className="font-medium">{r.accountCode}</TD>
                <TD>{r.accountName}</TD>
                <TD className="text-dark-5">{r.accountType}</TD>
                <TD>{r.currency}</TD>
                <TD className="text-right">{formatAmount(r.debit, r.currency)}</TD>
                <TD className="text-right">{formatAmount(r.credit, r.currency)}</TD>
                <TD className="text-right font-medium">{formatAmount(r.balance, r.currency)}</TD>
              </TR>
            ))}
            {tb.data?.totals.map((t) => (
              <TR key={t.currency} className="bg-gray-1 font-semibold dark:bg-white/[0.03]">
                <TD /><TD>Total {t.currency}</TD><TD /><TD><StatusBadge status={t.balanced ? 'POSTED' : 'DEAD_LETTER'} label={t.balanced ? 'Balanced' : 'Out of balance'} /></TD>
                <TD className="text-right">{formatAmount(t.debit, t.currency)}</TD>
                <TD className="text-right">{formatAmount(t.credit, t.currency)}</TD>
                <TD />
              </TR>
            ))}
            {!tb.isLoading && !tb.data?.rows.length && <EmptyRow cols={7}>No postings for this selection.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
