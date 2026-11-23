import { PrismaClient, AccountType, ControlAccountType } from '@prisma/client';

/**
 * Reference data used by the dev seed and by integration tests.
 * `suffix` lets tests create isolated companies in a shared database.
 */
export async function seedReference(prisma: PrismaClient, suffix = '') {
  const company = await prisma.company.create({
    data: { code: `HOSP${suffix}`, name: `SynergyOne Demo Hospital Group${suffix ? ' ' + suffix : ''}`, baseCurrency: 'KES' },
  });
  const nbo = await prisma.facility.create({
    data: { companyId: company.id, code: `NBO${suffix}`, name: 'Nairobi Main Hospital', externalId: `clini-fac-nbo${suffix}` },
  });
  const ksm = await prisma.facility.create({
    data: { companyId: company.id, code: `KSM${suffix}`, name: 'Kisumu Satellite Clinic', externalId: `clini-fac-ksm${suffix}` },
  });
  for (const f of [nbo, ksm]) {
    await prisma.department.createMany({
      data: [
        { facilityId: f.id, code: 'OPD', name: 'Outpatient' },
        { facilityId: f.id, code: 'LAB', name: 'Laboratory' },
        { facilityId: f.id, code: 'PHARM', name: 'Pharmacy' },
      ],
    });
  }

  const defs: [string, string, AccountType, ControlAccountType?][] = [
    ['1000', 'Bank - Operating (KES)', 'ASSET', 'BANK'],
    ['1050', 'M-PESA Paybill Clearing', 'ASSET', 'BANK'],
    ['1100', 'Debtors - SHA', 'ASSET', 'AR_CONTROL'],
    ['1110', 'Debtors - Private Insurers', 'ASSET', 'AR_CONTROL'],
    ['1120', 'Debtors - Corporate', 'ASSET', 'AR_CONTROL'],
    ['1130', 'Debtors - Patients', 'ASSET', 'AR_CONTROL'],
    ['1500', 'Prepayments', 'ASSET'],
    ['1999', 'Suspense', 'ASSET', 'SUSPENSE'],
    ['2000', 'Trade Creditors', 'LIABILITY', 'AP_CONTROL'],
    ['2100', 'Net Salaries Payable', 'LIABILITY', 'PAYROLL_CONTROL'],
    ['2110', 'PAYE Payable', 'LIABILITY', 'STATUTORY_CONTROL'],
    ['2200', 'Doctors Fund Payable', 'LIABILITY', 'DOCTOR_FUND_CONTROL'],
    ['2300', 'Accrued Expenses', 'LIABILITY'],
    ['3000', 'Retained Earnings', 'EQUITY'],
    ['4000', 'Revenue - Consultation', 'REVENUE'],
    ['4010', 'Revenue - Laboratory', 'REVENUE'],
    ['4020', 'Revenue - Pharmacy', 'REVENUE'],
    ['5000', 'Salaries and Wages', 'EXPENSE'],
    ['6000', 'Medical Supplies', 'EXPENSE'],
    ['6100', 'Utilities', 'EXPENSE'],
  ];
  const accounts: Record<string, string> = {};
  for (const [code, name, type, controlType] of defs) {
    const a = await prisma.account.create({
      data: { companyId: company.id, code, name, type, controlType: controlType ?? 'NONE', normalBalance: type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT' },
    });
    accounts[code] = a.id;
  }
  const maps: [string, string][] = [
    ['AR_CONTROL:SHA', '1100'],
    ['AR_CONTROL:PRIVATE_INSURER', '1110'],
    ['AR_CONTROL:CORPORATE', '1120'],
    ['AR_CONTROL:GOVERNMENT', '1120'],
    ['AR_CONTROL:PATIENT', '1130'],
    ['AR_CONTROL:STAFF', '1130'],
    ['AR_CONTROL:DONOR', '1120'],
    ['REVENUE:CONSULTATION', '4000'],
    ['REVENUE:LAB', '4010'],
    ['REVENUE:PHARMACY', '4020'],
  ];
  await prisma.accountMapping.createMany({ data: maps.map(([mappingKey, code]) => ({ companyId: company.id, mappingKey, accountId: accounts[code] })) });

  const periods: Record<string, string> = {};
  for (let m = 1; m <= 12; m++) {
    const code = `2026-${String(m).padStart(2, '0')}`;
    const start = new Date(Date.UTC(2026, m - 1, 1));
    const end = new Date(Date.UTC(2026, m, 0));
    const p = await prisma.fiscalPeriod.create({ data: { companyId: company.id, code, startDate: start, endDate: end } });
    periods[code] = p.id;
  }

  const mk = async (email: string, displayName: string, role: string, facilityId: string | null = null) => {
    const u = await prisma.user.create({ data: { email: email.replace('@', `${suffix.toLowerCase()}@`), displayName } });
    await prisma.roleAssignment.create({ data: { userId: u.id, role, companyId: company.id, facilityId } });
    return { id: u.id, roles: [{ role, companyId: company.id, facilityId }] };
  };
  const users = {
    maker: await mk('accountant@demo.fintrack.local', 'Amina Accountant', 'ACCOUNTANT'),
    checker: await mk('chief@demo.fintrack.local', 'Brian Chief Accountant', 'CHIEF_ACCOUNTANT'),
    controller: await mk('controller@demo.fintrack.local', 'Carol Finance Controller', 'FINANCE_CONTROLLER'),
    auditor: await mk('auditor@demo.fintrack.local', 'Dan Internal Auditor', 'AUDITOR'),
    ksmAccountant: await mk('ksm.accountant@demo.fintrack.local', 'Esther KSM Accountant', 'ACCOUNTANT', ksm.id),
  };

  return { company, facilities: { nbo, ksm }, accounts, periods, users };
}

export type Reference = Awaited<ReturnType<typeof seedReference>>;
