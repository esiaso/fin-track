import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { InboxDispatcher } from './inbox.service';
import { OutboundPublisher } from '../outbox/outbox.service';

export const INBOX_QUEUE = 'fintrack-inbox';
export const OUTBOUND_QUEUE = 'fintrack-outbound';

export function redisConnection(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
}

/** BullMQ dispatcher. The DB inbox row is the source of truth; the queue only accelerates processing. */
@Injectable()
export class BullInboxDispatcher implements InboxDispatcher, OnModuleDestroy {
  private readonly connection = redisConnection();
  private readonly queue = new Queue(INBOX_QUEUE, { connection: this.connection });

  async dispatch(inboxId: string, delayMs = 0): Promise<void> {
    await this.queue.add('process', { inboxId }, { delay: delayMs, removeOnComplete: 1000, removeOnFail: 5000, attempts: 1 });
  }

  async onModuleDestroy() {
    await this.queue.close();
    this.connection.disconnect();
  }
}

/** Publishes outbox events to a BullMQ queue that downstream Track apps (or a webhook relay) consume. */
@Injectable()
export class BullOutboundPublisher implements OutboundPublisher, OnModuleDestroy {
  private readonly connection = redisConnection();
  private readonly queue = new Queue(OUTBOUND_QUEUE, { connection: this.connection });

  async publish(e: Parameters<OutboundPublisher['publish']>[0]): Promise<void> {
    // jobId = outbox id => idempotent publish if the relay retries after a crash.
    await this.queue.add(e.eventType, e, { jobId: e.id, removeOnComplete: 10000 });
  }

  async onModuleDestroy() {
    await this.queue.close();
    this.connection.disconnect();
  }
}
