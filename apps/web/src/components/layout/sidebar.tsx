'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { NAV } from './nav';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/journals') return pathname === '/journals' || /^\/journals\/(?!new)/.test(pathname);
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <>
      <div className={cn('fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={onClose} />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[290px] flex-col border-r border-stroke bg-white transition-transform duration-200 dark:border-stroke-dark dark:bg-surface-dark lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-6 py-5">
          <Link href="/" onClick={onClose}><Logo /></Link>
          <button className="rounded-md p-1 text-dark-5 lg:hidden" onClick={onClose} aria-label="Close menu"><X size={20} /></button>
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-6">
          {NAV.map((group) => (
            <div key={group.label} className="mb-6">
              <h3 className="mb-3 px-3.5 text-xs font-semibold uppercase tracking-wider text-dark-6">{group.label}</h3>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active = !item.soon && isActive(item.href);
                  const Icon = item.icon;
                  const content = (
                    <>
                      <Icon size={20} strokeWidth={1.75} className="shrink-0" />
                      <span className="flex-1">{item.title}</span>
                      {item.soon && <span className="rounded-full bg-gray-2 px-2 py-0.5 text-[10px] font-semibold uppercase text-dark-5 dark:bg-white/5 dark:text-dark-6">Soon</span>}
                    </>
                  );
                  const cls = cn(
                    'flex items-center gap-3 rounded-lg px-3.5 py-3 text-sm font-medium transition',
                    active ? 'bg-primary-soft text-primary dark:bg-white/10 dark:text-white' : 'text-dark-4 hover:bg-gray-2 hover:text-dark dark:text-dark-6 dark:hover:bg-white/5 dark:hover:text-white',
                    item.soon && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                  );
                  return (
                    <li key={item.title}>
                      {item.soon ? <span className={cls} aria-disabled="true">{content}</span> : <Link href={item.href} className={cls} onClick={onClose}>{content}</Link>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
