import express from 'express';
import pg from 'pg';
import fetch from 'node-fetch';
import cron from 'node-cron';
import nodemailer from 'nodemailer';

// 🚀 외부기관 메일 신고 전송 함수
async function sendToAgency(report) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.MAIL_USER, // 발신자 이메일
        pass: process.env.MAIL_PASS  // 앱 비밀번호 (Google 2단계 인증 후 발급)
      }
    });

    const mailOptions = {
      from: `"QR 스미싱 자동신고" <${process.env.MAIL_USER}>`,
      to: process.env.AGENCY_EMAIL || 'phishing@kisa.or.kr', // 기관 이메일
      subject: `[자동신고] 피싱 의심 URL (${report.url})`,
      text: `
안녕하세요. 스미싱 QR 자동 신고 시스템에서 전송된 메일입니다.

다음 URL이 피싱 또는 스미싱으로 의심되어 신고드립니다.

- URL: ${report.url}
- 위치 정보: ${report.location || '정보 없음'}
- 탐지 시각: ${report.detected_at}

감사합니다.
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`📨 신고 메일 전송됨: ${report.url} (${info.accepted})`);
    return { success: true, messageId: info.messageId };

  } catch (err) {
    console.error(` 신고 메일 실패: ${report.url}`, err.message);
    return { success: false, error: err.message };
  }
}
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

// 📊 관리자용 메일 발송 상태 조회
router.get('/status', async (req, res) => {
  try {
    const query = `
      SELECT 
        r.id,
        r.url,
        r.detected_at,
        r.dispatched,
        r.dispatched_at,
        r.dispatch_error,
        m.status AS mail_status,
        m.sent_at
      FROM reports r
      LEFT JOIN mail_logs m ON m.report_id = r.id
      ORDER BY r.detected_at DESC
      LIMIT 100;
    `;
    const { rows } = await pool.query(query);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('❌ 상태 조회 실패:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});