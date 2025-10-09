const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

// ===== 설정 =====
const PORT = process.env.PORT || 3000;
const NAV_TIMEOUT = 15000;
const POST_NAV_WAIT = 2500;

const WHITELIST_HOSTS = new Set([
  'google.com','www.google.com',
  'naver.com','www.naver.com',
  'kakao.com','www.kakao.com'
]);

const WEIGHTS = {
  evalDetected: 18,
  base64EvalDetected: 22,
  hasPasswordInput: 20,
  formsToExternal: 25,
  redirects1: 4,
  redirectsMany: 10,
  httpsMissing: 6,
  hiddenIframes: 8,
  externalScriptMany: 6,
  hostIsIP: 28,
  punycode: 20,
  isShortener: 15,
  externalFormWithPasswordBonus: 20
};

// 유틸: URL 보정
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

// ===== 페이지 분석 함수 =====
async function analyzePage(page, originalUrl, evalDetected, base64EvalDetected) {
  const result = {
    originalUrl,
    finalUrl: originalUrl,
    score: 0,
    reasons: [],
    redirects: 0,
    formsToExternal: [],
    hasPasswordInput: false,
    hiddenIframes: 0,
    externalScriptCount: 0,
    isShortener: false,
    hostIsIP: false,
    punycode: false,
    risk: 'unknown'
  };

  try {
    const nav = await page.goto(originalUrl, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT }).catch(()=>null);
    result.finalUrl = page.url() || originalUrl;
    if (nav) {
      const chain = nav.request().redirectChain();
      result.redirects = chain.length;
    }
  } catch {}

  const domInfo = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form')).map(f => ({
      action: f.action || '',
      method: (f.method || '').toLowerCase()
    }));
    const passwordExists = !!document.querySelector('input[type="password"]');
    const iframes = Array.from(document.querySelectorAll('iframe')).map(i => {
      const style = window.getComputedStyle(i);
      return {
        src: i.src || '',
        hidden: (style.display === 'none' || style.visibility === 'hidden' || i.width === "0" || i.height === "0")
      };
    });
    const scripts = Array.from(document.scripts).map(s => s.src || '');
    return { forms, passwordExists, iframes, scripts };
  });

  try {
    const parsedFinal = new URL(result.finalUrl);
    result.finalHostname = parsedFinal.hostname.toLowerCase();
    for (const f of domInfo.forms) {
      if (!f.action) continue;
      try {
        const actionUrl = new URL(f.action, result.finalUrl);
        if (actionUrl.hostname !== parsedFinal.hostname) {
          result.formsToExternal.push(actionUrl.href);
        }
      } catch {}
    }
  } catch {}

  result.hasPasswordInput = domInfo.passwordExists;
  result.hiddenIframes = domInfo.iframes.filter(i => i.hidden).length;
  result.externalScriptCount = domInfo.scripts.filter(s => {
    try {
      const u = new URL(s, result.finalUrl);
      return u.hostname !== (new URL(result.finalUrl)).hostname;
    } catch {
      return false;
    }
  }).length;

  try {
    const parsedOrig = new URL(originalUrl);
    const host = parsedOrig.hostname.toLowerCase();
    result.host = host;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) result.hostIsIP = true;
    if (host.startsWith('xn--')) result.punycode = true;
    const shorteners = ['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','is.gd','tiny.one','rb.gy'];
    result.isShortener = shorteners.includes(host);
    result.isHttps = parsedOrig.protocol === 'https:';
  } catch {}

  // === 점수 계산 ===
  if (evalDetected) { result.score += WEIGHTS.evalDetected; result.reasons.push('eval() 의심 코드 탐지'); }
  if (base64EvalDetected) { result.score += WEIGHTS.base64EvalDetected; result.reasons.push('base64->eval 의심'); }
  if (!result.isHttps) { result.score += WEIGHTS.httpsMissing; result.reasons.push('HTTPS 미사용'); }

  // 리디렉션: 단독일 때는 점수 거의 안 줌, 다른 조건과 결합했을 때만 강화
  if (result.redirects === 1) {
    result.score += WEIGHTS.redirects1; 
    result.reasons.push('리디렉션 1회');
  } else if (result.redirects > 1) {
    if (!result.isHttps || result.formsToExternal.length || result.hasPasswordInput) {
      // 리디렉션 + HTTPS 없음, 또는 외부 폼/비밀번호 필드가 있을 때만 강하게 반영
      result.score += WEIGHTS.redirectsMany;
      result.reasons.push(`리디렉션 ${result.redirects}회 + 의심 요소 동반`);
    } else {
      // 단순 광고/트래킹 리디렉션은 낮은 점수만 부여
      result.score += 3;
      result.reasons.push(`리디렉션 ${result.redirects}회 (광고 가능성, 낮은 가중치)`);
    }
  }

  if (result.hiddenIframes > 0) { result.score += WEIGHTS.hiddenIframes; result.reasons.push(`숨긴 iframe ${result.hiddenIframes}개`); }
  if (result.externalScriptCount > 10) { result.score += WEIGHTS.externalScriptMany; result.reasons.push(`외부 스크립트 다수 (${result.externalScriptCount})`); }
  if (result.hostIsIP) { result.score += WEIGHTS.hostIsIP; result.reasons.push('호스트가 IP 주소'); }
  if (result.punycode) { result.score += WEIGHTS.punycode; result.reasons.push('Punycode 도메인 (xn--)'); }
  if (result.isShortener) { result.score += WEIGHTS.isShortener; result.reasons.push('단축 URL 사용'); }

  if (result.formsToExternal.length) {
    result.score += WEIGHTS.formsToExternal * 0.6;
    result.reasons.push(`외부 폼 제출 (${result.formsToExternal.length})`);
    if (result.hasPasswordInput) {
      result.score += WEIGHTS.externalFormWithPasswordBonus;
      result.reasons.push('외부 폼 + 비밀번호 입력 필드 동시 존재');
    }
  }

  if (result.hasPasswordInput) {
    result.score += WEIGHTS.hasPasswordInput;
    result.reasons.push('비밀번호 입력 필드 존재');
  }

  try {
    const hostLower = (new URL(originalUrl)).hostname.toLowerCase();
    if (WHITELIST_HOSTS.has(hostLower) || WHITELIST_HOSTS.has(result.finalHostname)) {
      const reduction = Math.min(40, result.score);
      result.score = Math.max(0, result.score - reduction);
      result.reasons.push(`화이트리스트 도메인 보정 (-${reduction})`);
      result.whitelisted = true;
    }
  } catch {}

  if (result.score <= 25) result.risk = '✅ 안전';
  else if (result.score <= 55) result.risk = '⚠️ 주의';
  else result.risk = '🚨 위험';

  return result;
}

