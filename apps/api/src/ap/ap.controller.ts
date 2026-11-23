import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permission } from '@fintrack/shared';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ApService } from './ap.service';
import { PaymentsService } from './payments.service';
import { ControlDto, CreateRunDto, ItemResultDto, NoteDto } from './dto/ap.dto';

const today = () => new Date().toISOString().slice(0, 10);

@ApiTags('accounts-payable')
@ApiBearerAuth()
@Controller('ap')
export class ApController {
  constructor(
    private readonly ap: ApService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('suppliers')
  @RequirePermissions(Permission.AP_READ)
  @ApiQuery({ name: 'companyId' })
  suppliers(@CurrentUser() u: AuthUser, @Query('companyId', ParseUUIDPipe) companyId: string) {
    return this.ap.suppliers(u, companyId);
  }

  @Get('suppliers/:id/statement')
  @RequirePermissions(Permission.AP_READ)
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  statement(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.ap.statement(u, id, from, to);
  }

  @Get('invoices')
  @RequirePermissions(Permission.AP_READ)
  @ApiQuery({ name: 'companyId' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'matchStatus', required: false })
  @ApiQuery({ name: 'supplierId', required: false })
  invoices(@CurrentUser() u: AuthUser, @Query('companyId', ParseUUIDPipe) companyId: string, @Query('status') status?: string, @Query('matchStatus') matchStatus?: string, @Query('supplierId') supplierId?: string) {
    return this.ap.list(u, { companyId, status, matchStatus, supplierId });
  }

  @Get('invoices/:id')
  @RequirePermissions(Permission.AP_READ)
  invoice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ap.get(u, id);
  }

  @Post('invoices/:id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.AP_APPROVE)
  @ApiOperation({ summary: 'Approve and post an invoice whose match exceptions were overridden (approver must differ from overrider)' })
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ap.approve(u, id);
  }

  @Post('invoices/:id/control')
  @HttpCode(200)
  @RequirePermissions(Permission.AP_READ)
  @ApiOperation({ summary: 'Place on hold / dispute (ap:manage) or release (ap:approve)' })
  control(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ControlDto) {
    return this.ap.setControl(u, id, dto.state, dto.reason);
  }

  @Get('exceptions')
  @RequirePermissions(Permission.AP_READ)
  @ApiQuery({ name: 'companyId' })
  @ApiQuery({ name: 'status', required: false })
  exceptions(@CurrentUser() u: AuthUser, @Query('companyId', ParseUUIDPipe) companyId: string, @Query('status') status?: string) {
    return this.ap.exceptions(u, companyId, status ?? 'OPEN');
  }

  @Post('exceptions/:id/override')
  @HttpCode(200)
  @RequirePermissions(Permission.AP_APPROVE)
  override(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.ap.overrideException(u, id, dto.note);
  }

  @Get('due')
  @RequirePermissions(Permission.AP_READ)
  @ApiQuery({ name: 'companyId' })
  @ApiQuery({ name: 'asOf', required: false })
  due(@CurrentUser() u: AuthUser, @Query('companyId', ParseUUIDPipe) companyId: string, @Query('asOf') asOf?: string) {
    return this.ap.due(u, companyId, asOf ?? today());
  }

  @Get('ageing')
  @RequirePermissions(Permission.AP_READ)
  @ApiQuery({ name: 'companyId' })
  @ApiQuery({ name: 'asOf', required: false })
  ageing(@CurrentUser() u: AuthUser, @Query('companyId', ParseUUIDPipe) companyId: string, @Query('asOf') asOf?: string) {
    return this.ap.ageing(u, companyId, asOf ?? today());
  }

  @Get('payment-runs')
  @RequirePermissions(Permission.AP_READ)
  @ApiQuery({ name: 'companyId' })
  runs(@CurrentUser() u: AuthUser, @Query('companyId', ParseUUIDPipe) companyId: string) {
    return this.payments.list(u, companyId);
  }

  @Get('payment-runs/:id')
  @RequirePermissions(Permission.AP_READ)
  run(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(u, id);
  }

  @Post('payment-runs')
  @RequirePermissions(Permission.AP_MANAGE)
  createRun(@CurrentUser() u: AuthUser, @Body() dto: CreateRunDto) {
    return this.payments.create(u, dto);
  }

  @Post('payment-runs/:id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.AP_APPROVE)
  approveRun(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.approve(u, id);
  }

  @Post('payment-runs/:id/execute')
  @HttpCode(200)
  @RequirePermissions(Permission.AP_PAY_EXECUTE)
  executeRun(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.execute(u, id);
  }

  @Post('payment-runs/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.AP_MANAGE)
  cancelRun(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.cancel(u, id);
  }

  @Post('payment-items/:id/result')
  @HttpCode(200)
  @RequirePermissions(Permission.AP_PAY_EXECUTE)
  @ApiOperation({ summary: 'Record bank / M-PESA result for a payment item (idempotent)' })
  result(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ItemResultDto) {
    return this.payments.recordResult(u, id, dto);
  }
}
