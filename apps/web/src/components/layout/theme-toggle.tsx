'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  const set = (value: boolean) => {
    setDark(value);
    document.documentElement.classList.toggle('dark', value);
    try { localStorage.setItem('fintrack.theme', value ? 'dark' : 'light'); } catch { /* ignore */ }
  };
  return (
    <div className="flex items-center rounded-full bg-gray-2 p-1 dark:bg-[#020D1A]" role="group" aria-label="Theme">
      {[{ v: false, I: Sun, l: 'Light' }, { v: true, I: Moon, l: 'Dark' }].map(({ v, I, l }) => (
        <button key={l} aria-label={l} aria-pressed={dark === v} onClick={() => set(v)}
          className={cn('grid h-8 w-8 place-items-center rounded-full transition', dark === v ? 'bg-white text-dark shadow-card dark:bg-surface-dark dark:text-white' : 'text-dark-5 dark:text-dark-6')}>
          <I size={16} />
        </button>
      ))}
    </div>
  );
}
