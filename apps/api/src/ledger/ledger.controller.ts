import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permission } from '@fintrack/shared';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors';
import { JournalsService } from './journals.service';
import { PeriodsService } from './periods.service';
import { AccountsService } from './accounts.service';
import { CreateJournalDto, ReverseJournalDto } from './dto/journal.dto';
import { CreateAccountDto, CreatePeriodDto, PeriodTransitionDto } from './dto/ledger.dto';

@ApiTags('ledger')
@ApiBearerAuth()
@Controller()
export class LedgerController {
  constructor(
    private readonly journals: JournalsService,
    private readonly periods: PeriodsService,
    private readonly accounts: AccountsService,
  ) {}

  @Get('companies')
  @RequirePermissions(Permission.LEDGER_READ)
  companies() {
    return this.accounts.companies();
  }

  @Get('accounts')
  @RequirePermissions(Permission.LEDGER_READ)
  @ApiQuery({ name: 'companyId' })
  listAccounts(@CurrentUser() u: AuthUser, @Query('companyId', ParseUUIDPipe) companyId: string) {
    return this.accounts.list(u, companyId);
  }

  @Post('accounts')
  @RequirePermissions(Permission.ACCOUNT_MANAGE)
  createAccount(@CurrentUser() u: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accounts.create(u, dto);
  }

  @Get('periods')
  @RequirePermissions(Permission.LEDGER_READ)
  @ApiQuery({ name: 'companyId' })
  listPeriods(@CurrentUser() u: AuthUser, @Query('companyId', ParseUUIDPipe) companyId: string) {
    return this.periods.list(u, companyId);
  }

  @Post('periods')
  @RequirePermissions(Permission.PERIOD_MANAGE)
  createPeriod(@CurrentUser() u: AuthUser, @Body() dto: CreatePeriodDto) {
    return this.periods.create(u, dto);
  }

  @Post('periods/:id/soft-close')
  @HttpCode(200)
  @RequirePermissions(Permission.PERIOD_MANAGE)
  softClose(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PeriodTransitionDto) {
    return this.periods.transition(u, id, 'SOFT_CLOSED', dto.reason);
  }

  @Post('periods/:id/lock')
  @HttpCode(200)
  @RequirePermissions(Permission.PERIOD_MANAGE)
  lock(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PeriodTransitionDto) {
    return this.periods.transition(u, id, 'LOCKED', dto.reason);
  }

  @Post('periods/:id/reopen')
  @HttpCode(200)
  @RequirePermissions(Permission.PERIOD_MANAGE)
  reopen(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PeriodTransitionDto) {
    return this.periods.transition(u, id, 'OPEN', dto.reason);
  }

  @Get('journals')
  @RequirePermissions(Permission.LEDGER_READ)
  @ApiQuery({ name: 'companyId' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'skip', required: false })
  listJournals(
    @CurrentUser() u: AuthUser,
    @Query('companyId', ParseUUIDPipe) companyId: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.journals.list(u, { companyId, status, from, to, take: take ? Number(take) : undefined, skip: skip ? Number(skip) : undefined });
  }

  @Get('journals/:id')
  @RequirePermissions(Permission.LEDGER_READ)
  getJournal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.get(u, id);
  }

  @Post('journals')
  @RequirePermissions(Permission.JOURNAL_CREATE)
  @ApiOperation({ summary: 'Create a manual draft journal (idempotent on Idempotency-Key per company)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async createJournal(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key: string | undefined, @Body() dto: CreateJournalDto) {
    if (!key || key.length < 8 || key.length > 120) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (8-120 chars) is required', 400);
    const { journal, created } = await this.journals.createManual(u, { ...dto, idempotencyKey: `API:${key}` });
    return { created, journal };
  }

  @Post('journals/:id/validate')
  @HttpCode(200)
  @RequirePermissions(Permission.JOURNAL_CREATE)
  validate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.validate(u, id);
  }

  @Post('journals/:id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.JOURNAL_APPROVE)
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.approve(u, id);
  }

  @Post('journals/:id/post')
  @HttpCode(200)
  @RequirePermissions(Permission.JOURNAL_POST)
  post(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.post(u, id);
  }

  @Post('journals/:id/reverse')
  @HttpCode(200)
  @RequirePermissions(Permission.JOURNAL_REVERSE)
  reverse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseJournalDto) {
    return this.journals.reverse(u, id, dto.reason, dto.reversalDate);
  }
}
