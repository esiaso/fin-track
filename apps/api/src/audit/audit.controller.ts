import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permission } from '@fintrack/shared';
import { RequirePermissions } from '../auth/decorators';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  async list(@Query('entityType') entityType?: string, @Query('entityId') entityId?: string) {
    const rows = await this.audit.list(entityType, entityId);
    return rows.map((r) => ({ ...r, seq: r.seq.toString() }));
  }

  @Get('verify')
  @RequirePermissions(Permission.AUDIT_READ)
  verify() {
    return this.audit.verifyChain();
  }
}
