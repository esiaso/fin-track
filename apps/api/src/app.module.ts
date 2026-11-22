import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { OutboxModule } from './outbox/outbox.module';
import { LedgerModule } from './ledger/ledger.module';
import { IntegrationModule } from './integration/integration.module';
import { ReportsModule } from './reports/reports.module';
import { HealthModule } from './health/health.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';

@Module({})
export class AppModule {
  static register(opts: { queue: boolean } = { queue: true }): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: process.env.LOG_LEVEL ?? 'info',
            genReqId: (req) => (req.headers['x-correlation-id'] as string) ?? randomUUID(),
            // Never log bodies (PII / payroll) or auth headers.
            redact: ['req.headers.authorization', 'req.headers["x-fintrack-signature"]', 'req.body'],
            autoLogging: process.env.NODE_ENV !== 'test',
          },
        }),
        PrismaModule,
        AuthModule,
        AuditModule,
        OutboxModule,
        LedgerModule,
        IntegrationModule.register(opts),
        ReportsModule,
        HealthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
    };
  }
}
