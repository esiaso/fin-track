import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { registry } from './metrics';

@ApiTags('ops')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health/live')
  @Public()
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  @Public()
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    const backlog = await this.prisma.inboxEvent.count({ where: { status: { in: ['FAILED', 'DEAD_LETTER'] } } });
    return { status: 'ok', db: 'up', inboxBacklog: backlog };
  }

  /** Prometheus scrape endpoint. Restrict at the ingress to the monitoring network. */
  @Get('metrics')
  @Public()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metrics() {
    return registry.metrics();
  }
}
