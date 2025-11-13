import express from "express";
import { sendMail } from "../services/mailService.js";
import pool from "../database/pool.js";
import fetch from "node-fetch";

const router = express.Router();

// 선택된 신고 URL 수동 신고 (메일 전송)
router.post("/manual", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ ok: false, msg: "신고할 항목 없음" });

    const { rows } = await pool.query(
      "SELECT * FROM reports WHERE id = ANY($1::int[])",
      [ids]
    );

    const mailText = rows.map(r => `URL: ${r.url}\n위치: ${r.location || "-"}`).join("\n");
    await sendMail({
      to: process.env.ADMIN_EMAIL,
      subject: `[QSSAGE] ${rows.length}건 신고 전송`,
      text: `신고 내역:\n\n${mailText}`,
    });

    await pool.query(
      "UPDATE reports SET dispatched = TRUE, dispatched_at = NOW() WHERE id = ANY($1::int[])",
      [ids]
    );

    res.json({ ok: true, sent: rows.length });
  } catch (err) {
    console.error("❌ 신고 메일 전송 실패:", err.message);
    res.status(500).json({ ok: false, msg: "메일 전송 실패" });
  }
});

export default router;