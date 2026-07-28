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

> 저희는 유저가 남보다 빨리 사도록 돕는 매크로가 아니라, **플랫폼이 결제 실패 없이, 매크로 없이, 분쟁 없이 티켓을 판매하도록 돕는 결제 보증 레이어**입니다.

<br>

## 🚨 문제

| 문제 | 영향 |
|:---|:---|
| ⏳ 대기열 순번이 올 때까지 자리 유무를 알 수 없음 | 유저 경험 저하 |
| 💳 순번이 와도 카드 입력 지연·오류로 결제 실패 | 플랫폼의 **순수 매출 손실** |
| 🔁 매진 후 환불 처리 지연 | CS 부담, 고객 불만 |
| 🤖 매크로/암표 대응 비용 | 지속적인 탐지·차단 리소스 소모 |

<br>

## ✅ 해결책

FairQueue는 유저가 조건과 함께 결제 금액을 **온체인 에스크로에 미리 예치**하게 합니다. 실제 판매 가능 좌석과 조건을 비교해 **1차 희망 → 대안 좌석 → 환불** 순으로 자동 판단하고, 결과에 따라 자금이 즉시 정확한 곳으로 이동합니다.

<div align="center">

| | 🤖 기존 매크로 | 🎟️ FairQueue |
|:---:|:---:|:---:|
| **대기열 처리** | 우회·편법 시도 | 정상 순서 그대로 (1계정 1에이전트) |
| **목적** | 남보다 빨리 선점 | 결제 실패 방지 + 즉시 투명 환불 |
| **플랫폼과의 관계** | ❌ 대립적 (차단 대상) | ✅ 협력적 (매출 손실 방지 인프라) |

</div>

<br>

## 🟢 검증 완료된 핵심 파이프라인

아래 흐름은 **목업이 아니라, 실제 Solana Devnet 트랜잭션 + 실제 Gemini API 호출 + 실제 백엔드 API 통신**으로 end-to-end 검증되었습니다.

| 단계 | 검증 내용 | 상태 |
|:---|:---|:---:|
| 자연어 → 조건 파싱 | Gemini가 유저 요청을 `primary` + `fallback_rules` 구조로 변환 | ✅ |
| 플랫폼 API 연동 | Express 기반 좌석 상태 API와 실시간 HTTP 통신 (`GET`/`POST /seats/:event`) | ✅ |
| 온체인 에스크로 예치 | 사람 승인 없는 agent keypair 자율 서명으로 Devnet 트랜잭션 발생 | ✅ |
| 3단계 자동 판단 | ①1차 조건 성공 ②대안 조건으로 성공 ③모두 매진 시 환불, Gemini가 실제 좌석 데이터 기반으로 판단 | ✅ |
| 조건별 에스크로 해제 | 결제 시 판매자 지갑, 환불 시 유저 지갑으로 정확히 분기 | ✅ |
| 거스름돈 자동 반환 | 예치 금액 > 실결제 금액일 경우 차액을 자동으로 유저에게 반환 | ✅ |

세 가지 핵심 시나리오(1차 확보 성공 / 대안으로 확보 성공 / 전량 매진 후 환불) 모두 실제 Devnet에서 트랜잭션 서명·전송·확정까지 재현 가능하게 실행됩니다.

<br>

## 🏗️ 아키텍처

```
┌─────────────┐
│    User     │  자연어로 조건 입력
│             │  "아이유 콘서트 R석, 20만원 이하로 1석 구해줘.
│             │   매진이면 S석도 15만원 이하로 괜찮아."
└──────┬──────┘
       ▼
┌─────────────────────┐
│   ✨ Gemini          │  조건 파싱 → { primary, fallback_rules }
└──────┬───────────────┘
       ▼
┌─────────────────────┐
│  ◎ Solana Escrow     │  예상 최대 금액 온체인 예치 (자율 서명)
└──────┬───────────────┘
       ▼
┌─────────────────────┐
│  🎫 Platform Sim API  │  실제 좌석 상태 조회 (Express, GET /seats/:event)
└──────┬───────────────┘
       ▼
┌─────────────────────┐
│   ✨ Gemini           │  1차 → 대안 → 환불 다단계 판단
└──────┬───────────────┘
       ▼
   ┌───┴────────────┐
   ▼                ▼
SETTLE_PRIMARY/    REFUND
SETTLE_FALLBACK       │
   │                  │
   ▼                  ▼
판매자 지갑로 결제      유저 지갑으로 전액 환불
   │
   ▼
차액 있으면 거스름돈 자동 반환

🔍 모든 트랜잭션은 Solana Explorer(Devnet)에서 검증 가능
```

<br>

## 💡 왜 Solana × Google Cloud인가

<table>
<tr>
<td width="50%" valign="top">

### ◎ Solana

- **즉시성** — 에스크로 예치/해제가 즉시, 저비용
- **즉시 환불** — 매진 확정 즉시 온체인 자동 환불
- **투명성** — 전 과정이 온체인에 기록되어 검증 가능

</td>
<td width="50%" valign="top">

### ✨ Google Cloud / Gemini

- **자연어 조건 파싱** — 1차 조건과 대안 규칙까지 구조화
- **다단계 판단** — 실제 좌석 데이터를 근거로 1차/대안/환불 결정
- **근거 있는 의사결정** — 모든 판단에 reasoning 포함

</td>
</tr>
</table>

<br>

## 🛠️ 기술 스택

<div align="center">

| 영역 | 기술 |
|:---|:---|
| 🧠 AI | Google Gemini (`gemini-flash-latest`) |
| ◎ 결제/온체인 | Solana (Devnet), `@solana/web3.js` |
| ☁️ 백엔드 | Node.js, Express |
| 🔑 지갑/서명 | Agent keypair 기반 자율 서명 (승인 팝업 없음) |

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

**터미널 1 — 플랫폼 시뮬레이터 실행**
```bash
cd platform-sim
node server.js
```

**터미널 2 — 에이전트 파이프라인 실행**
```bash
cd agent
node main.js
```

세 시나리오(1차 확보 성공 / 대안 확보 성공 / 전량 매진 환불)가 순서대로 실행되며, 각 단계의 Solana Explorer 링크가 콘솔에 출력됩니다.

<br>

## 📁 프로젝트 구조

```
fairqueue/
├── agent/
│   ├── main.js              # 전체 파이프라인 실행 (파싱 → 예치 → 판단 → 해제)
│   ├── parse-test.js        # 조건 파싱 단독 테스트
│   ├── fallback-test.js     # 판단 로직 단독 테스트
│   └── escrow-wallet.json   # 에스크로 지갑 키페어 (gitignore 처리됨)
├── platform-sim/
│   └── server.js            # 좌석 상태 관리 Express API
├── dashboard/                # (예정) 데모용 프론트엔드
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

