'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, InboxEvent, Journal } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { formatAmount, formatDate } from '@/lib/utils';
import { sum } from '@fintrack/shared';

type Detail = Journal & { sourceEvent: InboxEvent | null };

export default function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['journal', id], queryFn: () => api<Detail>(`/journals/${id}`) });
  const act = useMutation({
    mutationFn: (action: 'validate' | 'approve' | 'post' | 'reverse') =>
      api<Journal>(`/journals/${id}/${action}`, { method: 'POST', body: action === 'reverse' ? JSON.stringify({ reason }) : '{}' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal', id] });
      qc.invalidateQueries({ queryKey: ['journals'] });
    },
  });

  const j = q.data;
  const lines = j?.lines ?? [];
  const dr = sum(lines.map((l) => l.debit));
  const cr = sum(lines.map((l) => l.credit));
  const next: Record<string, 'validate' | 'approve' | 'post' | undefined> = { DRAFT: 'validate', VALIDATED: 'approve', APPROVED: 'post' };

  return (
    <>
      <PageTitle title={j?.journalNo ?? 'Draft journal'} crumbs={[{ label: 'Journals', href: '/journals' }, { label: j?.journalNo ?? 'Draft' }]} action={j ? <StatusBadge status={j.status} className="text-sm" /> : null} />
      {q.error ? <ErrorNotice error={q.error} /> : null}
      {act.error ? <div className="mb-4"><ErrorNotice error={act.error} /></div> : null}
      {j && (
        <div className="grid grid-cols-12 gap-6">
          <Card className="col-span-12 xl:col-span-8">
            <CardHeader title={j.description} subtitle={`${formatDate(j.journalDate)} · ${j.source}`} />
            <div className="mt-4">
              <Table>
                <THead><tr><TH>#</TH><TH>Account</TH><TH>Description</TH><TH className="text-right">Debit</TH><TH className="text-right">Credit</TH></tr></THead>
                <tbody>
                  {lines.map((l) => (
                    <TR key={l.id}>
                      <TD>{l.lineNo}</TD>
                      <TD><span className="font-medium">{l.account?.code}</span> <span className="text-dark-5">{l.account?.name}</span></TD>
                      <TD className="max-w-[260px] truncate text-dark-5">{l.description ?? '—'}</TD>
                      <TD className="text-right">{Number(l.debit) ? formatAmount(l.debit, l.currency) : ''}</TD>
                      <TD className="text-right">{Number(l.credit) ? formatAmount(l.credit, l.currency) : ''}</TD>
                    </TR>
                  ))}
                  <TR className="bg-gray-1 font-semibold dark:bg-white/[0.03]">
                    <TD /><TD>Total</TD><TD />
                    <TD className="text-right">{formatAmount(dr.toFixed(4))}</TD>
                    <TD className="text-right">{formatAmount(cr.toFixed(4))}</TD>
                  </TR>
                </tbody>
              </Table>
            </div>
          </Card>

          <div className="col-span-12 space-y-6 xl:col-span-4">
            <Card>
              <CardHeader title="Workflow" subtitle="Maker-checker: the creator cannot approve or post." />
              <CardBody className="space-y-3">
                {next[j.status] && (
                  <Button className="w-full" disabled={act.isPending} onClick={() => act.mutate(next[j.status]!)}>
                    {next[j.status] === 'validate' ? 'Validate' : next[j.status] === 'approve' ? 'Approve' : 'Post to ledger'}
                  </Button>
                )}
                {j.status === 'POSTED' && (
                  <>
                    <input className="input" placeholder="Reason for reversal" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <Button variant="danger" className="w-full" disabled={reason.length < 3 || act.isPending} onClick={() => act.mutate('reverse')}>Reverse journal</Button>
                  </>
                )}
                {j.status === 'REVERSED' && <p className="text-sm">This journal was reversed. Posted journals are never edited.</p>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Traceability" />
              <CardBody>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4"><dt>Source</dt><dd className="text-right font-medium text-dark dark:text-white">{j.source}</dd></div>
                  {j.sourceEntityId && <div className="flex justify-between gap-4"><dt>Source document</dt><dd className="text-right font-medium text-dark dark:text-white">{j.sourceEntityType} {j.sourceEntityId} v{j.sourceVersion}</dd></div>}
                  {j.sourceEvent && <div className="flex justify-between gap-4"><dt>Event</dt><dd className="truncate text-right font-mono text-xs text-dark dark:text-white">{j.sourceEvent.eventId}</dd></div>}
                  {j.reversalOfId && <div className="flex justify-between gap-4"><dt>Reverses</dt><dd><Link className="text-primary" href={`/journals/${j.reversalOfId}`}>original journal</Link></dd></div>}
                  <div className="flex justify-between gap-4"><dt>Posted</dt><dd className="text-right text-dark dark:text-white">{j.postedAt ? new Date(j.postedAt).toLocaleString('en-KE') : '—'}</dd></div>
                  {j.contentHash && <div><dt>Content hash</dt><dd className="mt-1 break-all font-mono text-xs text-dark dark:text-white">{j.contentHash}</dd></div>}
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
