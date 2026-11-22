'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, Journal } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { cn, formatDate } from '@/lib/utils';

const STATUSES = ['', 'DRAFT', 'VALIDATED', 'APPROVED', 'POSTED', 'REVERSED'];

export default function JournalsPage() {
  const { companyId } = useCompany();
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['journals', companyId, status || 'ALL'],
    enabled: !!companyId,
    queryFn: () => api<{ items: Journal[]; total: number }>(`/journals?companyId=${companyId}&take=100${status ? `&status=${status}` : ''}`),
  });

  return (
    <>
      <PageTitle title="Journals" crumbs={[{ label: 'Journals' }]} action={<Link href="/journals/new"><Button><Plus size={18} /> New journal</Button></Link>} />
      {q.error ? <div className="mb-4"><ErrorNotice error={q.error} /></div> : null}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-stroke px-6 py-4 dark:border-stroke-dark">
          {STATUSES.map((s) => (
            <button key={s || 'all'} onClick={() => setStatus(s)}
              className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition', status === s ? 'bg-primary text-white' : 'bg-gray-2 text-dark-4 hover:text-dark dark:bg-white/5 dark:text-dark-6')}>
              {s ? s.charAt(0) + s.slice(1).toLowerCase() : 'All'}
            </button>
          ))}
          <span className="ml-auto self-center text-sm text-dark-5">{q.data?.total ?? 0} journals</span>
        </div>
        <Table>
          <THead><tr><TH>Journal no.</TH><TH>Date</TH><TH>Description</TH><TH>Source</TH><TH>Source ref</TH><TH>Status</TH></tr></THead>
          <tbody>
            {(q.data?.items ?? []).map((j) => (
              <TR key={j.id}>
                <TD><Link className="font-medium text-primary" href={`/journals/${j.id}`}>{j.journalNo ?? 'Draft'}</Link></TD>
                <TD>{formatDate(j.journalDate)}</TD>
                <TD className="max-w-[380px] truncate">{j.description}</TD>
                <TD>{j.source}</TD>
                <TD className="text-dark-5">{j.sourceEntityId ? `${j.sourceEntityType} ${j.sourceEntityId}${j.sourceVersion ? ` v${j.sourceVersion}` : ''}` : '—'}</TD>
                <TD><StatusBadge status={j.status} /></TD>
              </TR>
            ))}
            {!q.isLoading && !q.data?.items?.length && <EmptyRow cols={6}>No journals match this filter.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
