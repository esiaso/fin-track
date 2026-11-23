'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApInvoiceDetail } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { formatAmount, formatDate } from '@/lib/utils';

export default function ApInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['ap-invoice', id], queryFn: () => api<ApInvoiceDetail>(`/ap/invoices/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ap-invoice', id] });
    qc.invalidateQueries({ queryKey: ['ap-invoices'] });
    qc.invalidateQueries({ queryKey: ['ap-exceptions'] });
  };
  const override = useMutation({ mutationFn: (exId: string) => api(`/ap/exceptions/${exId}/override`, { method: 'POST', body: JSON.stringify({ note }) }), onSuccess: () => { setNote(''); refresh(); } });
  const approve = useMutation({ mutationFn: () => api(`/ap/invoices/${id}/approve`, { method: 'POST', body: '{}' }), onSuccess: refresh });
  const control = useMutation({ mutationFn: (state: string) => api(`/ap/invoices/${id}/control`, { method: 'POST', body: JSON.stringify({ state, reason }) }), onSuccess: () => { setReason(''); refresh(); } });
  const err = q.error ?? override.error ?? approve.error ?? control.error;
  const inv = q.data;

  return (
    <>
      <PageTitle title={inv ? `${inv.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice'} ${inv.invoiceNumber}` : 'Supplier invoice'} crumbs={[{ label: 'Supplier invoices', href: '/ap/invoices' }, { label: inv?.invoiceNumber ?? '…' }]}
        action={inv ? <div className="flex gap-2"><StatusBadge status={inv.matchStatus} /><StatusBadge status={inv.status} />{inv.controlState !== 'NONE' && <StatusBadge status={inv.controlState} />}</div> : null} />
      {err ? <div className="mb-4"><ErrorNotice error={err} /></div> : null}
      {inv && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 space-y-6 xl:col-span-8">
            <Card>
              <CardHeader title={inv.supplier.name} subtitle={`${inv.matchType.replace('_', '-').toLowerCase()} match${inv.po ? ` · PO ${inv.po.poNumber}` : ''} · source ${inv.sourceEntityId} v${inv.sourceVersion}`} />
              <div className="mt-4">
                <Table>
                  <THead><tr><TH>#</TH><TH>Description</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit price</TH><TH className="text-right">Net</TH><TH className="text-right">Tax</TH></tr></THead>
                  <tbody>
                    {inv.lines.map((l) => (
                      <TR key={l.id}><TD>{l.lineNo}</TD><TD>{l.description}{l.expenseKey && <span className="ml-2 text-xs text-dark-5">{l.expenseKey}</span>}</TD><TD className="text-right">{Number(l.qty)}</TD><TD className="text-right">{formatAmount(l.unitPrice, inv.currency)}</TD><TD className="text-right">{formatAmount(l.netAmount, inv.currency)}</TD><TD className="text-right">{formatAmount(l.taxAmount, inv.currency)}</TD></TR>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>

            <Card>
              <CardHeader title="Match exceptions" subtitle="Mismatches are never posted silently. A different person must approve after an override." />
              <CardBody className="space-y-3">
                {inv.exceptions.map((e) => (
                  <div key={e.id} className="rounded-lg border border-stroke p-4 dark:border-stroke-dark">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2"><StatusBadge status={e.status === 'OPEN' ? 'EXCEPTION' : e.status} label={e.status === 'OPEN' ? 'Open' : undefined} /><span className="font-semibold text-dark dark:text-white">{e.type.replace(/_/g, ' ')}</span>{e.lineNo && <span className="text-sm">line {e.lineNo}</span>}</div>
                      {e.expected && <span className="text-sm">expected <strong className="text-dark dark:text-white">{e.expected}</strong> · got <strong className="text-dark dark:text-white">{e.actual}</strong></span>}
                    </div>
                    <p className="mt-2 text-sm">{e.message}</p>
                    {e.note && <p className="mt-1 text-sm italic">Override note: {e.note}</p>}
                    {e.status === 'OPEN' && (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input className="input" placeholder="Override justification" value={note} onChange={(x) => setNote(x.target.value)} />
                        <Button variant="outline" disabled={note.length < 3 || override.isPending} onClick={() => override.mutate(e.id)}>Override</Button>
                      </div>
                    )}
                  </div>
                ))}
                {!inv.exceptions.length && <p className="text-sm">No exceptions. The invoice matched within tolerance.</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Settlements" />
              <div className="mt-4">
                <Table>
                  <THead><tr><TH>Date</TH><TH>Source</TH><TH className="text-right">Amount</TH><TH>State</TH></tr></THead>
                  <tbody>
                    {inv.allocations.map((a) => (
                      <TR key={a.id}><TD>{formatDate(a.createdAt)}</TD><TD>{a.sourceType.replace('_', ' ').toLowerCase()}</TD><TD className="text-right">{formatAmount(a.amount, inv.currency)}</TD><TD>{a.reversedAt ? <StatusBadge status="REVERSED" /> : <StatusBadge status="POSTED" label="Applied" />}</TD></TR>
                    ))}
                    {!inv.allocations.length && <EmptyRow cols={4}>Nothing settled yet.</EmptyRow>}
                  </tbody>
                </Table>
              </div>
            </Card>
          </div>

          <div className="col-span-12 space-y-6 xl:col-span-4">
            <Card>
              <CardHeader title="Amounts" />
              <CardBody>
                <dl className="space-y-3 text-sm">
                  {[['Subtotal', inv.subtotal], ['VAT', inv.taxAmount], ['Total', inv.total], ['Withholding at payment', inv.withholdingAmount], ['Retention', inv.retentionAmount], ['Settled', inv.amountSettled], ['Open', inv.amountOpen]].map(([k, v]) => (
                    <div key={k} className="flex justify-between"><dt>{k}</dt><dd className="font-medium text-dark dark:text-white">{formatAmount(v, inv.currency)}</dd></div>
                  ))}
                  <div className="flex justify-between border-t border-stroke pt-3 dark:border-stroke-dark"><dt>Invoice date</dt><dd className="text-dark dark:text-white">{formatDate(inv.invoiceDate)}</dd></div>
                  <div className="flex justify-between"><dt>Due date</dt><dd className="text-dark dark:text-white">{formatDate(inv.dueDate)}</dd></div>
                  {inv.journalId && <div className="flex justify-between"><dt>Journal</dt><dd><Link className="text-primary" href={`/journals/${inv.journalId}`}>View posting</Link></dd></div>}
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Actions" />
              <CardBody className="space-y-3">
                {inv.status === 'VALIDATED' && (inv.matchStatus === 'OVERRIDDEN' || inv.matchStatus === 'MATCHED') && (
                  <Button className="w-full" disabled={approve.isPending} onClick={() => approve.mutate()}>Approve and post</Button>
                )}
                <input className="input" placeholder="Reason" value={reason} onChange={(x) => setReason(x.target.value)} />
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" disabled={reason.length < 3} onClick={() => control.mutate('ON_HOLD')}>Hold</Button>
                  <Button variant="outline" size="sm" disabled={reason.length < 3} onClick={() => control.mutate('DISPUTED')}>Dispute</Button>
                  <Button variant="outline" size="sm" disabled={reason.length < 3 || inv.controlState === 'NONE'} onClick={() => control.mutate('NONE')}>Release</Button>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
