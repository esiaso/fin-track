'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Period } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { formatDate } from '@/lib/utils';

export default function PeriodsPage() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['periods', companyId], enabled: !!companyId, queryFn: () => api<Period[]>(`/periods?companyId=${companyId}`) });
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'soft-close' | 'lock' | 'reopen'; reason?: string }) =>
      api<Period>(`/periods/${id}/${action}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['periods', companyId] }),
  });
  return (
    <>
      <PageTitle title="Financial periods" crumbs={[{ label: 'Periods' }]} />
      {(q.error || act.error) && <div className="mb-4"><ErrorNotice error={q.error ?? act.error} /></div>}
      <Card>
        <Table>
          <THead><tr><TH>Period</TH><TH>Start</TH><TH>End</TH><TH>Status</TH><TH className="text-right">Actions</TH></tr></THead>
          <tbody>
            {q.data?.map((p) => (
              <TR key={p.id}>
                <TD className="font-medium">{p.code}</TD>
                <TD>{formatDate(p.startDate)}</TD>
                <TD>{formatDate(p.endDate)}</TD>
                <TD><StatusBadge status={p.status} /></TD>
                <TD className="space-x-2 text-right">
                  {p.status === 'OPEN' && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: p.id, action: 'soft-close' })}>Soft close</Button>}
                  {p.status === 'SOFT_CLOSED' && (
                    <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt('Reason for reopening'); if (reason) act.mutate({ id: p.id, action: 'reopen', reason }); }}>Reopen</Button>
                  )}
                  {p.status !== 'LOCKED' && <Button size="sm" variant="danger" onClick={() => window.confirm(`Lock ${p.code}? This is final.`) && act.mutate({ id: p.id, action: 'lock' })}>Lock</Button>}
                </TD>
              </TR>
            ))}
            {!q.isLoading && !q.data?.length && <EmptyRow cols={5}>No periods defined.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
