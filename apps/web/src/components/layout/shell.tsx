'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { NAV } from './nav';

export function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const all = NAV.flatMap((g) => g.items);
  const title =
    all.find((i) => i.href === pathname)?.title ??
    all.filter((i) => i.href !== '/' && pathname.startsWith(i.href + '/')).sort((a, b) => b.href.length - a.href.length)[0]?.title ??
    'FinTrack';
  return (
    <div className="flex min-h-screen">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setOpen(true)} title={title} />
        <main className="mx-auto w-full max-w-screen-2xl flex-1 p-4 md:p-6 2xl:p-10">{children}</main>
      </div>
    </div>
  );
}
