import { Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InboxStatus } from '@prisma/client';
import { Request, Response } from 'express';
import { Permission } from '@fintrack/shared';
import { CurrentUser, Public, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors';
import { InboxService } from './inbox.service';

@ApiTags('integration')
@Controller('integration')
export class IntegrationController {
  constructor(private readonly inbox: InboxService) {}

  /**
   * Inbound events from CliniTrack / SupplyTrack / PeopleTrack. Authenticated by per-source HMAC signature
   * (and mTLS / network policy at the gateway). Returns 202 for new events, 200 for duplicates.
   */
  @Post('events')
  @Public()
  @ApiOperation({ summary: 'Ingest a signed integration event (idempotent per source_system + event_id)' })
  @ApiHeader({ name: 'X-FinTrack-Timestamp', required: true, description: 'Unix seconds' })
  @ApiHeader({ name: 'X-FinTrack-Signature', required: true, description: 'v1=hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))' })
  @ApiBody({ schema: { type: 'object', description: 'IntegrationEventEnvelope (see packages/shared/src/events.ts)' } })
  async ingest(
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-fintrack-timestamp') timestamp?: string,
    @Headers('x-fintrack-signature') signature?: string,
  ) {
    if (!req.rawBody) throw new DomainError('BAD_REQUEST', 'Empty body', 400);
    const result = await this.inbox.ingest(req.rawBody, { timestamp, signature });
    res.status(result.status === 'ACCEPTED' ? 202 : 200);
    return result;
  }

  @Get('inbox')
  @ApiBearerAuth()
  @RequirePermissions(Permission.INTEGRATION_ADMIN)
  @ApiQuery({ name: 'status', required: false, enum: InboxStatus })
  @ApiQuery({ name: 'sourceSystem', required: false })
  list(@Query('status') status?: InboxStatus, @Query('sourceSystem') sourceSystem?: string) {
    return this.inbox.list({ status, sourceSystem });
  }

  @Post('inbox/:id/replay')
  @HttpCode(200)
  @ApiBearerAuth()
  @RequirePermissions(Permission.INTEGRATION_ADMIN)
  replay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.replay(u, id);
  }

  @Get('trace')
  @ApiBearerAuth()
  @RequirePermissions(Permission.LEDGER_READ)
  @ApiQuery({ name: 'inboxId', required: false })
  @ApiQuery({ name: 'journalId', required: false })
  trace(@Query('inboxId') inboxId?: string, @Query('journalId') journalId?: string) {
    if (!inboxId && !journalId) throw new DomainError('BAD_REQUEST', 'inboxId or journalId required', 400);
    return this.inbox.trace({ inboxId, journalId });
  }
}
