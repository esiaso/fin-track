'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { sum } from '@fintrack/shared';
import { Account, api, Journal } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/notice';
import { PageTitle } from '@/components/page-title';

const amount = z.string().regex(/^\d{1,16}(\.\d{1,4})?$/, 'Max 4 decimals');
const schema = z
  .object({
    journalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().min(3).max(500),
    lines: z.array(z.object({ accountId: z.string().uuid('Pick an account'), debit: amount, credit: amount, description: z.string().max(500).optional() })).min(2),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((l, i) => {
      if ((Number(l.debit) === 0) === (Number(l.credit) === 0)) ctx.addIssue({ code: 'custom', path: ['lines', i, 'debit'], message: 'Enter a debit or a credit' });
    });
    const dr = sum(v.lines.map((l) => l.debit || '0'));
    const cr = sum(v.lines.map((l) => l.credit || '0'));
    if (!dr.eq(cr)) ctx.addIssue({ code: 'custom', path: ['lines'], message: `Out of balance by ${dr.minus(cr).toFixed(2)}` });
  });
type FormValues = z.infer<typeof schema>;

export default function NewJournalPage() {
  const router = useRouter();
  const { companyId } = useCompany();
  const [idemKey] = useState(() => crypto.randomUUID());
  const accounts = useQuery({ queryKey: ['accounts', companyId], enabled: !!companyId, queryFn: () => api<Account[]>(`/accounts?companyId=${companyId}`) });
  const manual = useMemo(() => (accounts.data ?? []).filter((a) => a.isPostable && a.active && a.controlType === 'NONE'), [accounts.data]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      journalDate: new Date().toISOString().slice(0, 10),
      description: '',
      lines: [{ accountId: '', debit: '0', credit: '0' }, { accountId: '', debit: '0', credit: '0' }],
    },
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const watched = form.watch('lines');
  const dr = sum(watched.map((l) => (/^\d+(\.\d+)?$/.test(l.debit) ? l.debit : '0')));
  const cr = sum(watched.map((l) => (/^\d+(\.\d+)?$/.test(l.credit) ? l.credit : '0')));

  const create = useMutation({
    mutationFn: (v: FormValues) =>
      api<{ journal: Journal }>('/journals', {
        method: 'POST',
        idempotencyKey: idemKey,
        body: JSON.stringify({ companyId, ...v, lines: v.lines.map((l) => ({ ...l, currency: 'KES' })) }),
      }),
    onSuccess: (r) => router.push(`/journals/${r.journal.id}`),
  });

  const err = form.formState.errors;
  return (
    <>
      <PageTitle title="New journal" crumbs={[{ label: 'Journals', href: '/journals' }, { label: 'New' }]} />
      <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-6">
        {create.error ? <ErrorNotice error={create.error} /> : null}
        <Card>
          <CardHeader title="Journal details" subtitle="Manual journals cannot touch sub-ledger control accounts. A second person must approve and post." />
          <CardBody className="grid gap-5 md:grid-cols-3">
            <div>
              <label className="label" htmlFor="journalDate">Journal date</label>
              <input id="journalDate" type="date" className="input" {...form.register('journalDate')} />
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="description">Description</label>
              <input id="description" className="input" placeholder="e.g. Accrue November utilities" {...form.register('description')} />
              {err.description && <p className="mt-1 text-xs text-red">{err.description.message}</p>}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Lines" subtitle="Amounts in KES" action={<Button type="button" variant="outline" size="sm" onClick={() => lines.append({ accountId: '', debit: '0', credit: '0' })}><Plus size={16} /> Add line</Button>} />
          <CardBody className="space-y-3">
            {lines.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-12 items-start gap-3 rounded-lg border border-stroke p-3 dark:border-stroke-dark">
                <div className="col-span-12 md:col-span-5">
                  <select className="input" {...form.register(`lines.${i}.accountId`)}>
                    <option value="">Select account…</option>
                    {manual.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                  {err.lines?.[i]?.accountId && <p className="mt-1 text-xs text-red">{err.lines[i]?.accountId?.message}</p>}
                </div>
                <div className="col-span-5 md:col-span-3">
                  <input className="input text-right" inputMode="decimal" placeholder="Debit" {...form.register(`lines.${i}.debit`)} />
                  {err.lines?.[i]?.debit && <p className="mt-1 text-xs text-red">{err.lines[i]?.debit?.message}</p>}
                </div>
                <div className="col-span-5 md:col-span-3">
                  <input className="input text-right" inputMode="decimal" placeholder="Credit" {...form.register(`lines.${i}.credit`)} />
                </div>
                <div className="col-span-2 md:col-span-1 flex justify-end">
                  <Button type="button" variant="ghost" size="icon" disabled={lines.fields.length <= 2} onClick={() => lines.remove(i)} aria-label="Remove line"><Trash2 size={16} /></Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-end gap-6 border-t border-stroke pt-4 text-sm dark:border-stroke-dark">
              <span>Debits <strong className="ml-1 text-dark dark:text-white">{dr.toFixed(2)}</strong></span>
              <span>Credits <strong className="ml-1 text-dark dark:text-white">{cr.toFixed(2)}</strong></span>
              <span className={dr.eq(cr) ? 'font-medium text-green' : 'font-medium text-red'}>{dr.eq(cr) ? 'Balanced' : `Difference ${dr.minus(cr).toFixed(2)}`}</span>
            </div>
            {err.lines?.root?.message || (err.lines as { message?: string } | undefined)?.message ? (
              <p className="text-right text-xs text-red">{err.lines?.root?.message ?? (err.lines as { message?: string }).message}</p>
            ) : null}
          </CardBody>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={create.isPending || !companyId}>{create.isPending ? 'Saving…' : 'Save draft'}</Button>
        </div>
      </form>
    </>
  );
}
