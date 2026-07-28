<div align="center">

# 🎟️ FairQueue

### 결제 실패 없는 공식 티켓팅 보증 레이어

**Powered by Solana On-chain Escrow × Google Gemini**

[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?style=for-the-badge&logo=solana&logoColor=white)](https://explorer.solana.com/?cluster=devnet)
[![Google Cloud](https://img.shields.io/badge/Google_Cloud-Gemini-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white)](https://cloud.google.com/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Core_Pipeline-Verified_on_Devnet-brightgreen?style=for-the-badge)](#-검증-완료된-핵심-파이프라인)

**Google Cloud x Solana AI Agentic Hackathon 2026 제출작**

[문제](#-문제) · [해결책](#-해결책) · [검증 상태](#-검증-완료된-핵심-파이프라인) · [아키텍처](#%EF%B8%8F-아키텍처) · [기술 스택](#%EF%B8%8F-기술-스택) · [실행 방법](#-로컬-실행-방법) · [팀](#-팀)

</div>

<br>

> FairQueue는 플랫폼이 공식 대기열 순번에 따라 발급한 좌석 제안(Offer)을, 사용자가 사전에 위임한 조건과 예산 안에서 에이전트가 자동으로 정산하고, 조건이 성립하지 않으면 예치금을 자동 반환하는 온체인 결제 레이어입니다. 남보다 빨리 사도록 돕는 자동 예매 도구가 아니라, **플랫폼이 공식적으로 부여한 순번·제안에 대해서만 작동하는 B2B 결제 보증 레이어**입니다.

<br>

## 🚨 문제

| 문제 | 영향 |
|:---|:---|
| ⏳ 대기열 순번이 올 때까지 자리 유무를 알 수 없음 | 유저 경험 저하 |
| 💳 짧은 결제 시간 안에 카드 인증 오류·입력 지연으로 구매 기회를 놓치는 경우 발생 | 플랫폼의 **순수 매출 손실** |
| 🔁  매진 후 환불 처리에 시간이 걸리는 경우가 흔함 | CS 부담, 고객 불만 |
| 🤖 매크로/암표 대응 비용 | 지속적인 탐지·차단 리소스 소모 |

<br>

## ✅ 해결책

FairQueue는 유저가 조건과 함께 결제 예상 금액을 **온체인에 미리 예치**하게 합니다. 정상적인 공식 대기열 순서를 그대로 지키며, 순번이 되어 플랫폼이 좌석을 제안(Offer)하면 사전 위임된 조건과 비교해 자동으로 정산하거나 즉시 환불합니다. 이를 통해 결제 단계의 마찰을 줄이고, 매진 시 환불까지의 지연을 최소화하는 것을 목표로 합니다.

<div align="center">

| | 🤖 기존 매크로 | 🎟️ FairQueue |
|:---:|:---:|:---:|
| **대기열 처리** | 우회·편법 시도 | 정상 순서 그대로 (1계정 1에이전트) |
| **작동 시점** | 좌석을 스스로 탐색·선점 | 플랫폼이 공식 부여한 Offer에 대해서만 작동 |
| **플랫폼과의 관계** | ❌ 대립적 (차단 대상) | ✅ 협력적 (매출 손실 방지 인프라) |

</div>

<br>

## 🟢 검증 완료된 핵심 파이프라인

아래 흐름은 실제 Solana Devnet 트랜잭션, 실제 Gemini API 호출, 실제 백엔드 API 통신으로 end-to-end 검증되었습니다.

| 단계 | 검증 내용 | 상태 |
|:---|:---|:---:|
| 자연어 → 조건 파싱 | Gemini가 유저 요청을 `primary` + `fallback_rules` 구조로 변환 | ✅ |
| 플랫폼 API 연동 | Express 기반 좌석 상태 API와 실시간 HTTP 통신 | ✅ |
| 온체인 예치 | 사람 승인 없는 agent keypair 자율 서명으로 Devnet 트랜잭션 발생 | ✅ |
| Gemini 판단 + 결정론적 재검증 | Gemini가 제안하고, 별도의 결정론적 검증 로직이 조건 충족 여부를 한 번 더 확인 후 실행 | ✅ |
| 조건별 정산/환불 | 결제 시 판매자 지갑, 환불 시 유저 지갑으로 정확히 분기 | ✅ |
| 차액 자동 반환 | 예치 금액 > 실결제 금액일 경우 차액을 자동으로 유저에게 반환 | ✅ |
| 부정 패턴 탐지 (PoC) | 요청 로그 패턴을 분석해 매크로/다중 계정 의심 여부를 판정하는 개념 검증 | ✅ |

세 가지 핵심 시나리오(1차 확보 성공 / 대안으로 확보 성공 / 전량 매진 후 환불) 모두 실제 Devnet에서 트랜잭션 서명·전송·확정까지 재현 가능하게 실행됩니다.

<br>

## 🏗️ 아키텍처

```
[User] 자연어 조건 및 최대 예산 입력
   ▼
[Gemini] 조건 파싱 → { primary, fallback_rules }
   ▼
[Solana Devnet] 예상 최대 금액 온체인 예치 (자율 서명)
   ▼
[Official Queue] 공식 대기열 진입, 순번 대기
   ▼ (순번 도달)
[Platform Offer] 플랫폼이 좌석 제안(Offer) 발급
   ▼
[Gemini] 제안된 좌석이 조건에 맞는지 1차 판단 (근거 포함)
   ▼
[Deterministic Verification Layer] Gemini 판단을 코드 레벨에서 재검증
   │   (가격·등급이 실제 조건을 벗어나면 강제로 REFUND 처리)
   ▼
   ├─ 조건 충족 → 판매자 지갑으로 정산, 차액 자동 환불
   └─ 조건 불충족/매진 → 예치금 즉시 전액 환불

🔍 결제·환불·배정 결과는 트랜잭션으로 기록되어 온체인에서 검증 가능
   (대기열 순번 자체는 애플리케이션 상태로 관리되며, 온체인에 기록되는 대상이 아님)

🔍 모든 트랜잭션은 Solana Explorer(Devnet)에서 검증 가능
```

<br>

## 💡 왜 Solana × Google Cloud인가

<table>
<tr>
<td width="50%" valign="top">

### ◎ Solana

- **즉시성** — 예치/정산이 즉시, 저비용
- **빠른 환불** — 조건 불충족 확인 즉시 온체인 환불 처리
- **검증 가능성** — 결제·환불 트랜잭션이 온체인에 기록되어 조회 가능

</td>
<td width="50%" valign="top">

### ✨ Google Cloud / Gemini

- **자연어 조건 파싱** — 1차 조건과 대안 규칙까지 구조화
- **근거 있는 1차 판단** — 제안된 좌석과 조건을 비교해 판단 근거(reasoning)를 함께 생성
- **결정론적 레이어와 분리** — 최종 실행 여부는 별도의 검증 로직이 재확인 (환각 리스크 완화)

</td>
</tr>
</table>

<br>

## 🛠️ 기술 스택

<div align="center">

| 영역 | 기술 |
|:---|:---|
| AI | Google Gemini (`gemini-flash-latest`) — 조건 파싱 및 1차 판단 |
| 검증 | 결정론적 정책 엔진 (코드 기반 재검증 레이어) |
| 결제/온체인 | Solana (Devnet), `@solana/web3.js` |
| 백엔드 | Node.js, Express |
| 지갑/서명 | Agent keypair 기반 자율 서명 (승인 팝업 없음) |

</div>

<br>

## 🚀 로컬 실행 방법

```bash
git clone https://github.com/sonsiyeong977/fairqueue.git
cd fairqueue
npm install
```

`.env` 파일 설정:

```env
GEMINI_API_KEY=your_gemini_api_key
```

**터미널 1 — 플랫폼 시뮬레이터**
```bash
cd platform-sim
node server.js
```

**터미널 2 — 정산 API 서버**
```bash
cd agent
node settle-server.js
```

`POST /settle`로 요청을 보내면 조건 파싱 → 예치 → Gemini 판단 → 결정론적 재검증 → 정산/환불까지 처리되며, 각 단계의 Solana Explorer 링크가 응답으로 반환됩니다.

<br>

## 📁 프로젝트 구조

```
fairqueue/
├── agent/
│   ├── main.js              # 전체 파이프라인 데모 실행 스크립트
│   ├── settle-server.js     # /settle API 서버 (외부 대기열 시스템과 연동)
│   ├── parse-test.js        # 조건 파싱 단독 테스트
│   ├── fallback-test.js     # 판단 로직 단독 테스트
│   ├── fraud-detect.js      # 부정 패턴 탐지 PoC
│   └── escrow-wallet.json   # 에스크로 지갑 키페어 (gitignore 처리됨)
├── platform-sim/
│   └── server.js            # 좌석 상태 관리 Express API
├── docs/
│   └── PRODUCT_INTRO.md     # 프로덕트 소개서
└── README.md
```

<br>

## 기준 

<div align="center">

| 기준 | 대응 내용 |
|:---|:---|
| 혁신성 및 UX | 조건 위임 기반 자동 정산 + 즉시 환불 + 결정론적 검증으로 안전성 확보 |
| AI 활용도 | Gemini 기반 조건 파싱 · 근거 있는 판단 · 결정론적 레이어와의 역할 분리 |
| 인프라 연동 | Solana 온체인 에스크로, USDC, Solana Pay/pay.sh |
| 실제 구동 여부 | 실제 데브넷 트랜잭션 로그로 검증 |

</div>

<br>

## 👥 팀

<div align="center">

| 이름 | 역할 |
|:---:|:---|
| **손시영 (Siyeong Son)** | Gemini 판단 로직 · 결정론적 검증 레이어 · 에스크로 로직 · API 서버 · 파이프라인 통합 |
| **박세은 (Park Seeun)** | 대기열/좌석 상태 관리 서버 · 프론트엔드/대시보드 · 데모 영상 |

</div>

<br>

## 📄 License

MIT

<br>

<div align="center">

**Built with 💜for Google Cloud x Solana AI Agentic Hackathon 2026💜**

</div>

