import Link from 'next/link';

export function PageTitle({ title, crumbs = [], action }: { title: string; crumbs?: { label: string; href?: string }[]; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-[26px] font-bold leading-[30px] text-dark dark:text-white">{title}</h2>
        <nav className="mt-1 text-sm">
          <ol className="flex items-center gap-2">
            <li><Link className="text-dark-5 hover:text-primary dark:text-dark-6" href="/">Dashboard</Link></li>
            {crumbs.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                <span className="text-dark-6">/</span>
                {c.href ? <Link className="text-dark-5 hover:text-primary dark:text-dark-6" href={c.href}>{c.label}</Link> : <span className="font-medium text-primary">{c.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      </div>
      {action}
    </div>
  );
}
