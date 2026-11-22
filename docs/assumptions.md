# Assumptions requiring finance-team sign-off

Each item is implemented as the default described here and is configurable or replaceable. Please mark **Agree / Change** with the owner and date.
Items marked *(Inc N)* apply to a later increment but are listed now so policy can be settled before build.

## Ledger and posting

| ID | Assumption | Default implemented | Sign-off |
|---|---|---|---|
| A-GL-01 | Each journal belongs to exactly one company (legal entity). Inter-company is two journals via due-to/due-from accounts. | Enforced | |
| A-GL-02 | A journal must balance **per transaction currency** and in base currency. FX postings use a clearing account per currency rather than mixed-currency lines. | Enforced in service + DB trigger | |
| A-GL-03 | Base currency is KES for all Kenyan entities; amounts stored at 4 dp, presented/paid at currency minor units with banker's rounding. | Implemented | |
| A-GL-04 | Corrections to posted journals are by full reversal plus a new journal; no partial reversal of individual lines. | Implemented | |
| A-GL-05 | Reversal date defaults to the original date if that period is still OPEN, otherwise today. | Implemented | |
| A-GL-06 | Control accounts (AR, AP, payroll, statutory, doctor fund, bank, suspense, FX clearing) cannot receive manual journals. | Implemented | |
| A-GL-07 | Journal numbers are sequential per company (`JV-00000001`), assigned at posting, not at draft. | Implemented | |

## Approvals and controls

| ID | Assumption | Default | Sign-off |
|---|---|---|---|
| A-SEC-01 | Role/permission matrix in `packages/shared/src/permissions.ts` (e.g. Accountant creates, Chief Accountant approves/posts, Finance Controller manages periods and reversals). | Proposed | |
| A-SEC-02 | Maker cannot approve or post their own journal. Approver may also post. | Enforced | |
| A-SEC-03 | If no approval limits are configured for a company, role permission alone authorises approval. Once any JOURNAL limit exists, approver must hold a role with limit ≥ journal total (base currency). | Implemented | |
| A-SEC-04 | Reversals require `journal:reverse` (Finance Controller / Chief Accountant) and post immediately without a second approval. | Implemented | |
| A-POST-01 | Integration postings (CliniTrack/SupplyTrack/PeopleTrack) are system-approved because approval already happened upstream; FinTrack still validates balance, period and mappings. AP invoices with match exceptions will **not** auto-post *(Inc 2)*. | Implemented | |

## Periods

| ID | Assumption | Default | Sign-off |
|---|---|---|---|
| A-PER-01 | Monthly fiscal periods, calendar year. (Confirm fiscal year: July–June is common for public entities.) | Seeded Jan–Dec 2026 | |
| A-PER-02 | `SOFT_CLOSED` can be reopened by Finance Controller with a recorded reason; `LOCKED` is final (post adjustments into the next open period). | Implemented | |
| A-PER-03 | A period cannot be LOCKED while it holds unposted (draft/validated/approved) journals. | Implemented | |
| A-PER-04 | Integration events dated in a closed period fail and retry, then dead-letter for finance to decide (reopen or re-date). Alternative: auto-post to the first open period. | Fail + retry | |

## Integration

| ID | Assumption | Default | Sign-off |
|---|---|---|---|
| A-INT-01 | A higher `source_version` of the same source entity supersedes earlier versions (reverse + repost). Older versions arriving late are ignored. | Implemented | |
| A-INT-02 | CliniTrack invoice finalisation recognises revenue (DR debtor control by debtor type, CR revenue by service mapping). Confirm revenue is recognised at invoice finalisation, not at claim adjudication. | Implemented | |
| A-INT-03 | Account mappings: `AR_CONTROL:<debtor_type>` and `REVENUE:<service mapping key>` per company. Missing mapping → retry then dead-letter. | Implemented | |
| A-FX-01 | Foreign-currency source documents are rejected until an approved FX-rate source (CBK daily rate?) is configured. | Rejected (non-retryable) | |

## Later increments: policy decisions needed before build

| ID | Question | Proposed default |
|---|---|---|
| A-AP-01 *(Inc 2)* | 3-way match tolerances | Qty 0%, price ±2% or KES 500 (lower), tax exact, currency must match |
| A-AP-02 *(Inc 2)* | Duplicate invoice fingerprint | supplier + normalised invoice no + company; secondary fingerprint supplier + date + gross amount flagged for review |
| A-AP-03 *(Inc 2)* | Withholding tax/VAT | WHT recognised at payment; VAT input at invoice |
| A-AR-01 *(Inc 3)* | Patient vs payer split | Single invoice split into payer portion and patient co-pay portion as separate open items; never both |
| A-AR-02 *(Inc 3)* | Provisioning | Ageing-based matrix (e.g. 0–90: 0%, 91–180: 25%, 181–365: 50%, >365: 100%); write-offs need Finance Controller + CEO above threshold |
| A-PAY-01 *(Inc 4)* | Payroll partial payment | Not allowed by default; per-employee rejected payments re-queued |
| A-DOC-01 *(Inc 5)* | Doctor fee default model | Collection-based revenue share for percentage contracts; advances only within approved limits |
| A-BUD-01 *(Inc 6)* | Commitment relief | Relieve on GRN for goods, on invoice for services |
| A-KPI-01 *(Inc 8)* | KPI targets & weights | Proposed defaults only; require approval per role, facility, period; payer-caused delays excluded |
| A-DP-01 | Data retention | Financial records 7 years (Kenya tax law); patient identifiers minimised to opaque references; DPIA under Kenya Data Protection Act 2019 before go-live |
