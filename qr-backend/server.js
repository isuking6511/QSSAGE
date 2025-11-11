import express from 'express';
import puppeteer from 'puppeteer';
import reportRoutes from './routes/reportRoutes.js';
import dispatchRoutes from './routes/dispatchRoutes.js';
import cors from 'cors';
import 'dotenv/config';
import cron from 'node-cron';
import dispatchRoutes from './routes/dispatchRoutes.js';

app.use('/dispatch', dispatchRoutes);

cron.schedule('0 * * * *', async () => {
  console.log(' 매시간 자동 신고 실행');
  await fetch('http://localhost:3000/dispatch', { method: 'POST' });
});
const app = express();
app.use(cors({ origin: process.env.ALLOW_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
app.use('/report', reportRoutes);
app.use('/dispatch', dispatchRoutes);

// ===== 설정 =====
const PORT = process.env.PORT || 3000;
const NAV_TIMEOUT = 10000;  // 페이지 로딩 최대 대기 시간

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
  evalDetected: 20,           // eval 50자 이상 = 의심 (정상 사이트는 거의 안 씀)
  base64EvalDetected: 30,     // base64 악성 코드는 더 높은 가중치
  hasPasswordInput: 8,        // 로그인 페이지는 정상적이므로 점수 대폭 감소
  formsToExternal: 12,        // 외부 폼도 점수 감소 (광고/분석 도구 등)
  redirects1: 2,              // 1회 리디렉션은 거의 무시
  redirectsMany: 6,           // 다중 리디렉션도 점수 감소
  httpsMissing: 3,            // HTTP 사이트 점수 감소 (많은 사이트가 아직 HTTP)
  hiddenIframes: 10,          // 숨겨진 iframe은 여전히 의심스러움
  externalScriptMany: 4,      // 외부 스크립트 점수 감소 (CDN, 광고 등)
  externalImagesMany: 5,      // 외부 이미지 많음 (급조 피싱 의심, 낮은 점수)
  hostIsIP: 35,               // IP 주소는 여전히 높은 위험
  punycode: 25,               // Punycode는 여전히 의심스러움
  isShortener: 8,             // 단축 URL 점수 감소 (많이 사용됨)
  externalFormWithPasswordBonus: 30  // 외부 폼+비밀번호 = 피싱 핵심 패턴! 가중치 대폭 상승
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
async function analyzePage(page, originalUrl, evalDetected, base64EvalDetected, actualRedirectCount, actualFinalUrl) {
  const result = {
    originalUrl,
    finalUrl: actualFinalUrl || originalUrl,
    score: 0,
    reasons: [],
    redirects: actualRedirectCount || 0,
    formsToExternal: [],
    hasPasswordInput: false,
    hiddenIframes: 0,
    externalScriptCount: 0,
    externalImageCount: 0,
    isShortener: false,
    hostIsIP: false,
    punycode: false,
    risk: 'unknown'
  };

  // DOM level info (forms, password inputs, iframes, scripts, images)
  const domInfo = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form')).map(f => ({
      action: f.getAttribute('action') || '',
      method: (f.getAttribute('method') || '').toLowerCase()
    }));
    const passwordExists = !!document.querySelector('input[type="password"]');
    const iframes = Array.from(document.querySelectorAll('iframe')).map(i => {
      const style = window.getComputedStyle(i);
      return {
        src: i.src || '',
        hidden: (style.display === 'none' || style.visibility === 'hidden' || i.width === "0" || i.height === "0")
      };
    });
    const scripts = Array.from(document.scripts).map(s => s.src || s.innerText || '');
    const images = Array.from(document.querySelectorAll('img')).map(img => img.src || '');
    return { forms, passwordExists, iframes, scripts, images };
  }).catch(() => ({ forms: [], passwordExists: false, iframes: [], scripts: [], images: [] }));

  // get raw HTML to scan for static indicators (base64, eval strings, atob usage etc.)
  let pageContent = '';
  try {
    pageContent = await page.content();
  } catch (e) { /* ignore */ }

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
      } catch {
        // if action is relative but there is a password input on the page, flag it later
      }
    }
  } catch {}

  result.hasPasswordInput = domInfo.passwordExists;
  result.hiddenIframes = domInfo.iframes.filter(i => i.hidden).length;

  // external scripts/images counting: treat inline scripts with suspicious keywords as external-weight-equivalent
  result.externalScriptCount = domInfo.scripts.filter(s => {
    try {
      const u = new URL(s, result.finalUrl);
      return u.hostname !== (new URL(result.finalUrl)).hostname;
    } catch {
      // inline script: count as external if contains suspicious keywords
      return /eval\(|atob\(|fromCharCode|window\.|document\.|location\.|replace\(|\bbase64\b/i.test(s);
    }
  }).length;

  result.externalImageCount = domInfo.images.filter(img => {
    try {
      const u = new URL(img, result.finalUrl);
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
    const shorteners = ['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','is.gd','tiny.one','rb.gy','qrfy.io'];
    result.isShortener = shorteners.includes(host);
    result.isHttps = parsedOrig.protocol === 'https:';
  } catch {}

  // === Static content scans for base64/eval strings (covers pre-decoded payloads) ===
  const staticSuspicion = [];
  if (pageContent && /(?:atob\(|base64_decode\(|window\.atob|btoa\(|eval\(|fromCharCode\(|\bbase64\b)/i.test(pageContent)) {
    staticSuspicion.push('정적 JS/HTML 내 eval/atob/base64 패턴 발견');
    result.score += WEIGHTS.base64EvalDetected * 0.7; // partial weight for static detection
  }

  // === scoring ===
  if (pageContent && /(password\")|(input\s+type=\"password\")/i.test(pageContent)) {
    result.hasPasswordInput = true;
    result.score += WEIGHTS.hasPasswordInput;
    result.reasons.push('비밀번호 입력 필드 존재(정적탐지)');
  }

  if (evalDetected) { result.score += WEIGHTS.evalDetected; result.reasons.push('eval() 동적 실행 감지'); }
  if (base64EvalDetected) { result.score += WEIGHTS.base64EvalDetected; result.reasons.push('base64->eval 동적 탐지'); }
  if (!result.isHttps) { result.score += WEIGHTS.httpsMissing; result.reasons.push('HTTPS 미사용'); }

  // redirect scoring (keep original but slightly stronger when combined with other flags)
  if (result.redirects === 1) {
    result.score += WEIGHTS.redirects1; 
    result.reasons.push('리디렉션 1회');
  } else if (result.redirects > 1) {
    if (!result.isHttps || result.formsToExternal.length || result.hasPasswordInput) {
      result.score += WEIGHTS.redirectsMany;
      result.reasons.push(`리디렉션 ${result.redirects}회 + 의심 요소`);
    } else {
      result.score += 3;
      result.reasons.push(`리디렉션 ${result.redirects}회 (낮은 가중치)`);
    }
  }

  if (result.hiddenIframes > 0) {
    result.score += WEIGHTS.hiddenIframes;
    result.reasons.push(`숨긴 iframe ${result.hiddenIframes}개`);
    if (result.redirects >= 2) {
      result.score += 40; // slightly lower than before but still strong
      result.reasons.push('다중 리디렉션 + 숨긴 iframe 조합 (강력 의심)');
    } else if (result.redirects === 1) {
      result.score += 20;
      result.reasons.push('리디렉션 + 숨긴 iframe (의심)');
    }
  }

  if (result.externalScriptCount > 10) { result.score += WEIGHTS.externalScriptMany; result.reasons.push(`외부/의심 스크립트 다수 (${result.externalScriptCount})`); }
  if (result.externalImageCount > 5) { result.score += WEIGHTS.externalImagesMany; result.reasons.push(`외부 이미지 다수 (${result.externalImageCount})`); }
  if (result.hostIsIP) { result.score += WEIGHTS.hostIsIP; result.reasons.push('호스트가 IP 주소'); }
  if (result.punycode) { result.score += WEIGHTS.punycode; result.reasons.push('Punycode 도메인 (xn--)'); }
  if (result.isShortener) { result.score += WEIGHTS.isShortener; result.reasons.push('단축 URL 사용'); }

  // forms: if there is a password input on page but actions are relative, treat as suspicious
  if (domInfo.forms.length) {
    const externalCount = result.formsToExternal.length;
    if (externalCount) {
      result.score += WEIGHTS.formsToExternal * 0.6;
      result.reasons.push(`외부 폼 제출 (${externalCount})`);
    } else if (result.hasPasswordInput && domInfo.forms.some(f => !f.action || f.action.trim() === '')) {
      // relative action with password fields is suspicious
      result.score += WEIGHTS.formsToExternal * 0.8;
      result.reasons.push('상대경로/빈 action + 비밀번호 입력 조합(의심)');
    }
    if (result.hasPasswordInput && result.formsToExternal.length) {
      result.score += WEIGHTS.externalFormWithPasswordBonus;
      result.reasons.push('외부 폼 + 비밀번호 입력 필드 동시 존재');
    }
  }

  // static suspicion messages
  for (const m of staticSuspicion) result.reasons.push(m);

  // whitelist adjustment remains but less absolute: subtract smaller amount so suspicious payloads still surface
  try {
    const hostLower = (new URL(originalUrl)).hostname.toLowerCase();
    if (WHITELIST_HOSTS.has(hostLower) || WHITELIST_HOSTS.has(result.finalHostname)) {
      const originalScore = result.score;
      // reduce but not zero out
      result.score = Math.max(0, result.score - 50);
      result.reasons.push(`✅ 신뢰 도메인 보정 (-${originalScore - result.score})`);
      result.whitelisted = true;
    }
  } catch {}

  // new thresholds: more sensitive
  if (result.score <= 10) result.risk = '✅ 안전';
  else if (result.score <= 25) result.risk = '⚠️ 주의';
  else result.risk = '🚨 위험';

  return result;
}

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

    // 🔍 리디렉션 추적
    let actualRedirectCount = 0; //리디렉션 카운팅
    let redirectDestinations = [url]; //거쳐간 URL
    let lastNavigationTime = Date.now(); //마지막 리디렉션 발생 시간
    
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const newUrl = frame.url(); //새로 이동한 URL
        if (newUrl !== redirectDestinations[redirectDestinations.length - 1]) { //URL 다르면 리디렉션 발생.
          actualRedirectCount++; 
          redirectDestinations.push(newUrl);
          lastNavigationTime = Date.now();
          console.log(`리디렉션 ${actualRedirectCount}: ${newUrl}`);
        }
      }
    });

    await page.evaluateOnNewDocument(() => {
      const originalEval = window.eval;
      const originalAtob = window.atob;
      window.__evalDetected = false;
      window.__base64EvalDetected = false;
      window.eval = function (code) {
        try {
          // eval 자체가 의심스러움! 정상 사이트는 거의 안 씀
          const codeStr = String(code);
          
          // 50자 이상의 eval 코드는 무조건 의심!
          if (codeStr.length > 50) {
            window.__evalDetected = true;
          }
        } catch {}
        return originalEval.apply(this, arguments);
      };
      window.atob = function (encoded) {
        const decoded = originalAtob.apply(this, arguments);
        const decodedStr = String(decoded);
        
        // 화이트해커 레벨 탐지 🔥
        let suspicionScore = 0;
        
        // 치명적인 조합 패턴 우선 체크 (즉시 탐지!)
        
        // 1. eval + location 조합 (리디렉션 공격)
        if ((/eval/i.test(decodedStr) && /location/i.test(decodedStr)) ||
            /eval.*location|location.*eval/i.test(decodedStr)) {
          suspicionScore += 15;  // 거의 100% 악성!
        }
        
        // 2. eval + document.write 조합 (페이지 덮어쓰기 공격)
        if ((/eval/i.test(decodedStr) && /document\.write/i.test(decodedStr)) ||
            /eval.*document\.write|document\.write.*eval/i.test(decodedStr)) {
          suspicionScore += 15;  // 페이지 하이재킹!
        }
        
        // 3. cookie + (fetch|XMLHttpRequest) 조합 (쿠키 탈취)
        if (/cookie/i.test(decodedStr) && (/fetch|XMLHttpRequest/i.test(decodedStr))) {
          suspicionScore += 12;  // 쿠키 전송 공격!
        }
        
        // 4. iframe + (hidden|display.*none|visibility.*hidden) 조합 (숨은 프레임 공격)
        if (/iframe/i.test(decodedStr) && 
            /(hidden|display\s*:\s*none|visibility\s*:\s*hidden)/i.test(decodedStr)) {
          suspicionScore += 10;  // 숨은 악성 프레임!
        }
        
        // 5. 일반 위험 키워드 체크
        const dangerKeywords = [
          /eval/i, /location/i, /document\./i, /window\./i, 
          /\.href/i, /\.write/i, /\.open/i, /\.replace/i,
          /script/i, /iframe/i, /fetch/i, /XMLHttpRequest/i,
          /cookie/i, /localStorage/i, /sessionStorage/i
        ];
        suspicionScore += dangerKeywords.filter(pattern => pattern.test(decodedStr)).length * 2;
        
        // 6. 16진수/유니코드 인코딩 숨김 (\\x, \\u)
        if (/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i.test(decodedStr)) suspicionScore += 4;
        
        // 7. 문자열 분해 패턴 (난독화)
        if (/['"][+]['"]|['"][\s]*\+[\s]*['"]/g.test(decodedStr)) suspicionScore += 3;
        
        // 8. 코드 길이 체크
        if (decodedStr.length > 100) suspicionScore += 2;
        if (decodedStr.length > 300) suspicionScore += 4;
        
        // 9. 다중 Base64 인코딩 (atob 안에 atob)
        if (/atob\s*\(/i.test(decodedStr)) suspicionScore += 8;  // 다중 인코딩은 매우 의심!
        
        // 10. 난독화 변수명 패턴
        if (/[_$][a-z0-9]{3,}\d{2,}/i.test(decodedStr)) suspicionScore += 3;
        
        // 11. 배열/객체 접근 난독화 (window['location'], document['write'])
        if (/\[['"](location|href|write|cookie|eval)['"]\]/i.test(decodedStr)) suspicionScore += 5;
        
        // 12. 정상 광고 스크립트 예외 처리 (오탐 방지)
        if (/google-analytics|gtag|_ga|facebook|fbevents|_fbq|doubleclick/i.test(decodedStr)) {
          suspicionScore = Math.max(0, suspicionScore - 6);  // 광고는 점수 감소
        }
        
        // 의심 점수 8점 이상이면 탐지! (기준 상향)
        if (suspicionScore >= 8) {
          window.__base64EvalDetected = true;
        }
        
        return decoded;
      };
    });

    // helper delay (waitForTimeout 대체)
    function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

    // 🚀 네트워크 아이들까지 기다리고, 추가 JS 실행 시간 확보
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
      // allow additional JS-driven late insertions (iframes/forms) to appear
      await delay(3000);
    } catch (err) {
      const host = new URL(url).hostname.toLowerCase();

      // 차단된 URL 또는 접근 불가 시 피싱 의심 처리
      if (err.message && err.message.includes('net::ERR_BLOCKED_BY_CLIENT')) {
        console.log('🚨 피싱 의심: 클라이언트 차단됨 -> DB에 저장');
        try {
          await fetch('http://localhost:' + PORT + '/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
        } catch (dbErr) {
          console.log('⚠️ DB 저장 중 오류:', dbErr.message);
        }

        await browser.close();
        return res.json({
          safe: false,
          risk: '🚨 위험',
          reason: '클라이언트에서 차단된 URL (피싱 또는 악성 의심)',
          url
        });
      }

      // 화이트리스트 도메인은 예외 처리
      if (WHITELIST_HOSTS.has(host)) {
        console.log('✅ 화이트리스트 도메인 접근 실패 무시:', host);
        await browser.close();
        return res.json({
          safe: true,
          reason: '✅ 신뢰 도메인 (화이트리스트, Puppeteer 차단 무시)',
        });
      }

      console.log('❌ 페이지 접근 실패:', err.message);
      await browser.close();
      return res.json({
        safe: false,
        risk: '🚨 위험',
        reason: '페이지 접근 실패 (피싱 또는 차단된 사이트 가능성)',
        url
      });
    }
    // await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(()=>null);
    
    // 🎯 하이브리드 리디렉션 추적: 동적 대기 + 안전장치!
    const REDIRECT_SETTLE_TIME = 2000;  // 2초간 리디렉션 없으면 끝!
    const MAX_WAIT_TIME = 15000;  // max 15초 대기
    const startWaitTime = Date.now();
    
    // 1단계: 기본 동적 대기
    while (Date.now() - lastNavigationTime < REDIRECT_SETTLE_TIME) {
      if (Date.now() - startWaitTime > MAX_WAIT_TIME) {
        console.log('⏰ 최대 대기 시간 초과');
        break;
      }
      await delay(500);
    }
    
    console.log(`리디렉션 1차 완료! (총 ${actualRedirectCount}회)`);
    
    // 2단계: 추가 안전 대기 (late 리디렉션 감지)
    const countBeforeSafetyWait = actualRedirectCount;
    await delay(1000);  // 1초 더 대기
    
    // 3단계: 1초 동안 추가 리디렉션 발생했는지
    if (actualRedirectCount > countBeforeSafetyWait) {
      console.log('늦은 리디렉션 감지! 재대기 시작...');
      
      // 다시 동적 대기
      while (Date.now() - lastNavigationTime < REDIRECT_SETTLE_TIME) {
        if (Date.now() - startWaitTime > MAX_WAIT_TIME) {
          console.log('최대 대기 시간 초과');
          break;
        }
        await delay(500);
      }
      
      console.log(`추가 리디렉션 완료! (총 ${actualRedirectCount}회)`);
    }
  
    console.log(`최종 분석 시작! (총 리디렉션: ${actualRedirectCount}회, 총 대기: ${Math.floor((Date.now() - startWaitTime) / 1000)}초)`);

    const evalDetected = await page.evaluate(() => !!window.__evalDetected).catch(()=>false);
    const base64EvalDetected = await page.evaluate(() => !!window.__base64EvalDetected).catch(()=>false);

    // 실제 리디렉션 정보 전달
    const analysis = await analyzePage(page, url, evalDetected, base64EvalDetected, actualRedirectCount, redirectDestinations[redirectDestinations.length - 1]);

    // 🚨 위험하거나 ⚠️ 주의일 때 자동 신고 저장
    if (analysis.risk !== '✅ 안전') {
      // 내부적으로 /report 엔드포인트로 POST 요청 (DB 직접 접근 대신)
      await fetch('http://localhost:' + PORT + '/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      }).catch(() => {});
    }

    await browser.close();
    
    // 앱이 기대하는 형식으로 응답 변환
    const response = {
      ...analysis,
      safe: analysis.risk === '✅ 안전',
      reason: analysis.risk + (analysis.reasons.length > 0 ? ' - ' + analysis.reasons.join(', ') : '')
    };
    
    console.log('📊 분석 결과:', response);
    if (analysis.risk === '✅ 안전') {
      console.log('✅ 안전 사이트입니다.');
      return res.json({ safe: true, url, reason: response.reason });
    } else {
      return res.json(response);
    }
  } catch (err) {
    console.error('❌ 분석 중 오류:', err);
    if (browser) try { await browser.close(); } catch {}
    res.status(500).json({ error: '검사 중 오류', detail: err.message });
  }
});




// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});