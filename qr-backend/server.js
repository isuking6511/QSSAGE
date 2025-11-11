// ===== 모듈 불러오기 =====
import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';
import 'dotenv/config';
import cron from 'node-cron';

import reportRoutes from './routes/reportRoutes.js';
import dispatchRoutes from './routes/dispatchRoutes.js';
import pool from './database/pool.js';

// ===== Express 앱 생성 =====
const app = express();
const PORT = process.env.PORT || 3000;
const NAV_TIMEOUT = 10000;

// ===== 미들웨어 =====
app.use(cors({ origin: process.env.ALLOW_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// ===== 라우트 등록 =====
app.use('/report', reportRoutes);
app.use('/dispatch', dispatchRoutes);

// ===== 크론 작업 (매시간 신고 자동 전송) =====
cron.schedule('0 * * * *', async () => {
  console.log('🕐 매시간 자동 신고 실행');
  try {
    await fetch(`http://localhost:${PORT}/dispatch/manual`, { method: 'POST' });
  } catch (err) {
    console.error('❌ 자동 신고 실패:', err.message);
  }
});

// ===== 화이트리스트 =====
const WHITELIST_HOSTS = new Set([
  'google.com','www.google.com','naver.com','www.naver.com','daum.net','www.daum.net',
  'bing.com','www.bing.com','yahoo.com','www.yahoo.com',
  'kakao.com','www.kakao.com','facebook.com','www.facebook.com',
  'instagram.com','www.instagram.com','twitter.com','www.twitter.com','x.com','www.x.com',
  'youtube.com','www.youtube.com','linkedin.com','www.linkedin.com',
  'github.com','www.github.com','stackoverflow.com','www.stackoverflow.com',
  'amazon.com','www.amazon.com','microsoft.com','www.microsoft.com',
  'apple.com','www.apple.com','netflix.com','www.netflix.com','spotify.com','www.spotify.com',
  'coupang.com','www.coupang.com','11st.co.kr','www.11st.co.kr','gmarket.co.kr','www.gmarket.co.kr',
  'auction.co.kr','www.auction.co.kr','tistory.com','www.tistory.com','blog.naver.com','cafe.naver.com'
]);

// ===== URL 정규화 =====
function normalizeUrlCandidate(u) {
  try {
    return new URL(u).toString();
  } catch {
    try {
      return new URL('http://' + u).toString();
    } catch {
      return null;
    }
  }
}

// ===== 페이지 분석 함수 (간략 유지) =====
async function analyzePage(page, url) {
  const title = await page.title().catch(() => '');
  const html = await page.content().catch(() => '');
  const hasPassword = /type=["']?password["']?/i.test(html);
  const scriptCount = (html.match(/<script/gi) || []).length;
  const iframeCount = (html.match(/<iframe/gi) || []).length;
  const suspicious =
    /eval\(|atob\(|fromCharCode|document\.write|window\.location/i.test(html);

  let score = 0;
  if (suspicious) score += 25;
  if (iframeCount > 2) score += 10;
  if (scriptCount > 15) score += 5;
  if (!url.startsWith('https://')) score += 3;
  if (/^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(url)) score += 20;

  const risk =
    score > 30 ? '🚨 위험' :
    score > 15 ? '⚠️ 주의' : '✅ 안전';

  return { url, title, hasPassword, scriptCount, iframeCount, suspicious, score, risk };
}

// ===== QR 스캔 분석 엔드포인트 =====
app.post('/scan', async (req, res) => {
  console.log('📨 /scan 요청:', req.body);
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL이 필요합니다.' });
  url = normalizeUrlCandidate(url);
  if (!url) return res.status(400).json({ error: 'URL이 유효하지 않습니다.' });

  const hostname = new URL(url).hostname.toLowerCase();
  if (WHITELIST_HOSTS.has(hostname)) {
    console.log('✅ 화이트리스트 도메인:', hostname);
    return res.json({ safe: true, risk: '✅ 안전', reason: '신뢰된 도메인' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
    } catch (err) {
      console.error('❌ 페이지 접근 실패:', err.message);
      await browser.close();
      await pool.query(
        'INSERT INTO reports (url, location) VALUES ($1, $2)',
        [url, 'unknown']
      );
      return res.json({ safe: false, risk: '🚨 위험', reason: '접근 불가, 차단 가능성' });
    }

    const analysis = await analyzePage(page, url);
    await browser.close();

    // 🚨 피싱 의심 시 DB 저장
    if (analysis.risk !== '✅ 안전') {
      await pool.query(
        'INSERT INTO reports (url, location) VALUES ($1, $2)',
        [url, 'unknown']
      );
    }

    console.log('📊 분석 결과:', analysis);
    res.json(analysis);
  } catch (err) {
    console.error('❌ 분석 오류:', err.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: '분석 중 오류 발생' });
  }
});

// ===== 기본 페이지 =====
app.get('/', (req, res) => {
  res.send('🚀 QSSAGE Backend Server is running');
});

// ===== 서버 시작 =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});