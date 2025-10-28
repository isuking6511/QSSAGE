-- 피싱/의심 URL 저장 테이블 (위치 + URL만 저장)
CREATE TABLE IF NOT EXISTS reports (
    id BIGSERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    location TEXT,                       -- 신고 발생 위치 정보
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_reports_detected_at ON reports(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_url ON reports(url);

ALTER TABLE reports
ADD COLUMN dispatched BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN dispatched_at TIMESTAMPTZ,
ADD COLUMN dispatch_response JSONB;