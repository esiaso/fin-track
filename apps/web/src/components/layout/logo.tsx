export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <rect width="34" height="34" rx="9" fill="#5750F1" />
        <path d="M10 23V11h11M10 17h8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="24" cy="22" r="2.6" fill="#fff" />
      </svg>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-lg font-bold text-dark dark:text-white">FinTrack</span>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-dark-6">SynergyOne</span>
        </span>
      )}
    </span>
  );
}