// ===== API 엔드포인트 =====
app.post('/scan', async (req, res) => {
  let { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL이 필요합니다' });
  url = normalizeUrlCandidate(url);
  if (!url) return res.status(400).json({ error: '유효한 URL이 아닙니다' });

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      const originalEval = window.eval;
      const originalAtob = window.atob;
      window.__evalDetected = false;
      window.__base64EvalDetected = false;
      window.eval = function (code) {
        try {
          const suspicious = ['location.href','window.open','document.write','atob','unescape'];
          let evalScore = suspicious.filter(k => String(code).includes(k)).length * 2;
          if (String(code).length > 300) evalScore++;
          if (/[_$a-zA-Z]{5,}\d{2,}/.test(String(code))) evalScore += 2;
          if (evalScore >= 3) window.__evalDetected = true;
        } catch {}
        return originalEval.apply(this, arguments);
      };
      window.atob = function (encoded) {
        const decoded = originalAtob.apply(this, arguments);
        if (/(eval|document\.write|window\.open|location\.href)/i.test(String(decoded))) {
          window.__base64EvalDetected = true;
        }
        return decoded;
      };
    });

    // helper delay (waitForTimeout 대체)
    function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

    await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT }).catch(()=>null);
    await delay(POST_NAV_WAIT);

    const evalDetected = await page.evaluate(() => !!window.__evalDetected).catch(()=>false);
    const base64EvalDetected = await page.evaluate(() => !!window.__base64EvalDetected).catch(()=>false);

    const analysis = await analyzePage(page, url, evalDetected, base64EvalDetected);

    await browser.close();
    res.json(analysis);
  } catch (err) {
    if (browser) try { await browser.close(); } catch {}
    res.status(500).json({ error: '검사 중 오류', detail: err.message });
  }
});

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});