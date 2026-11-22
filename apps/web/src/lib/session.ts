'use client';

// Dev-mode session: a JWT pasted in Settings (production uses the SynergyOne IdP via OIDC).
const TOKEN_KEY = 'fintrack.token';
const COMPANY_KEY = 'fintrack.companyId';

function safeGet(key: string) {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export const session = {
  token: () => safeGet(TOKEN_KEY),
  setToken: (t: string | null) => safeSet(TOKEN_KEY, t),
  companyId: () => safeGet(COMPANY_KEY),
  setCompanyId: (id: string | null) => safeSet(COMPANY_KEY, id),
  claims(): { sub?: string; roles?: { role: string }[] } | null {
    const t = safeGet(TOKEN_KEY);
    if (!t) return null;
    try {
      return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return null;
    }
  },
};
