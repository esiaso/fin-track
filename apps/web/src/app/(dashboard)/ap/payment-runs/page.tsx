'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, PaymentRunRow } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { formatAmount, formatDate } from '@/lib/utils';
import { sum } from '@fintrack/shared';

export default function PaymentRunsPage() {
  const { companyId } = useCompany();
  const q = useQuery({ queryKey: ['ap-runs', companyId], enabled: !!companyId, queryFn: () => api<PaymentRunRow[]>(`/ap/payment-runs?companyId=${companyId}`) });
  return (
    <>
      <PageTitle title="Payment runs" crumbs={[{ label: 'Accounts payable' }, { label: 'Payment runs' }]} action={<Link href="/ap/payment-runs/new"><Button><Plus size={18} /> New run</Button></Link>} />
      {q.error ? <div className="mb-4"><ErrorNotice error={q.error} /></div> : null}
      <Card>
        <Table>
          <THead><tr><TH>Run</TH><TH>Payment date</TH><TH>Method</TH><TH className="text-right">Items</TH><TH className="text-right">Amount</TH><TH>Status</TH></tr></THead>
          <tbody>
            {q.data?.map((r) => (
              <TR key={r.id}>
                <TD><Link className="font-medium text-primary" href={`/ap/payment-runs/${r.id}`}>{r.runNo}</Link></TD>
                <TD>{formatDate(r.paymentDate)}</TD>
                <TD>{r.method.replace('_', ' ').toLowerCase()}</TD>
                <TD className="text-right">{r.items.length}</TD>
                <TD className="text-right">{formatAmount(sum(r.items.map((i) => i.amount)).toFixed(4), r.currency)}</TD>
                <TD><StatusBadge status={r.status} /></TD>
              </TR>
            ))}
            {!q.isLoading && !q.data?.length && <EmptyRow cols={6}>No payment runs yet.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
