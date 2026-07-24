<div align="center">

# 🎟️ FairQueue

### 결제 실패 없는 공식 티켓팅 보증 레이어

**Powered by Solana On-chain Escrow × Google Gemini**

[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?style=for-the-badge&logo=solana&logoColor=white)](https://explorer.solana.com/?cluster=devnet)
[![Google Cloud](https://img.shields.io/badge/Google_Cloud-Gemini-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white)](https://cloud.google.com/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](#license)

**Google Cloud x Solana AI Agentic Hackathon 2026 제출작**

[문제](#-문제) · [해결책](#-해결책) · [아키텍처](#%EF%B8%8F-아키텍처) · [기술 스택](#-기술-스택) · [데모](#-데모-시나리오) · [실행 방법](#-로컬-실행-방법) · [팀](#-팀)

</div>

<br>

> 저희는 유저가 남보다 빨리 사도록 돕는 매크로가 아니라, **플랫폼이 결제 실패 없이, 매크로 없이, 분쟁 없이 티켓을 판매하도록 돕는 결제 보증 레이어**입니다.

<br>

## 🚨 문제 의식 

기존 티켓팅 시스템은 세 가지 고질적인 문제를 안고 있습니다.

| 문제 | 영향 |
|:---|:---|
| ⏳ 대기열 순번이 올 때까지 자리 유무를 알 수 없음 | 유저 경험 저하 |
| 💳 순번이 와도 카드 입력 지연·오류로 결제 실패 | 플랫폼의 **순수 매출 손실** |
| 🔁 매진 후 환불 처리 지연 | CS 부담, 고객 불만 |
| 🤖 매크로/암표 대응 비용 | 지속적인 탐지·차단 리소스 소모 |

<br>

## ✅ 해결책

FairQueue는 유저가 조건과 함께 결제 금액을 **온체인 에스크로에 미리 예치**하게 합니다. 에이전트는 정상적인 대기열 순서를 그대로 지키며 기다리고, 순번이 왔을 때 자금은 이미 확보되어 있으므로 결제 실패가 원천 차단됩니다. 매진이거나 조건이 맞지 않으면 그 즉시 온체인에서 투명하게 환불됩니다.

<div align="center">

| | 🤖 기존 매크로 | 🎟️ FairQueue |
|:---:|:---:|:---:|
| **대기열 처리** | 우회·편법 시도 | 정상 순서 그대로 (1계정 1에이전트) |
| **목적** | 남보다 빨리 선점 | 결제 실패 방지 + 즉시 투명 환불 |
| **플랫폼과의 관계** | ❌ 대립적 (차단 대상) | ✅ 협력적 (매출 손실 방지 인프라) |
| **핵심 가치** | 속도 경쟁 | 결제 성공률 보장 + 투명성 |

</div>

<br>

##  아키텍처

```
┌─────────────┐
│    User     │  자연어로 조건 입력
│             │  "아이유 콘서트 R석, 20만원 이하, 2연석"
└──────┬──────┘
       ▼
┌─────────────────────┐
│   ✨ Gemini          │  조건 파싱 → 구조화된 JSON
│   (자연어 → 조건)     │
└──────┬───────────────┘
       ▼
┌─────────────────────┐
│  ☁️ Cloud Run         │  정상 대기열 진입 (우회 없음)
│  (구매 에이전트)       │
└──────┬───────────────┘
       ▼
┌─────────────────────┐
│  ◎ Solana Escrow     │  결제 금액 사전 예치
│  (자율 서명)          │  사람 개입 없이 트랜잭션 실행
└──────┬───────────────┘
       ▼
   순번 도달
       │
   ┌───┴────┐
   ▼        ▼
조건 충족   매진/불충족
   │        │
   ▼        ▼
즉시 결제   ✨ Gemini 대안 판단
            │
        ┌───┴────┐
        ▼        ▼
     대안 충족   대안 없음
        │        │
        ▼        ▼
     재탐색·결제  ◎ 즉시 자동 환불

┌──────────────────────────────────────┐
│  🔥 Firestore   대기열 · 에스크로 상태 저장   │
│  🔍 Solana Explorer   전 과정 검증 가능한 기록 │
└──────────────────────────────────────┘
```

<br>

## 💡 왜 Solana × Google Cloud인가

<table>
<tr>
<td width="50%" valign="top">

### ◎ Solana

- **즉시성** — 에스크로 생성/해제가 즉시, 저비용이라 소액도 부담 없이 예치
- **즉시 환불** — 매진 확정 즉시 온체인 자동 환불 (기존 카드망은 정산 주기상 며칠 소요)
- **투명성** — 전 과정이 온체인에 기록되어 배정 공정성 분쟁 시 검증 가능

</td>
<td width="50%" valign="top">

### ✨ Google Cloud / Gemini

- **자연어 조건 파싱** — 애매한 요청은 되물어 명확화
- **매진 시 대안 판단** — 우선순위 규칙 기반 실시간 판단
- **부정 탐지 보조** — 매크로 의심 패턴 탐지 (확장 기능)
- **Cloud Run / Firestore** — 상태 관리 인프라

</td>
</tr>
</table>

<br>

## 🧠 Gemini 판단 로직

<details>
<summary><b>1. 자연어 조건 파싱 예시</b></summary>
<br>

**입력:**
```
"다음 주 토요일 아이유 콘서트, VIP 말고 R석이나 S석으로, 20만원 안에서, 2연석으로 구해줘"
```

**출력:**
```json
{
  "event": "아이유 콘서트",
  "date_constraint": "다음 주 토요일",
  "seat_grades_allowed": ["R", "S"],
  "seat_grades_excluded": ["VIP"],
  "max_price_krw": 200000,
  "seat_count": 2,
  "adjacency_required": true
}
```

</details>

<details>
<summary><b>2. 매진 시 대안 판단 예시</b></summary>
<br>

**사전 설정:**
```json
{
  "primary": { "grade": "R", "max_price": 200000 },
  "fallback_rules": [
    { "if_unavailable": "primary", "then": "S석도 허용, 단 15만원 이하" },
    { "if_unavailable": "fallback_1", "then": "환불 후 취소표 대기 등록" }
  ]
}
```

**실시간 판단:**
```json
{
  "situation": "R석 매진 확정",
  "decision": "S석 조건으로 재탐색",
  "reasoning": "1순위 매진, 2순위 조건이 아직 유효하여 자동 전환"
}
```

</details>

<details>
<summary><b>3. 부정 탐지 예시 (확장 기능)</b></summary>
<br>

```
입력: 최근 1시간 내 요청 로그
- 동일 IP에서 47개 계정이 동일 조건으로 동시 요청
- 계정 생성 시각이 모두 요청 10분 전

Gemini 판단: "다중 계정 매크로 패턴 의심 → 대기열 제외 권고"
```

</details>

<br>

## 🛠️ 기술 스택

<div align="center">

| 영역 | 기술 |
|:---|:---|
| 🧠 AI | Google Gemini |
| ◎ 결제/온체인 | Solana (Devnet), Solana Pay / pay.sh |
| ☁️ 백엔드 | Google Cloud Run, Node.js |
| 🔥 DB | Firestore |
| 🔑 지갑/서명 | `@solana/web3.js` |

</div>

<br>

## 데모 시나리오

```
1️⃣  유저가 자연어로 조건 입력
     ↓
2️⃣  Gemini가 조건을 구조화 → 에이전트가 대기열 진입
     ↓
3️⃣  대기 중 Solana 데브넷에 에스크로 생성 (Explorer 실시간 확인)
     ↓
4️⃣  매진 발생 → Gemini 대안 판단
     ↓
5️⃣  조건 충족 시 자동 결제 / 불충족 시 즉시 자동 환불
```

<br>

## 🚀 로컬 실행 방법

```bash
git clone https://github.com/sonsiyeong/fairqueue.git
cd fairqueue
npm install
```

`.env` 파일 설정:

```env
GEMINI_API_KEY=your_gemini_api_key
SOLANA_CLUSTER=devnet
SOLANA_KEYPAIR_PATH=~/.config/solana/id.json
```

```bash
npm run dev
```

<br>

## 📁 프로젝트 구조

```
fairqueue/
├── agent/              # Gemini 기반 조건 파싱 및 판단 로직
├── escrow/             # Solana 에스크로 생성/해제 트랜잭션 로직
├── platform-sim/       # 데모용 가상 티켓 플랫폼 (좌석/대기열 시뮬레이터)
├── dashboard/           # 데모용 프론트엔드
└── README.md
```

<br>

## 기준 

<div align="center">

| 기준 | 대응 내용 |
|:---|:---|
| 혁신성 및 UX | 결제 실패 원천 차단 + 매진 시 즉시 투명 환불 |
| AI 활용도 | Gemini 기반 조건 파싱 · 대안 판단 · 부정 탐지 |
| 인프라 연동 | Solana 온체인 에스크로, USDC, Solana Pay/pay.sh |
| 실제 구동 여부 | 실제 데브넷 트랜잭션 로그로 검증 |

</div>

<br>

## 👥 팀

<div align="center">

| 이름 | 역할 |
|:---:|:---|
| **손시영 (Siyeong Son)** | Gemini 판단 로직 · Cloud Run 에이전트 · Solana 에스크로 로직 |
| **박세은 (Park Seeun)** | 플랫폼 시뮬레이터 · 프론트엔드/대시보드 · 데모 영상 |

</div>

<br>

## 📄 License

MIT

<br>

<div align="center">

**Built with for Google Cloud x Solana AI Agentic Hackathon 2026**

</div>

