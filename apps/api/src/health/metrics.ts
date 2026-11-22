import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'fintrack_' });

export const httpDuration = new Histogram({
  name: 'fintrack_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const inboxProcessed = new Counter({
  name: 'fintrack_inbox_events_total',
  help: 'Inbox events by outcome',
  labelNames: ['event_type', 'outcome'],
  registers: [registry],
});
