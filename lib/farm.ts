// Farming economics: is depositing into this protocol worth the costs, the risk and the time?
//
// Every number here is an estimate built on a stated assumption, and the page says so. The one identity the
// code enforces is that the launch probability is applied exactly once: the expected gross value is
// p * allocation, and the costs and the opportunity cost are paid whether or not the token arrives. The old
// version of this page multiplied by p twice, once in the gross and once in a risk multiplier, which is why
// every plan collapsed.

import type { SnapshotProtocol } from './model.ts';

export interface FarmConstants {
  /** Share of FDV a protocol of this profile is assumed to hand to its farming community. */
  farmer_share: number;
  /** Share of TVL we assume a points programme counts as eligible: borrowed or unsupported capital does not farm. */
  eligible_tvl_share: number;
  /** Months from deposit to the assumed distribution. */
  months: number;
  /** Fixed on-chain cost: deposit, claim, withdrawal, and one bridge where the asset is not native. */
  fixed_cost_usd: number;
  /** Annual risk-free rate foregone while the capital is locked instead of held in T-bills. */
  tbill_rate: number;
  /** Haircut on the expected allocation for size, illiquidity and the chance the campaign shrinks it. */
  risk_haircut: number;
  /** Hours the campaign costs: setup, deposit, monitoring, claim and exit. */
  hours: number;
  /** Hourly value of the farmer's own time, USD. */
  labour_usd_per_hour: number;
  /** Margin over break-even odds a row needs before it reads FARM rather than MARGINAL. */
  odds_margin: number;
}

export const FARM: FarmConstants = {
  farmer_share: 0.045,
  eligible_tvl_share: 0.12,
  months: 9.5,
  fixed_cost_usd: 27,
  tbill_rate: 0.043,
  risk_haircut: 0.35,
  hours: 5,
  labour_usd_per_hour: 15,
  odds_margin: 1.35,
};

export interface FarmEconomics {
  deposit_usd: number;
  campaign_tvl_usd: number;
  share_pct: number;
  allocation_usd: number;
  opp_cost_usd: number;
  fixed_cost_usd: number;
  gross_expected_usd: number;
  net_expected_usd: number;
  risk_adj_usd: number;
  net_roi_pct: number;
  net_per_hour_usd: number;
  break_even_odds_pct: number;
  break_even_fdv_usd: number;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The economics of one deposit into one protocol at one FDV and one launch probability. */
export function farmEconomics(
  protocol: SnapshotProtocol,
  fdv_usd: number,
  launch_prob: number,
  deposit_usd: number,
  k: FarmConstants = FARM,
): FarmEconomics {
  const campaign = Math.max(protocol.tvl_usd * k.eligible_tvl_share, deposit_usd) + deposit_usd;
  const share = deposit_usd / campaign;
  const allocation = fdv_usd * k.farmer_share * share;
  const opp = deposit_usd * k.tbill_rate * (k.months / 12);
  const gross = launch_prob * allocation;
  const net = gross - k.fixed_cost_usd - opp;
  const risk_adj = net - k.risk_haircut * gross;
  const break_even_odds = allocation > 0 ? (k.fixed_cost_usd + opp) / (allocation * (1 - k.risk_haircut)) : 1;
  const break_even_fdv =
    launch_prob > 0 && k.farmer_share > 0 && share > 0
      ? (k.fixed_cost_usd + opp) / (launch_prob * k.farmer_share * share * (1 - k.risk_haircut))
      : Number.POSITIVE_INFINITY;
  return {
    deposit_usd,
    campaign_tvl_usd: round2(campaign),
    share_pct: share * 100,
    allocation_usd: round2(allocation),
    opp_cost_usd: round2(opp),
    fixed_cost_usd: k.fixed_cost_usd,
    gross_expected_usd: round2(gross),
    net_expected_usd: round2(net),
    risk_adj_usd: round2(risk_adj),
    net_roi_pct: deposit_usd > 0 ? (risk_adj / deposit_usd) * 100 : 0,
    net_per_hour_usd: round2(risk_adj / k.hours),
    break_even_odds_pct: break_even_odds * 100,
    break_even_fdv_usd: break_even_fdv,
  };
}

export type Verdict = 'FARM' | 'MARGINAL' | 'SKIP';

/**
 * The verdict is not a tuning knob. It follows from two facts the page states: the farmer's time is worth
 * $25 an hour, and a plan whose expected value is positive only on the optimistic side of the valuation band
 * is not a plan. So FARM needs a positive risk-adjusted value, more than the stated hourly value of the time it costs, and odds at least the stated margin over break-even; MARGINAL is the rest of the positive side.
 */
export function verdictFor(e: FarmEconomics, k: FarmConstants = FARM): Verdict {
  if (e.risk_adj_usd <= 0) return 'SKIP';
  const clearsLabour = e.net_per_hour_usd >= k.labour_usd_per_hour;
  const clearsMargin = e.break_even_odds_pct > 0 ? e.break_even_odds_pct * k.odds_margin <= 100 : false;
  return clearsLabour && clearsMargin ? 'FARM' : 'MARGINAL';
}
