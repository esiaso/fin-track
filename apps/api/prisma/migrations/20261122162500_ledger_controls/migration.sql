-- Defence-in-depth ledger controls enforced by PostgreSQL itself, so that no code path
-- (including ad-hoc SQL by a DBA) can post an unbalanced journal or mutate posted history.

-- 1. Line-level sanity: non-negative, single-sided, non-zero.
ALTER TABLE journal_lines
  ADD CONSTRAINT journal_lines_amounts_non_negative CHECK (debit >= 0 AND credit >= 0 AND base_debit >= 0 AND base_credit >= 0),
  ADD CONSTRAINT journal_lines_single_sided CHECK ((debit = 0) <> (credit = 0)),
  ADD CONSTRAINT journal_lines_currency_upper CHECK (currency = upper(currency)),
  ADD CONSTRAINT journal_lines_fx_positive CHECK (fx_rate > 0);

ALTER TABLE fiscal_periods ADD CONSTRAINT fiscal_periods_dates CHECK (end_date >= start_date);

-- 2. Lines of a posted/reversed journal are immutable; lines must use accounts of the journal's company.
CREATE OR REPLACE FUNCTION ft_guard_journal_lines() RETURNS trigger AS $$
DECLARE
  j_status "JournalStatus";
  j_company uuid;
  a_company uuid;
  a_postable boolean;
  a_active boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO j_status FROM journals WHERE id = OLD.journal_id;
    IF j_status IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'FT_IMMUTABLE: lines of posted journal % cannot be deleted', OLD.journal_id USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status, company_id INTO j_status, j_company FROM journals WHERE id = NEW.journal_id;
  IF j_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'FT_IMMUTABLE: lines of posted journal % cannot be changed', NEW.journal_id USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.journal_id <> NEW.journal_id THEN
    RAISE EXCEPTION 'FT_IMMUTABLE: line cannot move between journals' USING ERRCODE = 'P0001';
  END IF;

  SELECT company_id, is_postable, active INTO a_company, a_postable, a_active FROM accounts WHERE id = NEW.account_id;
  IF a_company <> j_company THEN
    RAISE EXCEPTION 'FT_ACCOUNT_COMPANY: account % does not belong to journal company', NEW.account_id USING ERRCODE = 'P0001';
  END IF;
  IF NOT a_postable OR NOT a_active THEN
    RAISE EXCEPTION 'FT_ACCOUNT_NOT_POSTABLE: account % is not postable/active', NEW.account_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION ft_guard_journal_lines();

-- 3. Journal header: posting requires balance per currency (and in base), open period, date in period.
--    Posted journals may only transition to REVERSED; nothing else may change.
CREATE OR REPLACE FUNCTION ft_guard_journals() RETURNS trigger AS $$
DECLARE
  unbalanced record;
  line_count int;
  p record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'FT_IMMUTABLE: posted journal % cannot be deleted', OLD.id USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
       AND NEW.company_id = OLD.company_id AND NEW.journal_date = OLD.journal_date
       AND NEW.period_id = OLD.period_id AND NEW.journal_no IS NOT DISTINCT FROM OLD.journal_no
       AND NEW.description = OLD.description AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
       AND NEW.idempotency_key = OLD.idempotency_key AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FT_IMMUTABLE: posted journal % is immutable; use a reversal', OLD.id USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'POSTED' AND (TG_OP = 'INSERT' OR OLD.status <> 'POSTED') THEN
    SELECT count(*) INTO line_count FROM journal_lines WHERE journal_id = NEW.id;
    IF line_count < 2 THEN
      RAISE EXCEPTION 'FT_UNBALANCED: journal % needs at least two lines', NEW.id USING ERRCODE = 'P0001';
    END IF;

    SELECT currency, sum(debit) AS dr, sum(credit) AS cr INTO unbalanced
      FROM journal_lines WHERE journal_id = NEW.id
      GROUP BY currency HAVING sum(debit) <> sum(credit) LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'FT_UNBALANCED: journal % does not balance in % (dr=% cr=%)', NEW.id, unbalanced.currency, unbalanced.dr, unbalanced.cr USING ERRCODE = 'P0001';
    END IF;

    PERFORM 1 FROM journal_lines WHERE journal_id = NEW.id HAVING sum(base_debit) <> sum(base_credit);
    IF FOUND THEN
      RAISE EXCEPTION 'FT_UNBALANCED: journal % does not balance in base currency', NEW.id USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO p FROM fiscal_periods WHERE id = NEW.period_id;
    IF p.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'FT_PERIOD: period belongs to another company' USING ERRCODE = 'P0001';
    END IF;
    IF p.status <> 'OPEN' THEN
      RAISE EXCEPTION 'FT_PERIOD_LOCKED: period % is %', p.code, p.status USING ERRCODE = 'P0001';
    END IF;
    IF NEW.journal_date < p.start_date OR NEW.journal_date > p.end_date THEN
      RAISE EXCEPTION 'FT_PERIOD: journal date % outside period %', NEW.journal_date, p.code USING ERRCODE = 'P0001';
    END IF;
    IF NEW.posted_at IS NULL OR NEW.content_hash IS NULL THEN
      RAISE EXCEPTION 'FT_POSTING: posted_at and content_hash are required when posting' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journals_guard
  BEFORE INSERT OR UPDATE OR DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION ft_guard_journals();

-- 4. Audit log is append-only.
CREATE OR REPLACE FUNCTION ft_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FT_AUDIT_APPEND_ONLY: audit_log rows cannot be % ', TG_OP USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION ft_audit_append_only();

CREATE TRIGGER trg_audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION ft_audit_append_only();

-- 5. Trial balance view (posted + reversed journals; a reversal is itself a posted journal).
CREATE OR REPLACE VIEW v_trial_balance AS
SELECT j.company_id,
       j.period_id,
       l.account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.type AS account_type,
       l.currency,
       sum(l.debit)  AS debit,
       sum(l.credit) AS credit,
       sum(l.base_debit)  AS base_debit,
       sum(l.base_credit) AS base_credit
  FROM journal_lines l
  JOIN journals j ON j.id = l.journal_id
  JOIN accounts a ON a.id = l.account_id
 WHERE j.status IN ('POSTED', 'REVERSED')
 GROUP BY j.company_id, j.period_id, l.account_id, a.code, a.name, a.type, l.currency;
