import express from "express";
import pg from "pg";
import fetch from "node-fetch"; // 웹훅 전송용
const router = express.Router();

const pool = new pg.Pool({
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || "admin",
  password: process.env.PGPASSWORD || "1234",
  database: process.env.PGDATABASE || "qssage",
});

// ✅ Discord Webhook URL 불러오기
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// 🧩 웹훅 전송 함수
async function sendWebhook(report) {
  if (!WEBHOOK_URL) {
    console.warn("⚠️ WEBHOOK_URL이 설정되지 않음");
    return;
  }

  const payload = {
    content: `🚨 **새로운 피싱 URL 탐지됨!**  
🔗 URL: ${report.url}  
📍 위치: ${report.location || "알 수 없음"}  
🕒 탐지 시각: ${report.detected_at}`,
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      console.log("✅ Discord Webhook 전송 성공:", report.url);
    } else {
      console.warn("❌ Discord Webhook 실패:", res.status);
    }
  } catch (err) {
    console.error("❌ Discord Webhook 오류:", err.message);
  }
}

// 📝 신고 등록 (사용자 QR 스캔 시 자동 저장)
router.post("/", async (req, res) => {
  const { url, location } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: "url required" });

  try {
    // ✅ 중복 방지 저장
    const insertQ = `
      INSERT INTO reports (url, location, detected_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (url) DO NOTHING
      RETURNING id, url, location, detected_at;
    `;
    const { rows } = await pool.query(insertQ, [url, location || null]);
    const report = rows[0] || { url, location, detected_at: new Date().toISOString() };

    // ✅ 웹훅 전송 (항상 실행)
    await sendWebhook(report);

    res.json({ ok: true, report });
  } catch (err) {
    console.error("❌ POST /report 오류:", err.message);
    res.status(500).json({ ok: false, error: "insert failed" });
  }
});

// 📋 신고 목록 조회 (관리자 페이지용)
router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM reports ORDER BY detected_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("❌ /report 조회 실패:", err.message);
    res.status(500).json({ error: "DB 조회 실패" });
  }
});

// 🗑️ 신고 삭제
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM reports WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ 신고 삭제 실패:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;