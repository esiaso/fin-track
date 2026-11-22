# FinTrack

Financial system of record for multi-facility hospitals, part of the SynergyOne Track family
(CliniTrack · SupplyTrack · PeopleTrack · **FinTrack**).

Source applications own operational workflows; FinTrack owns financial posting, settlement and reconciled balances.

## What is in this increment (1 of 8)

* **Monorepo**: `apps/api` (NestJS 11, Prisma 6, PostgreSQL 16, BullMQ), `apps/web` (Next.js 15, Tailwind, TanStack Query, RHF + Zod, Recharts), `packages/shared`.
* **Core ledger**: companies, facilities, departments, chart of accounts with control accounts, account mappings, fiscal periods with soft-close/lock,
  journals with `DRAFT → VALIDATED → APPROVED → POSTED → REVERSED`, maker-checker, approval limits, reversal-only corrections.
* **Database-enforced controls**: triggers reject unbalanced postings (per currency and in base), edits/deletes of posted history, postings into closed periods, cross-company accounts, and any change to the audit log.
* **Integration**: signed, idempotent event inbox (`/api/v1/integration/events`), per-entity version control, retries and dead-letter queue, transactional outbox, upstream ↔ downstream traceability. First consumer: CliniTrack `clinitrack.invoice.finalized` → revenue/debtor journal.
* **Audit**: SHA-256 hash-chained, append-only audit log with `/api/v1/audit/verify`.
* **Security**: JWT with company/facility-scoped role grants and a permission matrix.
* **Ops**: Swagger at `/api/docs` (exported to `docs/openapi.json`), pino logs, Prometheus `/metrics`, health checks, Docker Compose, CI.
* **Web**: admin dashboard (light/dark, responsive) with dashboard, journals (list/new/detail with workflow actions), trial balance, periods, integration inbox and audit trail. All assets are local: no CDNs, web fonts or remote images.

## Docs

* [Architecture](docs/architecture.md) · [ERD](docs/erd.md) · [Deployment](docs/deployment.md)
* **[Assumptions requiring finance sign-off](docs/assumptions.md)**

## Quick start

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm install && pnpm --filter @fintrack/shared build
cd apps/api && npx prisma migrate deploy && npx prisma db seed   # prints dev JWTs
cd ../.. && pnpm dev:api   # and in other terminals: worker, pnpm dev:web
```

Open http://localhost:3000/settings, paste a token from the seed output, then browse.

## Tests

`pnpm --filter @fintrack/shared test && pnpm --filter @fintrack/api test` (needs a `fintrack_test` database; see docs/deployment.md).
