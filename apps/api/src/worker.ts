import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { INBOX_DISPATCHER, InboxDispatcher, InboxService } from './integration/inbox.service';
import { BullOutboundPublisher, INBOX_QUEUE, redisConnection } from './integration/queue';
import { OutboxService } from './outbox/outbox.service';
import { inboxProcessed } from './health/metrics';

@Module({ providers: [BullOutboundPublisher] })
class WorkerExtras {}

/**
 * Background worker: consumes the inbox queue, sweeps stuck/retry-due inbox rows and relays the outbox.
 * Run N replicas safely: claims use FOR UPDATE SKIP LOCKED and per-entity advisory locks.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(
    { module: class WorkerRoot {}, imports: [AppModule.register({ queue: true }), WorkerExtras] } as never,
    { bufferLogs: true },
  );
  const log = app.get(Logger);
  app.useLogger(log);
  app.enableShutdownHooks();
  const inbox = app.get(InboxService);
  const outbox = app.get(OutboxService);
  const publisher = app.get(BullOutboundPublisher);
  const dispatcher = app.get<InboxDispatcher>(INBOX_DISPATCHER, { strict: false });

  const worker = new Worker(
    INBOX_QUEUE,
    async (job) => {
      const status = await inbox.process(job.data.inboxId);
      inboxProcessed.inc({ event_type: job.name, outcome: status });
      return status;
    },
    { connection: redisConnection(), concurrency: Number(process.env.INBOX_CONCURRENCY ?? 8) },
  );

  const sweep = setInterval(async () => {
    try {
      for (const id of await inbox.dueForRetry()) await dispatcher.dispatch(id);
      while ((await outbox.relayBatch(publisher)) > 0) {
        /* drain */
      }
    } catch (err) {
      log.error(err);
    }
  }, Number(process.env.SWEEP_INTERVAL_MS ?? 5000));

  const stop = async () => {
    clearInterval(sweep);
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
main();
