CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE report_status AS ENUM ('pending','batched','submitted','rejected');

CREATE TABLE report (
  report_id   BIGSERIAL PRIMARY KEY,
  qr_url      TEXT NOT NULL,
  loc         GEOGRAPHY(Point,4326) NOT NULL,                 
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 지오 인덱스/상태 인덱스
CREATE INDEX idx_report_loc     ON report USING GIST (loc);

-- 배치(일괄 신고 묶음)
CREATE TABLE submit_batch (
  batch_id     BIGSERIAL PRIMARY KEY,
  target_system TEXT NOT NULL,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at  TIMESTAMPTZ,
  external_ref  TEXT,
  status        TEXT NOT NULL DEFAULT 'created'  -- created|submitting|done|failed
);

CREATE TABLE submit_batch_item (
  batch_id  BIGINT NOT NULL REFERENCES submit_batch(batch_id) ON DELETE CASCADE,
  report_id BIGINT NOT NULL REFERENCES report(report_id)      ON DELETE RESTRICT,
  PRIMARY KEY (batch_id, report_id)
);

-- === Security Hardening: RLS + Immutability + Tamper-evidence ===

-- Separate schema for minimal surface (optional if staying in public)
-- CREATE SCHEMA IF NOT EXISTS core;
-- ALTER TABLE report SET SCHEMA core; -- repeat for other tables if you adopt core schema

-- 1) Roles (least privilege)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_ingest') THEN
    CREATE ROLE app_ingest LOGIN PASSWORD 'change-this-ingest';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_read') THEN
    CREATE ROLE app_read LOGIN PASSWORD 'change-this-read';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_admin') THEN
    CREATE ROLE app_admin LOGIN PASSWORD 'change-this-admin';
  END IF;
END$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_ingest, app_read, app_admin;

-- Restrict table DML; we’ll open only what we need via GRANTs and RLS policies
REVOKE ALL ON report, submit_batch, submit_batch_item FROM PUBLIC;

GRANT SELECT, INSERT ON report TO app_ingest;
GRANT SELECT ON report TO app_read, app_admin;
GRANT SELECT ON submit_batch, submit_batch_item TO app_admin, app_read;

-- 2) Immutable URL: block modifications after insert
CREATE OR REPLACE FUNCTION block_qr_url_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.qr_url IS DISTINCT FROM OLD.qr_url THEN
    RAISE EXCEPTION 'qr_url is immutable';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_block_qr_url_update ON report;
CREATE TRIGGER trg_block_qr_url_update
BEFORE UPDATE ON report
FOR EACH ROW EXECUTE FUNCTION block_qr_url_update();

-- 3) Tamper-evident signature using HMAC (pgcrypto)
-- Secret is stored in a dedicated table readable only by definer functions
CREATE TABLE IF NOT EXISTS app_secret (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  hmac_key BYTEA NOT NULL
);
-- Seed once if empty (32 bytes). Replace with your own securely generated key.
INSERT INTO app_secret(id, hmac_key)
SELECT 1, gen_random_bytes(32)
WHERE NOT EXISTS (SELECT 1 FROM app_secret WHERE id=1);
REVOKE ALL ON app_secret FROM PUBLIC;
GRANT SELECT ON app_secret TO app_admin; -- only admin can see directly

ALTER TABLE report
  ADD COLUMN IF NOT EXISTS data_sig BYTEA; -- HMAC of canonical fields

