'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AgeingRow, api } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';
import { formatAmount } from '@/lib/utils';
import { sum } from '@fintrack/shared';

const BUCKETS = [
  ['current', 'Current'],
  ['d1_30', '1–30'],
  ['d31_60', '31–60'],
  ['d61_90', '61–90'],
  ['d90_plus', '90+'],
] as const;

export default function AgeingPage() {
  const { companyId } = useCompany();
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const q = useQuery({ queryKey: ['ap-ageing', companyId, asOf], enabled: !!companyId, queryFn: () => api<AgeingRow[]>(`/ap/ageing?companyId=${companyId}&asOf=${asOf}`) });
  const rows = q.data ?? [];
  const chart = BUCKETS.map(([k, label]) => ({ label, value: Number(sum(rows.map((r) => r[k])).toFixed(2)) }));
  return (
    <>
      <PageTitle title="Supplier ageing" crumbs={[{ label: 'Accounts payable' }, { label: 'Ageing' }]} action={<input type="date" className="input w-auto" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="As of" />} />
      {q.error ? <div className="mb-4"><ErrorNotice error={q.error} /></div> : null}
      <Card className="mb-6">
        <CardHeader title="Payables by days past due" subtitle={`As of ${asOf}`} />
        <CardBody className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E6EBF1" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip formatter={(v: number) => formatAmount(v.toFixed(2))} cursor={{ fill: 'rgba(87,80,241,0.06)' }} />
              <Bar dataKey="value" fill="#5750F1" radius={[6, 6, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>
      <Card>
        <Table>
          <THead><tr><TH>Supplier</TH>{BUCKETS.map(([k, l]) => <TH key={k} className="text-right">{l}</TH>)}<TH className="text-right">Total</TH></tr></THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.supplier.id + r.currency}>
                <TD><span className="font-medium">{r.supplier.name}</span> <span className="text-xs text-dark-5">{r.supplier.code}</span></TD>
                {BUCKETS.map(([k]) => <TD key={k} className="text-right">{Number(r[k]) ? formatAmount(r[k], r.currency) : '—'}</TD>)}
                <TD className="text-right font-semibold">{formatAmount(r.total, r.currency)}</TD>
              </TR>
            ))}
            {!q.isLoading && !rows.length && <EmptyRow cols={7}>No open payables.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
