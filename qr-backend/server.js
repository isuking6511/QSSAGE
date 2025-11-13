// server.js
// QSSAGE 백엔드 (pool.js 외부 모듈 사용)
import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";
import "dotenv/config";
import cron from "node-cron";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import punycode from "punycode/punycode.js";
import { Parser } from "json2csv";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import reportRoutes from './routes/reportRoutes.js';
// ✅ DB 연결 외부 모듈
import pool from "./database/pool.js";



// ========== 기본 설정 ==========
const PORT = process.env.PORT || 3000;
const NAV_TIMEOUT = 12000;
const BACKUP_DIR = path.join(process.cwd(), "backup");
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ========== 화이트리스트 ==========
const WHITELIST_HOSTS = new Set([
  "google.com", "www.google.com", "naver.com", "www.naver.com", "daum.net", "www.daum.net",
  "bing.com", "www.bing.com", "yahoo.com", "www.yahoo.com", "kakao.com", "www.kakao.com",
  "facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com", "youtube.com", "www.youtube.com",
  "linkedin.com", "www.linkedin.com", "github.com", "www.github.com", "stackoverflow.com", "www.stackoverflow.com",
  "amazon.com", "www.amazon.com", "microsoft.com", "www.microsoft.com",
  "apple.com", "www.apple.com", "netflix.com", "www.netflix.com", "spotify.com", "www.spotify.com",
  "coupang.com", "www.coupang.com", "11st.co.kr", "www.11st.co.kr", "gmarket.co.kr", "www.gmarket.co.kr",
  "auction.co.kr", "www.auction.co.kr", "tistory.com", "www.tistory.com", "blog.naver.com", "cafe.naver.com"
]);

