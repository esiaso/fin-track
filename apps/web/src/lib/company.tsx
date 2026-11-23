'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { session } from './session';

const Ctx = createContext<{ companyId: string | null; setCompanyId: (id: string) => void }>({ companyId: null, setCompanyId: () => {} });

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [companyId, setState] = useState<string | null>(null);
  useEffect(() => setState(session.companyId()), []);
  const setCompanyId = (id: string) => {
    session.setCompanyId(id);
    setState(id);
  };
  return <Ctx.Provider value={{ companyId, setCompanyId }}>{children}</Ctx.Provider>;
}

export const useCompany = () => useContext(Ctx);
