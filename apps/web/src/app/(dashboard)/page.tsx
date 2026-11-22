'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, Inbox, AlertTriangle, CalendarCheck2, ArrowUpRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, InboxEvent, Journal, Period, TrialBalance } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD, EmptyRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/notice';
import { formatAmount, formatDate } from '@/lib/utils';

const TYPE_COLORS: Record<string, string> = { ASSET: '#5750F1', LIABILITY: '#0ABEF9', EQUITY: '#8099EC', REVENUE: '#22AD5C', EXPENSE: '#F59E0B' };

function Stat({ icon: Icon, label, value, hint, tone }: { icon: typeof Inbox; label: string; value: string; hint: string; tone: string }) {
  return (
    <Card className="p-6">
      <div className="grid h-14 w-14 place-items-center rounded-full" style={{ background: `${tone}1A`, color: tone }}>
        <Icon size={26} />
      </div>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <p className="mb-1.5 text-2xl font-bold text-dark dark:text-white">{value}</p>
          <p className="text-sm font-medium text-dark-5 dark:text-dark-6">{label}</p>
        </div>
        <span className="text-xs font-medium text-dark-5 dark:text-dark-6">{hint}</span>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { companyId } = useCompany();
  const enabled = !!companyId;
  const posted = useQuery({ queryKey: ['journals', companyId, 'POSTED'], enabled, queryFn: () => api<{ items: Journal[]; total: number }>(`/journals?companyId=${companyId}&status=POSTED&take=8`) });
  const pending = useQuery({ queryKey: ['journals', companyId, 'APPROVED'], enabled, queryFn: () => api<{ total: number }>(`/journals?companyId=${companyId}&status=APPROVED&take=1`) });
  const periods = useQuery({ queryKey: ['periods', companyId], enabled, queryFn: () => api<Period[]>(`/periods?companyId=${companyId}`) });
  const tb = useQuery({ queryKey: ['tb', companyId], enabled, queryFn: () => api<TrialBalance>(`/reports/trial-balance?companyId=${companyId}`) });
  const dead = useQuery({ queryKey: ['inbox', 'DEAD_LETTER'], queryFn: () => api<InboxEvent[]>(`/integration/inbox?status=DEAD_LETTER`), retry: false });
  const processed = useQuery({ queryKey: ['inbox', 'PROCESSED'], queryFn: () => api<InboxEvent[]>(`/integration/inbox?status=PROCESSED`), retry: false });

  const byType = Object.entries(
    (tb.data?.rows ?? []).reduce<Record<string, number>>((acc, r) => {
      // Display-only aggregation; authoritative balances come from the API as decimal strings.
      const sign = r.accountType === 'ASSET' || r.accountType === 'EXPENSE' ? 1 : -1;
      acc[r.accountType] = (acc[r.accountType] ?? 0) + sign * Number(r.balance);
      return acc;
    }, {}),
  ).map(([type, value]) => ({ type, value: Math.round(value * 100) / 100 }));

  const openPeriod = periods.data?.find((p) => p.status === 'OPEN' && new Date(p.startDate) <= new Date() && new Date(p.endDate) >= new Date());
  const error = posted.error ?? periods.error;

  return (
    <div className="space-y-6">
      {error ? <ErrorNotice error={error} /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:gap-7">
        <Stat icon={BookOpenCheck} tone="#5750F1" label="Posted journals" value={String(posted.data?.total ?? '—')} hint={`${pending.data?.total ?? 0} awaiting posting`} />
        <Stat icon={Inbox} tone="#22AD5C" label="Events processed" value={processed.data ? String(processed.data.length) : '—'} hint="latest 50" />
        <Stat icon={AlertTriangle} tone="#F23030" label="Dead-lettered events" value={dead.data ? String(dead.data.length) : '—'} hint="needs review" />
        <Stat icon={CalendarCheck2} tone="#F59E0B" label="Current period" value={openPeriod?.code ?? '—'} hint={openPeriod ? 'open' : 'no open period'} />
      </div>

      <div className="grid grid-cols-12 gap-4 2xl:gap-7">
        <Card className="col-span-12 xl:col-span-7">
          <CardHeader title="Balances by account type" subtitle="Posted ledger, base currency, all periods" />
          <CardBody className="h-[340px]">
            {byType.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byType} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E6EBF1" />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip formatter={(v: number) => formatAmount(v.toFixed(2))} cursor={{ fill: 'rgba(87,80,241,0.06)' }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {byType.map((d) => <Cell key={d.type} fill={TYPE_COLORS[d.type] ?? '#5750F1'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="grid h-full place-items-center text-sm text-dark-5">No posted balances yet.</p>
            )}
          </CardBody>
        </Card>

        <Card className="col-span-12 xl:col-span-5">
          <CardHeader title="Trial balance check" subtitle="Debits must equal credits per currency" />
          <CardBody className="space-y-4">
            {(tb.data?.totals ?? []).map((t) => (
              <div key={t.currency} className="rounded-lg border border-stroke p-4 dark:border-stroke-dark">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-dark dark:text-white">{t.currency}</span>
                  <StatusBadge status={t.balanced ? 'POSTED' : 'DEAD_LETTER'} label={t.balanced ? 'Balanced' : 'Out of balance'} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-dark-5">Debits</dt><dd className="text-right font-medium text-dark dark:text-white">{formatAmount(t.debit, t.currency)}</dd>
                  <dt className="text-dark-5">Credits</dt><dd className="text-right font-medium text-dark dark:text-white">{formatAmount(t.credit, t.currency)}</dd>
                </dl>
              </div>
            ))}
            {!tb.data?.totals?.length && <p className="text-sm text-dark-5">Nothing posted yet.</p>}
            <Link href="/trial-balance" className="inline-flex items-center gap-1 text-sm font-medium text-primary">Open trial balance <ArrowUpRight size={16} /></Link>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Latest postings" action={<Link href="/journals" className="text-sm font-medium text-primary">View all</Link>} />
        <div className="mt-4">
          <Table>
            <THead><tr><TH>Journal</TH><TH>Date</TH><TH>Description</TH><TH>Source</TH><TH>Status</TH></tr></THead>
            <tbody>
              {(posted.data?.items ?? []).map((j) => (
                <TR key={j.id}>
                  <TD><Link className="font-medium text-primary" href={`/journals/${j.id}`}>{j.journalNo}</Link></TD>
                  <TD>{formatDate(j.journalDate)}</TD>
                  <TD className="max-w-[360px] truncate">{j.description}</TD>
                  <TD>{j.source}</TD>
                  <TD><StatusBadge status={j.status} /></TD>
                </TR>
              ))}
              {!posted.data?.items?.length && <EmptyRow cols={5}>No posted journals yet.</EmptyRow>}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
