import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { JournalsService } from './journals.service';
import { PeriodsService } from './periods.service';
import { AccountsService } from './accounts.service';

@Module({
  controllers: [LedgerController],
  providers: [JournalsService, PeriodsService, AccountsService],
  exports: [JournalsService, PeriodsService, AccountsService],
})
export class LedgerModule {}