function isWhitelisted(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:") return false;
    for (const w of WHITELIST_HOSTS) {
      if (host === w || host.endsWith("." + w)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function normalizeUrlCandidate(u) {
  try {
    return new URL(u).toString();
  } catch {
    try {
      return new URL("http://" + u).toString();
    } catch {
      return null;
    }
  }
}

// ========== 분석 로직 ==========
async function analyzeHtmlFeatures(html, url) {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || ["", ""])[1] || "";
  const htmlLen = html.length;
  const hasPassword = /<input[^>]+type=["']?password["']?/i.test(html);
  const loginForm = /<form[^>]+(login|signin|passwd|account|로그인)/i.test(html);
  const scriptCount = (html.match(/<script/gi) || []).length;
  const iframeCount = (html.match(/<iframe/gi) || []).length;
  const suspiciousJS = /eval\(|atob\(|fromCharCode|window\.location|document\.write/i.test(html);
  const metaRefresh = /<meta[^>]+http-equiv=["']?refresh/i.test(html);
  const inlineOnEvents = /on(load|error|click|submit)=/i.test(html);
  const visibleLinks = (html.match(/<a\s+[^>]*href=/gi) || []).length;
  const forms = (html.match(/<form\b/gi) || []).length;
  const hostname = new URL(url).hostname;
  const isPuny = hostname.includes("xn--") || /[^\x00-\x7F]/.test(hostname);
  const isIp = /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(url);
  const isHttp = url.startsWith("http://");
  const brandMismatch = loginForm && !/login|로그인|bank|은행|signin|sign in|kakao|naver|google|github|apple/i.test(title + html);

  let score = 0;
  if (suspiciousJS) score += 30;
  if (iframeCount > 2) score += 10;
  if (scriptCount > 25) score += 5;
  if (hasPassword) score += 25;
  if (loginForm) score += 20;
  if (isPuny) score += 40;
  if (brandMismatch) score += 25;
  if (isHttp) score += 40;
  if (isIp) score += 20;
  if (visibleLinks < 2) score += 10;
  if (htmlLen < 200) score += 10;
  if (metaRefresh) score += 10;
  if (inlineOnEvents) score += 10;

  const risk = score >= 70 ? "🚨 위험" : score >= 35 ? "⚠️ 의심" : "✅ 안전";
  return { title, htmlLen, hasPassword, loginForm, scriptCount, iframeCount, suspiciousJS, visibleLinks, forms, isPuny, isIp, isHttp, brandMismatch, metaRefresh, inlineOnEvents, score, risk };
}

// ========== 메일 전송 설정 ==========
const mailTransporter = nodemailer.createTransport({
  service: process.env.MAIL_SERVICE || "gmail",
  auth: { user: process.env.ADMIN_EMAIL, pass: process.env.ADMIN_PASS }
});
async function sendReportEmail(reports) {
  if (!process.env.ADMIN_EMAIL) return { ok: false, error: "MAIL 미설정" };
  const body = reports.map(r => `- ${r.id} | ${r.url} | ${r.risk} | ${r.detected_at}`).join("\n");
  const mail = {
    from: process.env.ADMIN_EMAIL,
    to: [ "fhfgksmswlgh@gmail.com", "jeongbrian0908@gmail.com", "shc7657@gmail.com"],
    subject: `[QSSAGE] 피싱 신고 (${reports.length})`,
    text: body
  };
  return mailTransporter.sendMail(mail);
}

// ========== Express 앱 ==========
const app = express();
app.use(cors({
  origin: process.env.ALLOW_ORIGIN || "http://localhost:5173",
  credentials: true
}));
app.use(express.json());
app.use((req, _res, next) => { console.log(`➡️  ${req.method} ${req.url}`); next(); });


// ========== 스캔 엔드포인트 ==========
app.post("/scan", async (req, res) => {
  let { url, location } = req.body;
  console.log("📨 /scan 요청:", url);
  if (!url) return res.status(400).json({ error: "URL이 필요합니다." });
  url = normalizeUrlCandidate(url);
  if (!url) return res.status(400).json({ error: "유효하지 않은 URL" });

  if (isWhitelisted(url)) {
    console.log("✅ 화이트리스트 HTTPS:", url);
    return res.json({ safe: true, risk: "✅ 안전", reason: "신뢰된 HTTPS 도메인" });
  }

  let browser;
  try {
    const execPath = puppeteer.executablePath ? puppeteer.executablePath() : undefined;
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      ...(execPath ? { executablePath: execPath } : {})
    });
    const page = await browser.newPage();
    let response;
    try {
      response = await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT });
    } catch (err) {
      console.error("❌ 페이지 접근 실패:", err.message);
      await pool.query("INSERT INTO reports (url, location, risk, score) VALUES ($1,$2,$3,$4)", [url, "unknown", "🚨 위험(접근 불가)", 90]);
      if (browser) await browser.close();
      return res.json({ safe: false, risk: "🚨 위험", reason: "접근 불가" });
    }

    const html = await page.content().catch(() => "");
    const analysis = await analyzeHtmlFeatures(html, url);
    await browser.close();

    if (analysis.risk !== "✅ 안전") {
      await pool.query("INSERT INTO reports (url, location, risk, score) VALUES ($1,$2,$3,$4)", [url, location || "unknown", analysis.risk, analysis.score]);
    }

    console.log("📊 분석 결과:", analysis);
    res.json(analysis);
  } catch (err) {
    console.error("❌ 분석 오류:", err.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: "분석 중 오류 발생" });
  }
});


// ========== /report 조회 API (관리자 대시보드용) ==========
app.get("/report", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM reports ORDER BY detected_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("❌ /report 조회 실패:", err.message);
    res.status(500).json({ error: "DB 조회 실패" });
  }
});
// ========== 수동 신고 메일 전송 ==========
app.post("/dispatch/manual", async (req, res) => {
  const ids = req.body.ids || [];
  if (!Array.isArray(ids) || !ids.length)
    return res.status(400).json({ error: "ids 배열 필요" });

  try {
    const { rows } = await pool.query("SELECT * FROM reports WHERE id = ANY($1::int[])", [ids]);
    if (!rows.length) return res.json({ ok: true, count: 0 });

    // ✅ 1. 메일 전송
    await sendReportEmail(rows);

    // ✅ 2. Discord Webhook 전송
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      const content = rows
        .map(r => `🚨 **피싱 신고**\n🔗 URL: ${r.url}\n⚠️ 위험도: ${r.risk}\n🕒 탐지 시각: ${r.detected_at}`)
        .join("\n\n");

      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      }).then(async res => {
        if (!res.ok) {
          const txt = await res.text();
          console.error(`❌ Discord Webhook 전송 실패: ${txt}`);
        } else {
          console.log("✅ Discord Webhook 전송 성공");
        }
      }).catch(err => console.error("❌ Discord Webhook 오류:", err.message));
    } else {
      console.warn("⚠️ DISCORD_WEBHOOK_URL 미설정");
    }

    // ✅ 3. DB 업데이트
    await pool.query(
      "UPDATE reports SET dispatch = true, dispatched_at = NOW() WHERE id = ANY($1::int[])",
      [ids]
    );

    res.json({ ok: true, count: rows.length });
  } catch (err) {
    console.error("❌ /dispatch/manual 오류:", err.message);
    res.status(500).json({ error: "신고 전송 실패", detail: err.message });
  }
});

// ========== 매일 03시 자동 백업 ==========
async function backupReportsNow() {
  const { rows } = await pool.query("SELECT * FROM reports ORDER BY detected_at DESC");
  if (!rows.length) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csv = new Parser().parse(rows);
  const csvPath = path.join(BACKUP_DIR, `reports-${timestamp}.csv`);
  fs.writeFileSync(csvPath, csv);
  console.log("📦 백업 완료:", csvPath);
}
cron.schedule("0 3 * * *", () => {
  console.log("🕒 매일 03시 자동 백업 실행");
  backupReportsNow().catch(e => console.error("백업 실패:", e.message));
});

// ========== 서버 시작 ==========
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});