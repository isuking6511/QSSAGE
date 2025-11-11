# 🧠 QSSAGE — QR 피싱 탐지 및 자동 신고 시스템

> “QR 코드의 편리함 뒤에 숨은 위험을, 실시간으로 차단하라.”

---

## 📌 프로젝트 개요

**QSSAGE**는 QR코드를 이용한 피싱(스미싱) 공격을 탐지하고 차단하는  
**실시간 QR 보안·신고 시스템**입니다.  

사용자가 QR을 스캔하면 **백엔드 서버를 거쳐 URL을 분석**하고,  
안전한 링크는 즉시 리다이렉트, 의심스러운 링크는 차단 및 DB에 저장됩니다.  

관리자는 **웹 대시보드**를 통해 신고된 URL을 실시간으로 확인하고,  
**메일 자동 신고 / 백업 / 웹훅 알림**을 통해  
국가기관 신고 프로세스를 자동화할 수 있습니다.

---

## 🎯 주요 기능

| 구분 | 기능 | 설명 |
|------|------|------|
| 🔍 QR 탐지 | 스캔한 URL 정규화 및 보안 검사 | Puppeteer 기반 DOM 분석, 화이트리스트/블랙리스트 필터링 |
| 🚫 피싱 차단 | 의심 URL 접근 차단 | `ERR_BLOCKED_BY_CLIENT` 발생 시 DB 저장 및 차단 알림 |
| 📡 관리자 대시보드 | 신고 URL 실시간 모니터링 | React + Tailwind UI, 검색/선택/삭제/일괄 신고 |
| 📬 자동 신고 | 신고 대상 메일 발송 | Nodemailer, Gmail App Password 사용 |
| 🕒 자동 백업 | 매일 03:00, DB 백업 + 메일 전송 | PDF, CSV 자동 생성 + 이메일 첨부 |
| 🔔 웹훅 알림 | 신고 즉시 Slack/Discord 전송 | Webhook API로 운영자 실시간 알림 |
| 📊 통계 및 시각화(예정) | 신고 건수, 지역 분포, 탐지율 그래프 | Chart.js, Leaflet.js 기반 시각화 예정 |

---

## 🧩 시스템 구조

[ Expo App ]  →  [ Express Server ]
├── /scan        (QR 분석)
├── /report      (신고 관리)
├── /dispatch    (메일 신고)
├── /backup      (자동 백업)
└── /webhook     (Slack/Discord)
↓
[ PostgreSQL ]
↓
[ Admin Dashboard ]

---

## 💡 기술 스택

| 분류 | 기술 |
|------|------|
| **Frontend (관리자 대시보드)** | React 18, Vite, TailwindCSS, Axios |
| **Mobile (사용자 앱)** | Expo, React Native, Expo Camera, Linking |
| **Backend** | Node.js (ESM), Express, Puppeteer, CORS |
| **Database** | PostgreSQL 16 (Docker Compose) |
| **Mail/Automation** | Nodemailer, node-cron, pdfkit, json2csv |
| **Notification** | Discord Webhook API |
| **Infra** | Docker, .env 관리, 로컬 네트워크 연동 |

---

## ⚙️ 기능별 구성 파일

qr-backend/
├── database/
│   ├── docker-compose.yml      # PostgreSQL 실행
│   ├── pool.js                 # DB 연결 풀
│   └── reports.sql             # 테이블 스키마
│
├── routes/
│   ├── reportRoutes.js         # 신고 API
│   ├── dispatchRoutes.js       # 메일 신고 API
│   └── …
│
├── services/
│   ├── mailService.js          # 공용 메일 전송
│   ├── backupService.js        # 자동 백업 + 이메일 전송
│   ├── webhookService.js       # Webhook 실시간 알림
│
├── backup/                     # 자동 생성 (CSV, PDF)
├── .env                        # 환경 변수 설정
└── server.js                   # Express 메인 엔트리

---

## 🧾 데이터 구조

### reports 테이블
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | SERIAL | PK |
| url | TEXT | 신고된 URL |
| location | TEXT | 사용자 위치 |
| detected_at | TIMESTAMPTZ | 탐지 시각 |
| dispatched | BOOLEAN | 메일 발송 여부 |
| dispatched_at | TIMESTAMPTZ | 신고 메일 발송 시각 |
| dispatch_error | TEXT | 오류 메시지 |

---

## 🕹️ 동작 시나리오

### 1. 사용자 스캔
- Expo 앱에서 QR 코드 스캔
- URL → 백엔드 `/scan` 전송
- 안전하면 `Linking.openURL(url)`
- 위험하면 “의심 URL 차단” 알림 후 `/report` 저장

### 2. 관리자 모니터링
- Vite 기반 대시보드에서 신고 내역 조회 (`GET /report`)
- 검색, 일괄 선택, 삭제 가능
- `/dispatch/manual` 버튼으로 메일 신고 가능

### 3. 자동 백업 & 알림
- 매일 03:00 `backupService`가 실행됨
- DB → CSV/PDF 변환 → Gmail 자동 전송
- 신규 신고 시 `webhookService`가 Discord/Slack에 메시지 전송

---

## 🚀 실행 방법

### 📦 백엔드
```bash
cd qr-backend
npm install
npx puppeteer browsers install chrome
node server.js


### 🧠 관리자 대시보드
cd admin-dashboard
npm install
npm run dev

### 📱 사용자 앱
npm install
npx expo start




# 1️⃣ PostgreSQL 실행
cd qr-backend/database
docker compose up -d

# 2️⃣ 백엔드 서버 실행
cd ..
node server.js

# 3️⃣ 관리자 대시보드 실행
cd ../admin-dashboard
npm run dev
