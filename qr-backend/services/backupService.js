import fs from "fs";
import path from "path";
import cron from "node-cron";
import PDFDocument from "pdfkit";
import { Parser } from "json2csv";
import pool from "../database/pool.js";
import { sendMail } from "./mailService.js"; // 📩 공용 메일 모듈 재사용

// 백업 파일 저장 경로
const BACKUP_DIR = path.resolve("./backup");
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// 백업 수행 함수
export async function backupReports() {
  try {
    const { rows } = await pool.query("SELECT * FROM reports ORDER BY detected_at DESC");
    if (!rows.length) {
      console.log("ℹ️ 백업할 데이터가 없습니다.");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const csvPath = `${BACKUP_DIR}/reports-${timestamp}.csv`;
    const pdfPath = `${BACKUP_DIR}/reports-${timestamp}.pdf`;

    // CSV 파일 생성
    const csv = new Parser().parse(rows);
    fs.writeFileSync(csvPath, csv);

    // PDF 파일 생성
    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(pdfPath));
    doc.fontSize(16).text("📋 QSSAGE 신고 내역 백업", { align: "center" });
    doc.moveDown();
    rows.forEach((r, i) => {
      doc.fontSize(10).text(
        `${i + 1}. URL: ${r.url} | 위치: ${r.location || "-"} | 시간: ${r.detected_at}`
      );
    });
    doc.end();

    // 이메일로 백업 파일 전송 (선택)
    await sendMail({
      to: process.env.ADMIN_EMAIL,
      subject: `[QSSAGE] 신고내역 백업 (${timestamp})`,
      text: `신고 내역 ${rows.length}건이 자동 백업되었습니다.`,
      attachments: [
        { filename: `reports-${timestamp}.csv`, path: csvPath },
        { filename: `reports-${timestamp}.pdf`, path: pdfPath },
      ],
    });

    console.log(`✅ 백업 및 메일 전송 완료 (${timestamp})`);
  } catch (err) {
    console.error("❌ 백업 중 오류 발생:", err.message);
  }
}

// 매일 새벽 3시 자동 백업
cron.schedule("0 3 * * *", backupReports);