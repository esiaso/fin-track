'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { session } from '@/lib/session';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageTitle } from '@/components/page-title';

export default function SettingsPage() {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => setToken(session.token() ?? ''), []);
  return (
    <>
      <PageTitle title="Settings" crumbs={[{ label: 'Settings' }]} />
      <Card className="max-w-3xl">
        <CardHeader title="Developer sign-in" subtitle="Paste a JWT printed by `prisma db seed`. Production uses SynergyOne single sign-on." />
        <CardBody className="space-y-4">
          <textarea className="input min-h-[120px] font-mono text-xs" value={token} onChange={(e) => { setToken(e.target.value.trim()); setSaved(false); }} placeholder="eyJhbGciOi…" />
          <div className="flex items-center gap-3">
            <Button onClick={() => { session.setToken(token || null); session.setCompanyId(null); qc.clear(); setSaved(true); window.location.href = '/'; }}>Save token</Button>
            <Button variant="outline" onClick={() => { session.setToken(null); setToken(''); qc.clear(); }}>Sign out</Button>
            {saved && <span className="text-sm text-green">Saved</span>}
          </div>
        </CardBody>
      </Card>
    </>
  );
}
