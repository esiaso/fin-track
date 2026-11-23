import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { ApController } from './ap.controller';
import { ApService } from './ap.service';
import { PaymentsService } from './payments.service';
import { SUPPLYTRACK_HANDLERS } from './supplytrack.handlers';

@Module({
  imports: [LedgerModule],
  controllers: [ApController],
  providers: [ApService, PaymentsService, ...SUPPLYTRACK_HANDLERS],
  exports: [ApService, PaymentsService, ...SUPPLYTRACK_HANDLERS],
})
export class ApModule {}
