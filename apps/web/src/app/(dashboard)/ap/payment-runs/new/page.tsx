'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, DueInvoice, PaymentRunRow } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { formatAmount, formatDate } from '@/lib/utils';
import { d, sum } from '@fintrack/shared';

export default function NewRunPage() {
  const router = useRouter();
  const { companyId } = useCompany();
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const due = useQuery({ queryKey: ['ap-due', companyId, asOf], enabled: !!companyId, queryFn: () => api<DueInvoice[]>(`/ap/due?companyId=${companyId}&asOf=${asOf}`) });
  useEffect(() => setAmounts({}), [asOf]);

  const selected = Object.entries(amounts).filter(([, v]) => v && Number(v) > 0);
  const invalid = selected.some(([id, v]) => {
    const row = due.data?.find((r) => r.id === id);
    return !row || !/^\d+(\.\d{1,4})?$/.test(v) || d(v).gt(d(row.payable));
  });
  const create = useMutation({
    mutationFn: () => api<PaymentRunRow>('/ap/payment-runs', { method: 'POST', body: JSON.stringify({ companyId, paymentDate, currency: 'KES', method, bankMappingKey: method === 'MPESA' ? 'BANK:MPESA' : 'BANK:DEFAULT', items: selected.map(([invoiceId, amount]) => ({ invoiceId, amount })) }) }),
    onSuccess: (r) => router.push(`/ap/payment-runs/${r.id}`),
  });

  return (
    <>
      <PageTitle title="New payment run" crumbs={[{ label: 'Payment runs', href: '/ap/payment-runs' }, { label: 'New' }]} />
      {(due.error || create.error) && <div className="mb-4"><ErrorNotice error={due.error ?? create.error} /></div>}
      <Card className="mb-6">
        <CardBody className="grid gap-5 md:grid-cols-3">
          <div><label className="label">Invoices due by</label><input type="date" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
          <div><label className="label">Payment date</label><input type="date" className="input" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
          <div><label className="label">Method</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option value="BANK_TRANSFER">Bank transfer</option><option value="MPESA">M-PESA</option><option value="CHEQUE">Cheque</option></select>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Payable invoices" subtitle="Partial payments are allowed. Amounts already scheduled in other runs and retention are excluded." />
        <div className="mt-4">
          <Table>
            <THead><tr><TH>Invoice</TH><TH>Supplier</TH><TH>Due</TH><TH className="text-right">Total</TH><TH className="text-right">Payable now</TH><TH className="text-right">Pay</TH></tr></THead>
            <tbody>
              {due.data?.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.invoiceNumber}</TD>
                  <TD>{r.supplier.name}</TD>
                  <TD>{formatDate(r.dueDate)}</TD>
                  <TD className="text-right">{formatAmount(r.total, r.currency)}</TD>
                  <TD className="text-right">{formatAmount(r.payable, r.currency)}</TD>
                  <TD className="w-48 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <input className="input w-32 text-right" inputMode="decimal" placeholder="0.00" value={amounts[r.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [r.id]: e.target.value })} />
                      <button className="text-xs font-medium text-primary" onClick={() => setAmounts({ ...amounts, [r.id]: d(r.payable).toFixed(2) })}>Full</button>
                    </div>
                  </TD>
                </TR>
              ))}
              {!due.isLoading && !due.data?.length && <EmptyRow cols={6}>Nothing payable by this date.</EmptyRow>}
            </tbody>
          </Table>
        </div>
        <CardBody className="flex flex-wrap items-center justify-end gap-4 border-t border-stroke dark:border-stroke-dark">
          <span className="text-sm">{selected.length} invoice(s) · <strong className="text-dark dark:text-white">{formatAmount(sum(selected.map(([, v]) => (/^\d+(\.\d+)?$/.test(v) ? v : '0'))).toFixed(2))}</strong></span>
          {invalid && <span className="text-sm text-red">An amount exceeds what is payable</span>}
          <Button disabled={!selected.length || invalid || create.isPending} onClick={() => create.mutate()}>Create run</Button>
        </CardBody>
      </Card>
    </>
  );
}
