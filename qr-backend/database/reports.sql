-- 기존 테이블이 있으면 삭제 후 다시 생성 (주의: 기존 데이터 사라짐)
DROP TABLE IF EXISTS reports CASCADE;

CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,                 -- 탐지된 URL
  location TEXT,                     -- 위치(선택)
  risk TEXT,                         -- 위험 등급 (✅ 안전 / ⚠️ 주의 / 🚨 위험)
  detected_at TIMESTAMP DEFAULT NOW(), -- 탐지 시각
  dispatch BOOLEAN DEFAULT FALSE,     -- 메일 전송 여부
  dispatched_at TIMESTAMP NULL,       -- 메일 발송 시각
  dispatch_error TEXT NULL            -- 메일 발송 실패 시 오류 메시지
);

-- 성능을 위한 인덱스
CREATE INDEX idx_reports_url ON reports(url);
CREATE INDEX idx_reports_detected_at ON reports(detected_at DESC);