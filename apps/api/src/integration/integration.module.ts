import { DynamicModule, Module, Provider } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { IntegrationController } from './integration.controller';
import { INBOX_DISPATCHER, InboxService } from './inbox.service';
import { EVENT_HANDLERS } from './handlers/handler';
import { CliniTrackInvoiceFinalizedHandler } from './handlers/clinitrack-invoice.handler';
import { BullInboxDispatcher } from './queue';
import { ApModule } from '../ap/ap.module';
import { SUPPLYTRACK_HANDLERS } from '../ap/supplytrack.handlers';

const localHandlers = [CliniTrackInvoiceFinalizedHandler];
const handlerClasses = [...localHandlers, ...SUPPLYTRACK_HANDLERS];

@Module({})
export class IntegrationModule {
  /** @param opts.queue false in tests: events are processed by calling InboxService.process directly. */
  static register(opts: { queue: boolean } = { queue: true }): DynamicModule {
    const providers: Provider[] = [
      ...localHandlers,
      { provide: EVENT_HANDLERS, useFactory: (...hs: unknown[]) => hs, inject: handlerClasses },
      InboxService,
    ];
    if (opts.queue) providers.push({ provide: INBOX_DISPATCHER, useClass: BullInboxDispatcher });
    return {
      module: IntegrationModule,
      imports: [LedgerModule, ApModule],
      controllers: [IntegrationController],
      providers,
      exports: [InboxService],
    };
  }
}
