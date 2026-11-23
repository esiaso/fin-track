'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, PaymentRunRow } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { formatAmount, formatDate } from '@/lib/utils';
import { sum } from '@fintrack/shared';

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [refs, setRefs] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['ap-run', id], queryFn: () => api<PaymentRunRow>(`/ap/payment-runs/${id}`) });
  const done = () => { qc.invalidateQueries({ queryKey: ['ap-run', id] }); qc.invalidateQueries({ queryKey: ['ap-runs'] }); };
  const act = useMutation({ mutationFn: (a: 'approve' | 'execute' | 'cancel') => api(`/ap/payment-runs/${id}/${a}`, { method: 'POST', body: '{}' }), onSuccess: done });
  const res = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: 'PAID' | 'FAILED' }) =>
      api(`/ap/payment-items/${itemId}/result`, { method: 'POST', body: JSON.stringify(status === 'PAID' ? { status, bankReference: refs[itemId] || undefined } : { status, reason: refs[itemId] || 'Rejected by bank' }) }),
    onSuccess: done,
  });
  const run = q.data;
  const total = run ? sum(run.items.map((i) => i.amount)) : null;
  return (
    <>
      <PageTitle title={run ? `Payment run ${run.runNo}` : 'Payment run'} crumbs={[{ label: 'Payment runs', href: '/ap/payment-runs' }, { label: run?.runNo ?? '…' }]} action={run ? <StatusBadge status={run.status} /> : null} />
      {(q.error || act.error || res.error) && <div className="mb-4"><ErrorNotice error={q.error ?? act.error ?? res.error} /></div>}
      {run && (
        <div className="grid grid-cols-12 gap-6">
          <Card className="col-span-12 2xl:col-span-9">
            <Table>
              <THead><tr><TH>Invoice</TH><TH>Supplier</TH><TH className="text-right">Gross</TH><TH className="text-right">Withholding</TH><TH className="text-right">Net paid</TH><TH>Status</TH><TH>Bank result</TH></tr></THead>
              <tbody>
                {run.items.map((i) => (
                  <TR key={i.id}>
                    <TD className="font-medium">{i.invoice?.invoiceNumber}</TD>
                    <TD>{i.invoice?.supplier.name}</TD>
                    <TD className="text-right">{formatAmount(i.amount, run.currency)}</TD>
                    <TD className="text-right">{formatAmount(i.withholding, run.currency)}</TD>
                    <TD className="text-right">{formatAmount(i.netPaid, run.currency)}</TD>
                    <TD><StatusBadge status={i.status} />{i.failureReason && <span className="ml-2 text-xs text-red">{i.failureReason}</span>}</TD>
                    <TD>
                      {run.status === 'EXECUTING' || run.status === 'COMPLETED' ? (
                        i.status === 'PENDING' || i.status === 'PAID' ? (
                          <div className="flex items-center gap-2">
                            {i.status === 'PENDING' && <input className="input h-8 w-28 py-1" placeholder="Ref / reason" value={refs[i.id!] ?? ''} onChange={(e) => setRefs({ ...refs, [i.id!]: e.target.value })} />}
                            {i.status === 'PENDING' && <Button size="sm" variant="success" onClick={() => res.mutate({ itemId: i.id!, status: 'PAID' })}>Paid</Button>}
                            <Button size="sm" variant="outline" onClick={() => res.mutate({ itemId: i.id!, status: 'FAILED' })}>{i.status === 'PAID' ? 'Returned' : 'Failed'}</Button>
                            {i.bankReference && <span className="text-xs text-dark-5">{i.bankReference}</span>}
                          </div>
                        ) : null
                      ) : <span className="text-xs text-dark-5">after release</span>}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card className="col-span-12 2xl:col-span-3">
            <CardHeader title="Run" />
            <CardBody className="space-y-4 text-sm">
              <div className="flex justify-between"><span>Payment date</span><span className="text-dark dark:text-white">{formatDate(run.paymentDate)}</span></div>
              <div className="flex justify-between"><span>Method</span><span className="text-dark dark:text-white">{run.method.replace('_', ' ').toLowerCase()}</span></div>
              <div className="flex justify-between"><span>Total gross</span><span className="font-semibold text-dark dark:text-white">{formatAmount(total!.toFixed(4), run.currency)}</span></div>
              {run.status === 'DRAFT' && <Button className="w-full" onClick={() => act.mutate('approve')}>Approve</Button>}
              {run.status === 'APPROVED' && <Button className="w-full" onClick={() => act.mutate('execute')}>Release to bank</Button>}
              {(run.status === 'DRAFT' || run.status === 'APPROVED') && <Button variant="outline" className="w-full" onClick={() => act.mutate('cancel')}>Cancel run</Button>}
              <p className="text-xs">The preparer cannot approve or release their own run. Ledger postings happen only when the bank confirms payment.</p>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