CREATE OR REPLACE FUNCTION canonical_report_bytes(_qr_url TEXT, _lonlat GEOGRAPHY, _ts TIMESTAMPTZ)
RETURNS BYTEA LANGUAGE sql IMMUTABLE AS $$
  SELECT convert_to(coalesce(_qr_url,''),'UTF8') ||
         convert_to('|'||ST_AsEWKB(_lonlat)::text,'UTF8') ||
         convert_to('|'||to_char(_ts,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'UTF8');
$$;

CREATE OR REPLACE FUNCTION sign_report(_qr_url TEXT, _lonlat GEOGRAPHY, _ts TIMESTAMPTZ)
RETURNS BYTEA LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE k BYTEA; v BYTEA;
BEGIN
  SELECT hmac_key INTO k FROM app_secret WHERE id=1;
  v := canonical_report_bytes(_qr_url, _lonlat, _ts);
  RETURN hmac(v, k, 'sha256');
END$$;

REVOKE ALL ON FUNCTION sign_report(TEXT,GEOGRAPHY,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sign_report(TEXT,GEOGRAPHY,TIMESTAMPTZ) TO app_ingest, app_admin;

-- Auto-sign on insert; verify on update (should never change)
CREATE OR REPLACE FUNCTION trg_report_sign_ins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.data_sig := sign_report(NEW.qr_url, NEW.loc, NEW.created_at);
  RETURN NEW;
END$$;

CREATE OR REPLACE FUNCTION trg_report_verify_upd()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v BYTEA;
BEGIN
  v := sign_report(COALESCE(NEW.qr_url, OLD.qr_url), COALESCE(NEW.loc, OLD.loc), COALESCE(NEW.created_at, OLD.created_at));
  IF NEW.data_sig IS DISTINCT FROM v THEN
    RAISE EXCEPTION 'report row signature mismatch (possible tamper)';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_report_sign_ins ON report;
CREATE TRIGGER trg_report_sign_ins
BEFORE INSERT ON report
FOR EACH ROW EXECUTE FUNCTION trg_report_sign_ins();

DROP TRIGGER IF EXISTS trg_report_verify_upd ON report;
CREATE TRIGGER trg_report_verify_upd
BEFORE UPDATE ON report
FOR EACH ROW EXECUTE FUNCTION trg_report_verify_upd();

-- 4) Append-only integrity chain (ledger) for ingestion
CREATE TABLE IF NOT EXISTS ingest_ledger (
  seq BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES report(report_id) ON DELETE RESTRICT,
  prev_hash BYTEA,
  entry_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_ingest_ledger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev BYTEA;
BEGIN
  SELECT entry_hash INTO prev FROM ingest_ledger ORDER BY seq DESC LIMIT 1;
  INSERT INTO ingest_ledger(report_id, prev_hash, entry_hash)
  VALUES (NEW.report_id,
          prev,
          digest( COALESCE(prev,'') || NEW.data_sig, 'sha256'));
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_ingest_ledger ON report;
CREATE TRIGGER trg_ingest_ledger
AFTER INSERT ON report
FOR EACH ROW EXECUTE FUNCTION trg_ingest_ledger();

-- 5) Row-Level Security (RLS)
ALTER TABLE report ENABLE ROW LEVEL SECURITY;

-- Ingest account: can INSERT any, SELECT limited columns (no admin notes here)
DROP POLICY IF EXISTS p_report_ingest_ins ON report;
CREATE POLICY p_report_ingest_ins ON report
  FOR INSERT TO app_ingest
  WITH CHECK (true);

DROP POLICY IF EXISTS p_report_ingest_sel ON report;
CREATE POLICY p_report_ingest_sel ON report
  FOR SELECT TO app_ingest
  USING (true);

-- Read-only role can SELECT
DROP POLICY IF EXISTS p_report_read_sel ON report;
CREATE POLICY p_report_read_sel ON report
  FOR SELECT TO app_read
  USING (true);

-- No UPDATE/DELETE policies for app_ingest/app_read => those operations denied by RLS
REVOKE UPDATE, DELETE ON report FROM app_ingest, app_read;
GRANT UPDATE, DELETE ON report TO app_admin; -- admin only

-- 6) Admin helper functions (definer, audited)
CREATE OR REPLACE FUNCTION admin_reject_report(p_report_id BIGINT, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE report SET /* soft action via note table if added later */ created_at = created_at, /* no-op */
         /* place to extend: status='rejected' */
         
         admin_note = COALESCE(p_note, admin_note)
  WHERE report_id = p_report_id;
  INSERT INTO audit_log(actor, action, report_id, meta_json)
  VALUES (session_user, 'reject', p_report_id, jsonb_build_object('note', p_note));
END$$;

REVOKE ALL ON FUNCTION admin_reject_report(BIGINT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_reject_report(BIGINT,TEXT) TO app_admin;

-- 7) Monitoring helpers
CREATE OR REPLACE VIEW vw_last_24h_activity AS
SELECT date_trunc('hour', created_at) AS hour,
       count(*) FILTER (WHERE action IS NOT NULL) AS audit_events
FROM audit_log
WHERE created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;

CREATE OR REPLACE VIEW vw_tamper_alerts AS
SELECT r.report_id, r.created_at
FROM report r
WHERE NOT (r.data_sig = sign_report(r.qr_url, r.loc, r.created_at));