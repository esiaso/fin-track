# Entity-relationship model (Increment 1)

Source of truth: `apps/api/prisma/schema.prisma`. Later increments add sub-ledger entities that link to `journals`.

```mermaid
erDiagram
  companies ||--o{ facilities : has
  facilities ||--o{ departments : has
  companies ||--o{ accounts : "chart of accounts"
  accounts ||--o{ accounts : parent
  companies ||--o{ account_mappings : "posting rules"
  account_mappings }o--|| accounts : maps_to
  companies ||--o{ fiscal_periods : has
  companies ||--o{ journals : owns
  fiscal_periods ||--o{ journals : contains
  journals ||--|{ journal_lines : has
  journal_lines }o--|| accounts : posts_to
  journals |o--o| journals : reverses
  inbox_events ||--o{ journals : "source_event_id"
  inbox_events ||--o{ posting_traces : produces
  inbox_events ||--o{ source_entity_versions : "marks processed"
  companies ||--o{ document_sequences : numbering
  users ||--o{ role_assignments : granted
  outbox_events
  audit_log
  approval_limits

  journals {
    uuid id PK
    uuid company_id FK
    string journal_no "unique per company, set at posting"
    date journal_date
    enum status "DRAFT|VALIDATED|APPROVED|POSTED|REVERSED"
    enum source "MANUAL|CLINITRACK|SUPPLYTRACK|PEOPLETRACK|FINTRACK"
    string source_entity_type
    string source_entity_id
    int source_version
    string idempotency_key "unique per company"
    uuid reversal_of_id "unique"
    string content_hash "sha256 at posting"
  }
  journal_lines {
    uuid id PK
    uuid account_id FK
    char3 currency
    numeric debit "20,4"
    numeric credit "20,4"
    numeric fx_rate "20,10"
    numeric base_debit
    numeric base_credit
    jsonb dimensions "payer, supplier, doctor, vote head, source line"
  }
  inbox_events {
    uuid id PK
    string source_system "unique with event_id"
    string event_id
    string source_entity_type
    string source_entity_id
    int source_version
    string payload_hash
    enum status "RECEIVED|PROCESSING|PROCESSED|IGNORED_DUPLICATE|FAILED|DEAD_LETTER"
  }
  audit_log {
    bigint seq PK
    string prev_hash
    string hash "sha256(prev_hash + row)"
  }
```

Key uniqueness rules: `journals(company_id, idempotency_key)`, `journals(company_id, journal_no)`, `inbox_events(source_system, event_id)`,
`source_entity_versions(source_system, source_entity_type, source_entity_id, source_version)`, `accounts(company_id, code)`,
`fiscal_periods(company_id, code)`.
