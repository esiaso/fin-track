'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardBody } from '@/components/ui/card';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';

interface AuditRow { seq: string; occurredAt: string; actorId: string | null; action: string; entityType: string; entityId: string; hash: string }

export default function AuditPage() {
  const verify = useQuery({ queryKey: ['audit-verify'], queryFn: () => api<{ ok: boolean; checked: number; brokenAtSeq: string | null }>('/audit/verify') });
  const rows = useQuery({ queryKey: ['audit'], queryFn: () => api<AuditRow[]>('/audit') });
  const ok = verify.data?.ok;
  return (
    <>
      <PageTitle title="Audit trail" crumbs={[{ label: 'Audit trail' }]} />
      {(verify.error || rows.error) && <div className="mb-4"><ErrorNotice error={verify.error ?? rows.error} /></div>}
      {verify.data && (
        <Card className="mb-6">
          <CardBody className="flex items-center gap-4">
            <span className={`grid h-12 w-12 place-items-center rounded-full ${ok ? 'bg-green-soft text-green' : 'bg-red-soft text-red'}`}>{ok ? <ShieldCheck /> : <ShieldAlert />}</span>
            <div>
              <p className="font-semibold text-dark dark:text-white">{ok ? 'Hash chain intact' : `Chain broken at entry ${verify.data.brokenAtSeq}`}</p>
              <p className="text-sm">{verify.data.checked} entries verified. The audit log is append-only at the database level.</p>
            </div>
          </CardBody>
        </Card>
      )}
      <Card>
        <Table>
          <THead><tr><TH>#</TH><TH>When</TH><TH>Action</TH><TH>Entity</TH><TH>Actor</TH><TH>Hash</TH></tr></THead>
          <tbody>
            {rows.data?.map((r) => (
              <TR key={r.seq}>
                <TD>{r.seq}</TD>
                <TD>{new Date(r.occurredAt).toLocaleString('en-KE')}</TD>
                <TD className="font-medium">{r.action}</TD>
                <TD>{r.entityType} <span className="font-mono text-xs text-dark-5">{r.entityId.slice(0, 8)}</span></TD>
                <TD className="font-mono text-xs">{r.actorId ? r.actorId.slice(0, 8) : 'system'}</TD>
                <TD className="font-mono text-xs text-dark-5">{r.hash.slice(0, 16)}…</TD>
              </TR>
            ))}
            {!rows.isLoading && !rows.data?.length && <EmptyRow cols={6}>No audit entries.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
