import Link from 'next/link';
import { ApiError } from '@/lib/api';

export function ErrorNotice({ error }: { error: unknown }) {
  const e = error as ApiError;
  const unauth = e?.status === 401;
  return (
    <div className="rounded-lg border border-red/30 bg-red-soft px-4 py-3 text-sm text-red">
      {unauth ? (
        <>Not signed in. Add a token in <Link className="font-medium underline" href="/settings">Settings</Link>.</>
      ) : (
        <>{e?.code ? <strong className="mr-1">{e.code}</strong> : null}{e?.message ?? 'Request failed'}</>
      )}
    </div>
  );
}
