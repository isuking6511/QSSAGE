const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

app.post('/scan', async (req, res) => {
  const { url } = req.body;
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

    // === 점수화 시작 ===
    let score = 0;

    // 🔁 리디렉션 감지
    const metaRedirectExists = await page.$('meta[http-equiv="refresh"]');
    if (metaRedirectExists) {
      console.log("🚨 meta 리디렉션 감지됨");
      score += 4;
    }

    const html = await page.content();
    const hasJsRedirect =
      html.includes('location.href') ||
      html.includes('window.location') ||
      html.includes('window.open') ||
      html.includes('location.replace');

    if (hasJsRedirect) {
      console.log("🚨 JavaScript 리디렉션 코드 감지됨");
      score += 3;
    }

    // 🧩 iframe + script 조합 (기존 로직 유지)
    const hasIframe = html.includes('<iframe');
    const hasScript = html.includes('<script');
    if (hasIframe && hasScript) {
      console.log("⚠️ iframe + script 포함됨");
      score += 3;
    }

    await browser.close();

    // ✅ 최종 판단
    const isSafe = score < 5;

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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});