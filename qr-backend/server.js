const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
// 간단 CORS 허용 (모바일 앱 호출용)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ===== 설정 =====
const PORT = process.env.PORT || 3000;
const NAV_TIMEOUT = 10000;  // 15초 -> 10초로 단축
const POST_NAV_WAIT = 1500; // 2.5초 -> 1.5초로 단축

const WHITELIST_HOSTS = new Set([
  // 검색엔진
  'google.com','www.google.com',
  'naver.com','www.naver.com',
  'daum.net','www.daum.net',
  'bing.com','www.bing.com',
  'yahoo.com','www.yahoo.com',
  
  // 소셜미디어
  'kakao.com','www.kakao.com',
  'facebook.com','www.facebook.com',
  'instagram.com','www.instagram.com',
  'twitter.com','www.twitter.com','x.com','www.x.com',
  'youtube.com','www.youtube.com',
  'linkedin.com','www.linkedin.com',
  
  // 주요 서비스
  'github.com','www.github.com',
  'stackoverflow.com','www.stackoverflow.com',
  'amazon.com','www.amazon.com',
  'microsoft.com','www.microsoft.com',
  'apple.com','www.apple.com',
  'netflix.com','www.netflix.com',
  'spotify.com','www.spotify.com',
  
  // 한국 주요 사이트
  'coupang.com','www.coupang.com',
  '11st.co.kr','www.11st.co.kr',
  'gmarket.co.kr','www.gmarket.co.kr',
  'auction.co.kr','www.auction.co.kr',
  'tistory.com','www.tistory.com',
  'blog.naver.com',
  'cafe.naver.com'
]);

const WEIGHTS = {
  evalDetected: 25,           // 악성 코드 탐지는 높은 가중치 유지
  base64EvalDetected: 30,     // base64 악성 코드는 더 높은 가중치
  hasPasswordInput: 8,        // 로그인 페이지는 정상적이므로 점수 대폭 감소
  formsToExternal: 12,        // 외부 폼도 점수 감소 (광고/분석 도구 등)
  redirects1: 2,              // 1회 리디렉션은 거의 무시
  redirectsMany: 6,           // 다중 리디렉션도 점수 감소
  httpsMissing: 3,            // HTTP 사이트 점수 감소 (많은 사이트가 아직 HTTP)
  hiddenIframes: 10,          // 숨겨진 iframe은 여전히 의심스러움
  externalScriptMany: 4,      // 외부 스크립트 점수 감소 (CDN, 광고 등)
  hostIsIP: 35,               // IP 주소는 여전히 높은 위험
  punycode: 25,               // Punycode는 여전히 의심스러움
  isShortener: 8,             // 단축 URL 점수 감소 (많이 사용됨)
  externalFormWithPasswordBonus: 15  // 외부 폼+비밀번호는 여전히 위험하지만 점수 감소
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
    result.score += WEIGHTS.formsToExternal * 0.4;  // 가중치 더 감소
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
      const reduction = Math.min(50, result.score);  // 화이트리스트 보정 강화
      result.score = Math.max(0, result.score - reduction);
      result.reasons.push(`화이트리스트 도메인 보정 (-${reduction})`);
      result.whitelisted = true;
    }
  } catch {}

  if (result.score <= 15) result.risk = '✅ 안전';
  else if (result.score <= 35) result.risk = '⚠️ 주의';
  else result.risk = '🚨 위험';

  return result;
}

// ===== 신고 저장소 초기화 =====
const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
function ensureReportStore() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  try { if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, '[]', 'utf8'); } catch {}
}
ensureReportStore();

// ===== API 엔드포인트 =====
app.post('/scan', async (req, res) => {
  console.log('📨 /scan 요청 받음:', req.body);
  let { url } = req.body || {};
  if (!url) {
    console.log('❌ URL이 없음');
    return res.status(400).json({ error: 'URL이 필요합니다' });
  }
  console.log('🔍 원본 URL:', url);
  url = normalizeUrlCandidate(url);
  if (!url) {
    console.log('❌ URL 정규화 실패');
    return res.status(400).json({ error: '유효한 URL이 아닙니다' });
  }
  console.log('✅ 정규화된 URL:', url);

  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: true, 
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
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

    let analysis = await analyzePage(page, url, evalDetected, base64EvalDetected);

    // 2단계 심화 분석: 1차가 "주의"이면 추가 대기 후 재분석하여 더 위험 신호 포착
    let analysisStage = 'fast';
    if (analysis.risk === '⚠️ 주의') {
      analysisStage = 'deep';
      await delay(5000);
      const eval2 = await page.evaluate(() => !!window.__evalDetected).catch(()=>false);
      const base642 = await page.evaluate(() => !!window.__base64EvalDetected).catch(()=>false);
      const analysisDeep = await analyzePage(page, url, eval2 || evalDetected, base642 || base64EvalDetected);
      // 더 높은 위험도/점수를 채택
      if (analysisDeep.score > analysis.score) analysis = analysisDeep;
      else if (analysisDeep.risk === '🚨 위험' && analysis.risk !== '🚨 위험') analysis = analysisDeep;
    }

    // 위험도 재계산(점수 변경 반영)
    if (analysis.score <= 15) analysis.risk = '✅ 안전';
    else if (analysis.score <= 35) analysis.risk = '⚠️ 주의';
    else analysis.risk = '🚨 위험';

    await browser.close();
    
    // 앱이 기대하는 형식으로 응답 변환
    const response = {
      ...analysis,
      safe: analysis.risk === '✅ 안전',
      reason: analysis.risk + (analysis.reasons.length > 0 ? ' - ' + analysis.reasons.join(', ') : ''),
      analysisStage
    };
    
    console.log('📊 분석 결과:', response);
    res.json(response);
  } catch (err) {
    console.error('❌ 분석 중 오류:', err);
    if (browser) try { await browser.close(); } catch {}
    res.status(500).json({ error: '검사 중 오류', detail: err.message });
  }
});

// 피싱 신고 제출
app.post('/report', (req, res) => {
  try {
    const { url, note, location } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url은 필수입니다' });
    ensureReportStore();
    let list = [];
    try { list = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8')); } catch {}
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      url: String(url),
      note: typeof note === 'string' ? note.slice(0, 500) : undefined,
      location: location && typeof location === 'object' ? {
        lat: Number(location.lat), lng: Number(location.lng)
      } : null,
      createdAt: new Date().toISOString()
    };
    list.push(record);
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2), 'utf8');
    res.json({ ok: true, record });
  } catch (e) {
    res.status(500).json({ error: '신고 저장 실패', detail: String(e && e.message || e) });
  }
});

// 신고 목록 조회 (간단 제공)
app.get('/reports', (req, res) => {
  try {
    ensureReportStore();
    const list = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
    res.json({ count: Array.isArray(list) ? list.length : 0, reports: list });
  } catch (e) {
    res.status(500).json({ error: '신고 조회 실패', detail: String(e && e.message || e) });
  }
});

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});