import { Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permission } from '@fintrack/shared';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('trial-balance')
  @RequirePermissions(Permission.REPORT_READ)
  @ApiQuery({ name: 'companyId' })
  @ApiQuery({ name: 'periodId', required: false })
  @ApiQuery({ name: 'facilityId', required: false })
  trialBalance(
    @CurrentUser() u: AuthUser,
    @Query('companyId', ParseUUIDPipe) companyId: string,
    @Query('periodId') periodId?: string,
    @Query('facilityId') facilityId?: string,
  ) {
    return this.reports.trialBalance(u, { companyId, periodId, facilityId });
  }
}
