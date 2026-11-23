'use client';

import { Menu, Search, Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Company } from '@/lib/api';
import { session } from '@/lib/session';
import { useCompany } from '@/lib/company';
import { ThemeToggle } from './theme-toggle';
import { Logo } from './logo';

export function Header({ onMenu, title }: { onMenu: () => void; title: string }) {
  const [claims, setClaims] = useState<ReturnType<typeof session.claims>>(null);
  useEffect(() => setClaims(session.claims()), []);
  const { companyId, setCompanyId } = useCompany();
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api<Company[]>('/companies'), retry: false });

  useEffect(() => {
    if (!companyId && companies.data?.length) setCompanyId(companies.data[0].id);
  }, [companyId, companies.data, setCompanyId]);

  const role = claims?.roles?.[0]?.role?.replace(/_/g, ' ').toLowerCase() ?? 'not signed in';
  const initials = (claims?.roles?.[0]?.role ?? 'FT').split('_').map((p) => p[0]).join('').slice(0, 2);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-stroke bg-white px-4 py-4 dark:border-stroke-dark dark:bg-surface-dark md:px-6 2xl:px-10">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="rounded-lg border border-stroke p-2 text-dark dark:border-stroke-dark dark:text-white lg:hidden" aria-label="Open menu"><Menu size={20} /></button>
        <span className="lg:hidden"><Logo compact /></span>
        <div className="hidden lg:block">
          <h1 className="text-xl font-bold text-dark dark:text-white">{title}</h1>
          <p className="text-sm text-dark-5 dark:text-dark-6">Hospital finance system of record</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        <label className="relative hidden w-full max-w-[300px] md:block">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-6" />
          <input placeholder="Search journals, events…" className="w-full rounded-full border border-stroke bg-gray-2 py-2.5 pl-11 pr-4 text-sm text-dark outline-none focus:border-primary dark:border-stroke-dark dark:bg-[#020D1A] dark:text-white" />
        </label>
        {companies.data && companies.data.length > 0 && (
          <select value={companyId ?? ''} onChange={(e) => setCompanyId(e.target.value)} aria-label="Company"
            className="hidden rounded-full border border-stroke bg-white px-4 py-2 text-sm font-medium text-dark outline-none dark:border-stroke-dark dark:bg-surface-dark dark:text-white sm:block">
            {companies.data.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        )}
        <ThemeToggle />
        <button className="relative grid h-10 w-10 place-items-center rounded-full border border-stroke bg-gray-2 text-dark dark:border-stroke-dark dark:bg-[#020D1A] dark:text-white" aria-label="Notifications">
          <Bell size={18} />
        </button>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-primary text-sm font-semibold uppercase text-white">{initials}</span>
          <span className="hidden text-left xl:block">
            <span className="block text-sm font-medium capitalize text-dark dark:text-white">{role}</span>
            <span className="block text-xs text-dark-5 dark:text-dark-6">{claims?.sub ? claims.sub.slice(0, 8) : 'Settings → add token'}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
