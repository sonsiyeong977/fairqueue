"""
FairQueue — Tiered Contract Pricing & On-chain Cost Simulation
================================================================

Purpose
-------
Validates whether FairQueue's tiered monthly contract pricing (Starter /
Growth / Scale) is actually profitable once real on-chain costs (Solana
transaction fees) and AI inference costs (Gemini API calls) are subtracted,
across a realistic range of monthly order volumes.

This directly answers mentoring feedback from the KSNET session:
  "수익 bm 구조에서... 몇 개의 표가 얼마 팔렸을 때, 어느정도 수익이 나는지
   계산해보고 이게 과연 서비스를 운영할 때 합리적일지 생각해보자."

How to use
----------
1. Replace every value in the ASSUMPTIONS block below with FairQueue's real
   published tier pricing and limits (currently placeholders).
2. Run: python3 pricing_simulation.py
3. Output: a per-tier, per-volume table of revenue / cost / net margin,
   plus the break-even order volume for each tier.

Every number in ASSUMPTIONS is a placeholder pulled from public reference
points (Solana devnet/mainnet base fees, Gemini Flash list pricing) and
must be swapped for FairQueue's actual figures before this is cited in any
submission material.
"""

from dataclasses import dataclass

# ============================================================
# ASSUMPTIONS — replace with real figures before citing results
# ============================================================

USD_TO_KRW = 1380  # placeholder FX rate — update to current rate

# --- Solana on-chain cost per order -------------------------
# Each order = 1 deposit tx + 1 settle tx (release OR refund) = 2 signed txs.
SOL_PRICE_USD = 180.0                  # placeholder SOL/USD spot price
BASE_FEE_SOL_PER_TX = 0.000005         # Solana base fee per signature
PRIORITY_FEE_SOL_PER_TX = 0.000005     # placeholder buffer for priority fees under load
TX_PER_ORDER = 2                       # deposit + (release or refund)

# --- AI inference cost per order -----------------------------
# Gemini Flash-tier list pricing (placeholder — confirm current rate card).
GEMINI_COST_USD_PER_CALL = 0.0005      # placeholder: parsing + 1 judgment call
AI_CALLS_PER_ORDER = 2                 # 1 condition parse + 1 offer judgment

# --- Hosting / infra allocated cost per order ----------------
# Placeholder flat allocation for Cloud Run / server time, divided across
# an assumed baseline volume. Replace with a real infra cost model.
INFRA_COST_KRW_PER_ORDER = 5           # placeholder

# --- Tiered contract pricing ----------------------------------
@dataclass
class Tier:
    name: str
    monthly_fee_krw: int          # flat monthly contract fee
    included_orders: int          # orders included before overage applies
    overage_fee_krw: int          # per-order fee beyond included_orders

TIERS = [
    Tier("Starter", 490_000, 2_000, 150),
    Tier("Growth", 1_490_000, 10_000, 100),
    Tier("Scale", 3_900_000, 50_000, 70),
]

# Monthly order volumes to test per tier
VOLUMES = [100, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000]


# ============================================================
# Cost model
# ============================================================

def onchain_cost_krw_per_order() -> float:
    sol_per_order = (BASE_FEE_SOL_PER_TX + PRIORITY_FEE_SOL_PER_TX) * TX_PER_ORDER
    usd_per_order = sol_per_order * SOL_PRICE_USD
    return usd_per_order * USD_TO_KRW


def ai_cost_krw_per_order() -> float:
    usd_per_order = GEMINI_COST_USD_PER_CALL * AI_CALLS_PER_ORDER
    return usd_per_order * USD_TO_KRW


def variable_cost_krw_per_order() -> float:
    return onchain_cost_krw_per_order() + ai_cost_krw_per_order() + INFRA_COST_KRW_PER_ORDER


def revenue_krw(tier: Tier, volume: int) -> int:
    overage_orders = max(0, volume - tier.included_orders)
    return tier.monthly_fee_krw + overage_orders * tier.overage_fee_krw


def simulate():
    per_order_cost = variable_cost_krw_per_order()
    print(f"Per-order variable cost breakdown (KRW):")
    print(f"  on-chain (Solana, {TX_PER_ORDER} tx):  {onchain_cost_krw_per_order():>10.2f}")
    print(f"  AI inference (Gemini, {AI_CALLS_PER_ORDER} calls): {ai_cost_krw_per_order():>10.2f}")
    print(f"  infra allocation:              {INFRA_COST_KRW_PER_ORDER:>10.2f}")
    print(f"  TOTAL per order:                {per_order_cost:>10.2f}")
    print()

    for tier in TIERS:
        print(f"=== {tier.name}: {tier.monthly_fee_krw:,} KRW/mo, "
              f"{tier.included_orders:,} orders included, "
              f"{tier.overage_fee_krw} KRW/order overage ===")
        print(f"{'orders/mo':>10} {'revenue (KRW)':>16} {'variable cost (KRW)':>20} {'net margin (KRW)':>18} {'margin %':>9}")
        for v in VOLUMES:
            rev = revenue_krw(tier, v)
            cost = per_order_cost * v
            margin = rev - cost
            margin_pct = (margin / rev * 100) if rev else 0
            print(f"{v:>10,} {rev:>16,.0f} {cost:>20,.2f} {margin:>18,.0f} {margin_pct:>8.1f}%")

        # break-even order volume: smallest v in a fine-grained scan where margin >= 0
        be = None
        for v in range(0, 200_000, 10):
            if revenue_krw(tier, v) - per_order_cost * v >= 0:
                be = v
                break
        print(f"  -> approx. break-even volume: {be:,} orders/month" if be is not None else "  -> never breaks even in range tested")
        print()


if __name__ == "__main__":
    simulate()
