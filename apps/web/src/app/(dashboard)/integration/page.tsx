'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { api, InboxEvent } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { cn } from '@/lib/utils';

const FILTERS = ['', 'RECEIVED', 'PROCESSED', 'FAILED', 'DEAD_LETTER', 'IGNORED_DUPLICATE'];

export default function IntegrationPage() {
  const [status, setStatus] = useState('');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['inbox', status || 'ALL'], queryFn: () => api<InboxEvent[]>(`/integration/inbox${status ? `?status=${status}` : ''}`) });
  const replay = useMutation({
    mutationFn: (id: string) => api(`/integration/inbox/${id}/replay`, { method: 'POST', body: '{}' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  });
  return (
    <>
      <PageTitle title="Integration inbox" crumbs={[{ label: 'Integration inbox' }]} />
      {(q.error || replay.error) && <div className="mb-4"><ErrorNotice error={q.error ?? replay.error} /></div>}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-stroke px-6 py-4 dark:border-stroke-dark">
          {FILTERS.map((s) => (
            <button key={s || 'all'} onClick={() => setStatus(s)}
              className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition', status === s ? 'bg-primary text-white' : 'bg-gray-2 text-dark-4 hover:text-dark dark:bg-white/5 dark:text-dark-6')}>
              {s ? s.replace(/_/g, ' ').toLowerCase() : 'all'}
            </button>
          ))}
        </div>
        <Table>
          <THead><tr><TH>Received</TH><TH>Source</TH><TH>Event type</TH><TH>Entity</TH><TH>Attempts</TH><TH>Status</TH><TH>Last error</TH><TH /></tr></THead>
          <tbody>
            {q.data?.map((e) => (
              <TR key={e.id}>
                <TD>{new Date(e.receivedAt).toLocaleString('en-KE')}</TD>
                <TD>{e.sourceSystem}</TD>
                <TD className="font-mono text-xs">{e.eventType}</TD>
                <TD>{e.sourceEntityType} {e.sourceEntityId} <span className="text-dark-5">v{e.sourceVersion}</span></TD>
                <TD>{e.attempts}</TD>
                <TD><StatusBadge status={e.status} /></TD>
                <TD className="max-w-[280px] truncate text-dark-5" title={e.lastError ?? ''}>{e.lastError ?? '—'}</TD>
                <TD className="text-right">
                  {(e.status === 'DEAD_LETTER' || e.status === 'FAILED') && (
                    <Button size="sm" variant="outline" onClick={() => replay.mutate(e.id)}><RotateCcw size={14} /> Replay</Button>
                  )}
                </TD>
              </TR>
            ))}
            {!q.isLoading && !q.data?.length && <EmptyRow cols={8}>No events.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
