# Deployment guide

## Local development

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm install
pnpm --filter @fintrack/shared build
cd apps/api && npx prisma migrate deploy && npx prisma db seed   # prints dev JWTs for demo users
pnpm dev:api        # http://localhost:4000/api/docs
pnpm --filter @fintrack/api exec ts-node-dev src/worker.ts   # inbox/outbox worker
pnpm dev:web        # http://localhost:3000
```

Full stack in containers: `docker compose up --build` (runs migrations on start via the `migrate` service).

## Tests

```bash
createdb fintrack_test          # or TEST_DATABASE_URL=...
pnpm --filter @fintrack/shared test
pnpm --filter @fintrack/api test   # unit + integration against real PostgreSQL
```

## Production topology

* **PostgreSQL 16** managed (HA, PITR, encrypted at rest). Separate roles: `fintrack_migrator` (DDL) and `fintrack_app`
  (DML only, **no** TRUNCATE/ALTER, no ownership of triggers). Run migrations as a release step, never from app pods.
* **Redis 7** with persistence (AOF) for BullMQ; loss of Redis is tolerated (the worker sweeper re-queues from the DB).
* **api**: ≥2 replicas behind ingress with TLS; `/api/v1/integration/events` exposed only on the private network or via mTLS.
* **worker**: ≥2 replicas; safe to scale (SKIP LOCKED + advisory locks).
* **web**: ≥2 replicas (Next.js standalone).
* Secrets from a vault/KMS: `JWT_SECRET` (or JWKS for the SynergyOne IdP), `INTEGRATION_SECRET_*`, `PII_ENCRYPTION_KEY`, DB credentials.
* Backups: daily full + WAL; quarterly restore test; run `GET /api/v1/audit/verify` after restore.

## Release checklist

1. `prisma migrate deploy` (forward-only; never `migrate reset` or `db push` against shared databases).
2. Roll api and worker.
3. Check `/health/ready`, inbox DEAD_LETTER count, outbox backlog.
4. Smoke: trial balance balanced for each company.
