import {
  LayoutDashboard, BookOpenText, FileWarning, Wallet, Clock3, FilePlus2, Scale, CalendarClock, Inbox, ShieldCheck, Settings,
  Receipt, Truck, Users, Stethoscope, PiggyBank, Landmark, Target, type LucideIcon,
} from 'lucide-react';

export interface NavItem { title: string; href: string; icon: LucideIcon; soon?: boolean }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    label: 'Main menu',
    items: [{ title: 'Dashboard', href: '/', icon: LayoutDashboard }],
  },
  {
    label: 'General ledger',
    items: [
      { title: 'Journals', href: '/journals', icon: BookOpenText },
      { title: 'New journal', href: '/journals/new', icon: FilePlus2 },
      { title: 'Trial balance', href: '/trial-balance', icon: Scale },
      { title: 'Periods', href: '/periods', icon: CalendarClock },
    ],
  },
  {
    label: 'Accounts payable',
    items: [
      { title: 'Supplier invoices', href: '/ap/invoices', icon: Truck },
      { title: 'Match exceptions', href: '/ap/exceptions', icon: FileWarning },
      { title: 'Payment runs', href: '/ap/payment-runs', icon: Wallet },
      { title: 'Supplier ageing', href: '/ap/ageing', icon: Clock3 },
    ],
  },
  {
    label: 'Sub-ledgers',
    items: [
      { title: 'Receivables & claims', href: '#', icon: Receipt, soon: true },
      { title: 'Payroll liabilities', href: '#', icon: Users, soon: true },
      { title: "Doctors' fees", href: '#', icon: Stethoscope, soon: true },
      { title: 'Budgets & vote heads', href: '#', icon: PiggyBank, soon: true },
      { title: 'Cash & bank', href: '#', icon: Landmark, soon: true },
      { title: 'KPI scorecards', href: '#', icon: Target, soon: true },
    ],
  },
  {
    label: 'Control',
    items: [
      { title: 'Integration inbox', href: '/integration', icon: Inbox },
      { title: 'Audit trail', href: '/audit', icon: ShieldCheck },
      { title: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];
