const express = require('express');
const puppeteer = require('puppeteer');
const Redis = require('ioredis');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const redis = new Redis();

// OpenPhish에서 피싱 URL 리스트 받아서 검사
async function checkWithOpenPhish(targetUrl) {
  try {
    const response = await fetch('https://openphish.com/feed.txt');
    const text = await response.text();
    const phishingUrls = text.split('\n').map(line => line.trim());
    return phishingUrls.includes(targetUrl);
  } catch (err) {
    console.error("OpenPhish 체크 중 오류:", err.message);
    return false;
  }
}

app.post('/scan', async (req, res) => {
  const { url, location } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL이 필요합니다' });
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 10000 });

    let score = 0;

    const isListedInOpenPhish = await checkWithOpenPhish(url);
    if (isListedInOpenPhish) {
      console.log("⚠️ OpenPhish 목록에 포함된 피싱 URL입니다");
      score += 10;
    }

    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'http:') {
      console.log("⚠️ 비암호화 http 프로토콜 사용");
      score += 3;
    }

    const downloadExtensions = ['.apk', '.exe', '.zip', '.bat', '.js'];
    if (downloadExtensions.some(ext => url.toLowerCase().includes(ext))) {
      console.log("⚠️ 자동 다운로드 유도 확장자 포함됨");
      score += 4;
    }

    const metaRedirectExists = await page.$('meta[http-equiv="refresh"]');
    if (metaRedirectExists) {
      console.log("meta 리디렉션 감지됨");
      score += 4;
    }

    const html = await page.content();
    const hasJsRedirect =
      html.includes('location.href') ||
      html.includes('window.location') ||
      html.includes('window.open') ||
      html.includes('location.replace');

    if (hasJsRedirect) {
      console.log("JavaScript 리디렉션 코드 감지됨");
      score += 3;
    }

    const hasIframe = html.includes('<iframe');
    const hasScript = html.includes('<script');
    if (hasIframe && hasScript) {
      console.log("⚠️ iframe + script 포함됨");
      score += 3;
    }

    const hasDownloadAnchor = await page.$('a[download]');
    if (hasDownloadAnchor) {
      console.log("⚠️ 다운로드 유도 anchor 태그 감지됨");
      score += 2;
    }

    await browser.close();

    const isSafe = score < 5;

    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} | ${url} | ${location || 'unknown'} | Score: ${score}\n`;
    fs.appendFileSync('report.log', logEntry, 'utf8');

    // Redis 저장 - 위험 점수 10 이상인 경우만
    if (score >= 10) {
      await redis.zadd('high_risk_urls', score, JSON.stringify({ url, location, timestamp }));
    }

    res.json({
      url,
      safe: isSafe,
      reason: isSafe ? '안전한 링크입니다' : '피싱 위험 요소 감지됨',
      score
    });
  } catch (err) {
    res.status(500).json({
      error: '검사 중 오류 발생',
      detail: err.message,
    });
  }
});

// 관리자용 신고 내역 확인 라우트
app.get('/admin/reports', (req, res) => {
  let logContent = '';
  try {
    logContent = fs.readFileSync('report.log', 'utf8');
  } catch (e) {
    logContent = '';
  }
  const rows = logContent
    .trim()
    .split('\n')
    .map(line => {
      const [time, url, location, scoreInfo] = line.split(' | ');
      return `<tr><td>${time}</td><td>${url}</td><td>${location}</td><td>${scoreInfo}</td></tr>`;
    }).join('');

  const html = `
    <html>
      <head><title>신고된 URL 목록</title></head>
      <body>
        <h1>🛡️ 사용자 신고/탐지 내역</h1>
        <table border="1" cellspacing="0" cellpadding="8">
          <tr><th>시간</th><th>URL</th><th>위치</th><th>점수</th></tr>
          ${rows}
        </table>
      </body>
    </html>`;
  res.send(html);
});

// 고위험 URL만 Redis에서 불러오는 관리자 라우트
app.get('/admin/highrisk', async (req, res) => {
  const results = await redis.zrangebyscore('high_risk_urls', 10, '+inf');
  const rows = results.map((entry) => {
    const { url, location, timestamp } = JSON.parse(entry);
    return `<tr><td>${timestamp}</td><td>${url}</td><td>${location}</td></tr>`;
  }).join('');

  const html = `
    <html>
      <head><title>고위험 URL 목록</title></head>
      <body>
        <h1>🚨 고위험 QR 탐지 내역</h1>
        <table border="1" cellspacing="0" cellpadding="8">
          <tr><th>시간</th><th>URL</th><th>위치</th></tr>
          ${rows}
        </table>
      </body>
    </html>`;

  res.send(html);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});