CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE report_status AS ENUM ('pending','batched','submitted','rejected');

CREATE TABLE report (
  report_id   BIGSERIAL PRIMARY KEY,
  qr_content  TEXT NOT NULL,
  loc         GEOGRAPHY(Point,4326) NOT NULL,                 
  qr_hash     TEXT GENERATED ALWAYS AS
              (encode(digest(lower(coalesce(qr_content,'')),'sha256'),'hex')) STORED,
  status      report_status NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  admin_note  TEXT
);

-- 지오 인덱스/상태 인덱스
CREATE INDEX idx_report_loc     ON report USING GIST (loc);
CREATE INDEX idx_report_status  ON report(status, created_at DESC);

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