import { Injectable } from '@nestjs/common';
import { AccountType, ControlAccountType, NormalBalance } from '@prisma/client';
import { Permission } from '@fintrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Conflict } from '../common/errors';
import { AuthUser } from '../auth/auth.types';
import { assertScope } from '../auth/scope';

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(user: AuthUser, companyId: string) {
    assertScope(user, Permission.LEDGER_READ, companyId);
    return this.prisma.account.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  }

  async create(
    user: AuthUser,
    input: { companyId: string; code: string; name: string; type: AccountType; controlType?: ControlAccountType; parentId?: string; isPostable?: boolean; currency?: string },
  ) {
    assertScope(user, Permission.ACCOUNT_MANAGE, input.companyId);
    const normalBalance: NormalBalance = input.type === 'ASSET' || input.type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
    return this.prisma.tx(async (tx) => {
      const exists = await tx.account.findUnique({ where: { companyId_code: { companyId: input.companyId, code: input.code } } });
      if (exists) throw Conflict('DUPLICATE_ACCOUNT', `Account ${input.code} already exists`);
      const a = await tx.account.create({ data: { ...input, normalBalance, currency: input.currency?.toUpperCase() } });
      await this.audit.record(tx, { actorId: user.id, action: 'ACCOUNT_CREATED', entityType: 'account', entityId: a.id, companyId: a.companyId, data: { code: a.code } });
      return a;
    });
  }

  companies() {
    return this.prisma.company.findMany({ include: { facilities: true }, orderBy: { code: 'asc' } });
  }
}
