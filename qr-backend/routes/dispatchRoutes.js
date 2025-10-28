import express from 'express';
import pg from 'pg';
import fetch from 'node-fetch';
import cron from 'node-cron';

const router = express.Router();

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'admin',
  password: process.env.PGPASSWORD || '1234',
  database: process.env.PGDATABASE || 'qssage',
});

// 🚀 외부기관 신고 전송 함수
async function sendToAgency(report) {
  try {
    const response = await fetch(process.env.AGENCY_API_URL || 'https://example-agency.test/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: report.url,
        location: report.location,
        detected_at: report.detected_at,
      }),
    });
    const body = await response.text();
    console.log(`📡 신고 전송됨: ${report.url} (${response.status})`);
    return { status: response.status, body };
  } catch (err) {
    console.error(`❌ 신고 실패: ${report.url}`, err.message);
    return { error: err.message };
  }
}

// ✋ 수동 일괄 신고
router.post('/manual', async (req, res) => {
  const { ids } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = ANY($1)', [ids]);
    for (const r of rows) {
      await sendToAgency(r);
    }
    res.json({ ok: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ⏰ 매일 새벽 3시 자동 신고 스케줄
cron.schedule('0 3 * * *', async () => {
  console.log('🕒 자동 신고 시작');
  try {
    const { rows } = await pool.query('SELECT * FROM reports WHERE dispatched IS NULL OR dispatched = false');
    for (const r of rows) {
      const resp = await sendToAgency(r);
      await pool.query('UPDATE reports SET dispatched=true, dispatched_at=NOW() WHERE id=$1', [r.id]);
    }
    console.log(`✅ ${rows.length}건 자동 신고 완료`);
  } catch (err) {
    console.error('❌ 자동 신고 실패:', err.message);
  }
});

export default router;