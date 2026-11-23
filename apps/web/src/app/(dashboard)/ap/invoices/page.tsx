'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApInvoiceRow } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { cn, formatAmount, formatDate } from '@/lib/utils';

const FILTERS: { label: string; q: string }[] = [
  { label: 'All', q: '' },
  { label: 'Exceptions', q: '&matchStatus=EXCEPTION' },
  { label: 'Posted', q: '&status=POSTED' },
  { label: 'Partially settled', q: '&status=PARTIALLY_SETTLED' },
  { label: 'Settled', q: '&status=SETTLED' },
];

export default function ApInvoicesPage() {
  const { companyId } = useCompany();
  const [f, setF] = useState(FILTERS[0]);
  const q = useQuery({ queryKey: ['ap-invoices', companyId, f.q], enabled: !!companyId, queryFn: () => api<{ items: ApInvoiceRow[]; total: number }>(`/ap/invoices?companyId=${companyId}${f.q}`) });
  return (
    <>
      <PageTitle title="Supplier invoices" crumbs={[{ label: 'Accounts payable' }, { label: 'Invoices' }]} />
      {q.error ? <div className="mb-4"><ErrorNotice error={q.error} /></div> : null}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-stroke px-6 py-4 dark:border-stroke-dark">
          {FILTERS.map((x) => (
            <button key={x.label} onClick={() => setF(x)} className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition', f.label === x.label ? 'bg-primary text-white' : 'bg-gray-2 text-dark-4 hover:text-dark dark:bg-white/5 dark:text-dark-6')}>{x.label}</button>
          ))}
          <span className="ml-auto self-center text-sm text-dark-5">{q.data?.total ?? 0} documents</span>
        </div>
        <Table>
          <THead><tr><TH>Invoice</TH><TH>Supplier</TH><TH>Date</TH><TH>Due</TH><TH className="text-right">Total</TH><TH className="text-right">Open</TH><TH>Match</TH><TH>Status</TH></tr></THead>
          <tbody>
            {q.data?.items.map((i) => (
              <TR key={i.id}>
                <TD><Link className="font-medium text-primary" href={`/ap/invoices/${i.id}`}>{i.invoiceNumber}</Link>{i.kind === 'CREDIT_NOTE' && <span className="ml-2 text-xs text-dark-5">credit note</span>}</TD>
                <TD>{i.supplier.name}</TD>
                <TD>{formatDate(i.invoiceDate)}</TD>
                <TD>{formatDate(i.dueDate)}</TD>
                <TD className="text-right">{formatAmount(i.total, i.currency)}</TD>
                <TD className="text-right font-medium">{formatAmount(i.amountOpen, i.currency)}</TD>
                <TD><StatusBadge status={i.matchStatus} /></TD>
                <TD className="space-x-1"><StatusBadge status={i.status} />{i.controlState !== 'NONE' && <StatusBadge status={i.controlState} />}</TD>
              </TR>
            ))}
            {!q.isLoading && !q.data?.items.length && <EmptyRow cols={8}>No supplier invoices yet. They arrive from SupplyTrack.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
