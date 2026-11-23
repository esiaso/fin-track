'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, MatchExceptionRow } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card } from '@/components/ui/card';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { formatAmount, formatDate } from '@/lib/utils';

export default function ExceptionsPage() {
  const { companyId } = useCompany();
  const q = useQuery({ queryKey: ['ap-exceptions', companyId], enabled: !!companyId, queryFn: () => api<MatchExceptionRow[]>(`/ap/exceptions?companyId=${companyId}`) });
  return (
    <>
      <PageTitle title="Match exceptions" crumbs={[{ label: 'Accounts payable' }, { label: 'Exceptions' }]} />
      {q.error ? <div className="mb-4"><ErrorNotice error={q.error} /></div> : null}
      <Card>
        <Table>
          <THead><tr><TH>Raised</TH><TH>Invoice</TH><TH>Supplier</TH><TH>Type</TH><TH>Detail</TH><TH className="text-right">Invoice total</TH></tr></THead>
          <tbody>
            {q.data?.map((e) => (
              <TR key={e.id}>
                <TD>{formatDate(e.createdAt)}</TD>
                <TD><Link className="font-medium text-primary" href={`/ap/invoices/${e.invoiceId}`}>{e.invoice?.invoiceNumber}</Link></TD>
                <TD>{e.invoice?.supplier.name}</TD>
                <TD className="font-medium">{e.type.replace(/_/g, ' ')}{e.lineNo ? ` · line ${e.lineNo}` : ''}</TD>
                <TD className="max-w-[340px] truncate text-dark-5" title={e.message}>{e.expected ? `expected ${e.expected}, got ${e.actual}` : e.message}</TD>
                <TD className="text-right">{e.invoice ? formatAmount(e.invoice.total, e.invoice.currency) : '—'}</TD>
              </TR>
            ))}
            {!q.isLoading && !q.data?.length && <EmptyRow cols={6}>No open exceptions.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
