// Launch odds: the probability a tokenless protocol records a token, estimated from the snapshot's own
// split between protocols that record one and protocols that do not.
//
// The snapshot is a single cross-section, so a true time-to-launch hazard is not identified by it: no
// protocol is observed twice. What is identified is prevalence -- of the protocols carrying these features,
// what share records a token. This module fits that prevalence, honestly named, and exposure.ts converts it
// to a 12-month horizon only through a stated, adjustable factor. The factor is an assumption and the dossier
// says so; the prevalence, its out-of-fold Brier score and its reliability table are measured.

import { ageDays, categoryKey, type Snapshot, type SnapshotProtocol } from './model.ts';

/** Fixed centring for the two size features. Constants, not sample statistics, so no fold leaks into another. */
const TVL_CENTRE = 6.5;
const AGE_CENTRE = 3.0;

/** Ridge strength on the logistic fit: enough to keep a separable fold finite, small enough to not flatten it. */
const RIDGE = 0.001;

/** Category offsets shrink by n / (n + CAT_PRIOR): a category with few records keeps the global curve. */
const CAT_PRIOR = 8;

export interface LaunchRow {
  slug: string;
  category: string;
  x: number;
  a: number;
  y: number;
}

export interface LaunchBin {
  lo: number;
  hi: number;
  n: number;
  predicted: number;
  observed: number;
}

export interface LaunchCategory {
  category: string;
  n: number;
  tokens: number;
  observed: number;
  predicted: number;
}

export interface LaunchModel {
  n: number;
  tokens: number;
  base_rate: number;
  /** Out-of-fold metrics: every row is scored by a model that did not see it. */
  auc: number;
  brier: number;
  brier_base: number;
  brier_skill: number;
  log_loss: number;
  coefficients: number[];
  category_offsets: Record<string, number>;
  bins: LaunchBin[];
  by_category: LaunchCategory[];
  /** The full-sample fit, used to score protocols at build time. */
  fitted: {
    b0: number;
    b1: number;
    b2: number;
    offsets: Record<string, number>;
  };
}

/** One protocol's features and label. y = 1 when the snapshot records a token for it. */
export function launchRows(snapshot: Snapshot): LaunchRow[] {
  const rows: LaunchRow[] = [];
  for (const p of snapshot.protocols) {
    const tvl = Number(p.tvl_usd);
    if (!Number.isFinite(tvl) || tvl <= 0) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const a = age === null || age <= 0 ? AGE_CENTRE : Math.log10(Math.max(age, 1));
    rows.push({
      slug: p.slug,
      category: categoryKey(p.category),
      x: Math.log10(tvl) - TVL_CENTRE,
      a: a - AGE_CENTRE,
      y: p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null ? 1 : 0,
    });
  }
  return rows;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** Gauss-Jordan with partial pivoting on a 3x3 system; null when singular. */
function solve3(a: number[][], v: number[]): number[] | null {
  const m = [a[0]!.slice(), a[1]!.slice(), a[2]!.slice()];
  const r = v.slice();
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let i = c + 1; i < 3; i++) if (Math.abs(m[i]![c]!) > Math.abs(m[piv]![c]!)) piv = i;
    if (Math.abs(m[piv]![c]!) < 1e-10) return null;
    if (piv !== c) {
      const t = m[piv]!;
      m[piv] = m[c]!;
      m[c] = t;
      const s = r[piv]!;
      r[piv] = r[c]!;
      r[c] = s;
    }
    const d = m[c]![c]!;
    for (let j = c; j < 3; j++) m[c]![j] = m[c]![j]! / d;
    r[c] = r[c]! / d;
    for (let i = 0; i < 3; i++) {
      if (i === c) continue;
      const f = m[i]![c]!;
      if (f === 0) continue;
      for (let j = c; j < 3; j++) m[i]![j] = m[i]![j]! - f * m[c]![j]!;
      r[i] = r[i]! - f * r[c]!;
    }
  }
  return r;
}

export function fitLogistic(rows: LaunchRow[], iters = 40): number[] {
  let b = [0, 0, 0];
  for (let step = 0; step < iters; step++) {
    const A = [[RIDGE, 0, 0], [0, RIDGE, 0], [0, 0, RIDGE]];
    const g = [0, 0, 0];
    for (const r of rows) {
      const p = sigmoid(b[0]! + b[1]! * r.x + b[2]! * r.a);
      const w = p * (1 - p) + 1e-9;
      const v = [1, r.x, r.a];
      const e = r.y - p;
      for (let i = 0; i < 3; i++) {
        g[i] = g[i]! + e * v[i]!;
        for (let j = 0; j < 3; j++) A[i]![j] = A[i]![j]! + w * v[i]! * v[j]!;
      }
    }
    const d = solve3(A, g);
    if (d === null) break;
    b = [b[0]! + d[0]!, b[1]! + d[1]!, b[2]! + d[2]!];
    if (Math.abs(d[0]!) + Math.abs(d[1]!) + Math.abs(d[2]!) < 1e-10) break;
  }
  return b;
}


export function foldOf(slug: string): number {
  let h = 5381;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) + h + slug.charCodeAt(i)) | 0;
  return Math.abs(h) % 5;
}

const clip = (p: number, lo = 0.001, hi = 0.999): number => Math.min(hi, Math.max(lo, p));

/**
 * Per-category offsets on the logit scale. A category's own token share moves the curve only as far as its
 * record count earns: n / (n + CAT_PRIOR), so a two-protocol category barely shifts and a crowded one can.
 */
export function categoryOffsets(rows: LaunchRow[], b: number[]): Record<string, number> {
  const total = new Map<string, number>();
  const hit = new Map<string, number>();
  let pos = 0;
  for (const r of rows) {
    const p = sigmoid(b[0]! + b[1]! * r.x + b[2]! * r.a);
    total.set(r.category, (total.get(r.category) ?? 0) + 1);
    hit.set(r.category, (hit.get(r.category) ?? 0) + r.y);
    pos += r.y;
  }
  const logitGlobal = Math.log((pos + 0.5) / (rows.length - pos + 0.5));
  const offsets: Record<string, number> = {};
  for (const [key, n] of total) {
    const obs = ((hit.get(key) ?? 0) + 0.5) / (n + 1);
    const off = Math.log(obs / (1 - obs)) - logitGlobal;
    const w = n / (n + CAT_PRIOR);
    offsets[key] = w * off;
  }
  return offsets;
}

export function predictLaunch(model: LaunchModel, category: string, x: number, a: number): number {
  const f = model.fitted;
  const off = f.offsets[category] ?? 0;
  return clip(sigmoid(f.b0 + f.b1 * (x - TVL_CENTRE) + f.b2 * (a - AGE_CENTRE) + off));
}

/** Probability that a random positive outranks a random negative: 1 is a perfect ranking, 0.5 a coin toss. */
function aucOf(scored: { p: number; y: number }[]): number {
  const pos = scored.filter((s) => s.y === 1).map((s) => s.p);
  const neg = scored.filter((s) => s.y === 0).map((s) => s.p);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/**
 * Out-of-fold evaluation: five folds by slug hash, each scored by a curve fitted without it. The bins are
 * equal-width on the predicted probability sinus, so a reader can see whether 40 per cent predictions land
 * near 40 per cent; each row reports its own count, because a bin of four proves nothing.
 */
export function evaluateLaunch(rows: LaunchRow[]): { p: number[]; auc: number; brier: number; log_loss: number; bins: LaunchBin[] } {
  const p = new Array<number>(rows.length).fill(0.5);
  for (let f = 0; f < 5; f++) {
    const train = rows.filter((r) => foldOf(r.slug) !== f);
    const test = rows.filter((r) => foldOf(r.slug) === f);
    if (train.length === 0) continue;
    const b = fitLogistic(train);
    const offs = categoryOffsets(train, b);
    for (const r of test) {
      p[rows.indexOf(r)] = clip(sigmoid(b[0]! + b[1]! * r.x + b[2]! * r.a + (offs[r.category] ?? 0)));
    }
  }
  const scored = rows.map((r, i) => ({ p: p[i]!, y: r.y }));
  return {
    p: p,
    auc: aucOf(scored),
    brier: mean(scored.map((s) => (s.p - s.y) ** 2)),
    log_loss: mean(scored.map((s) => -Math.log(clip(s.y === 1 ? s.p : 1 - s.p, 0.02, 0.98)))),
    bins: reliability(scored),
  };
}

/** Ten equal-width reliability bins from 0 to 1, each with its n, its mean prediction and its observed rate. */
export function reliability(scored: { p: number; y: number }[]): LaunchBin[] {
  const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.00001];
  const out: LaunchBin[] = [];
  for (let i = 0; i < 10; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const got = scored.filter((s) => s.p >= lo && s.p < hi);
    out.push({
      lo,
      hi: Math.min(hi, 1),
      n: got.length,
      predicted: got.length === 0 ? 0 : mean(got.map((s) => s.p)),
      observed: got.length === 0 ? 0 : mean(got.map((s) => s.y)),
    });
  }
  return out;
}

function mean(v: number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return v.length === 0 ? 0 : s / v.length;
}

/** Fit the launch model: out-of-fold scores for the evidence panel, the full-sample curve for pricing. */
export function fitLaunch(snapshot: Snapshot): LaunchModel {
  const rows = launchRows(snapshot);
  const ev = evaluateLaunch(rows);
  const b = fitLogistic(rows);
  const offsets = categoryOffsets(rows, b);
  const tokens = rows.reduce((sum, r) => sum + r.y, 0);
  const byKey = new Map<string, LaunchRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.category);
    if (list === undefined) byKey.set(r.category, [r]);
    else list.push(r);
  }
  const by_category: LaunchCategory[] = [...byKey.entries()]
    .map(([category, list]) => ({
      category,
      n: list.length,
      tokens: list.reduce((s, r) => s + r.y, 0),
      observed: mean(list.map((r) => r.y)),
      predicted: mean(list.map((r) => sigmoid(b[0]! + b[1]! * r.x + b[2]! * r.a + (offsets[category] ?? 0)))),
    }))
    .sort((a, b) => b.n - a.n);
  return {
    n: rows.length,
    tokens,
    base_rate: tokens / rows.length,
    auc: ev.auc,
    brier: ev.brier,
    brier_base: mean(rows.map((r) => (tokens / rows.length - r.y) ** 2)),
    brier_skill: 1 - ev.brier / mean(rows.map((r) => (tokens / rows.length - r.y) ** 2)),
    log_loss: ev.log_loss,
    coefficients: b,
    category_offsets: offsets,
    bins: ev.bins,
    by_category,
    fitted: { b0: b[0]!, b1: b[1]!, b2: b[2]!, offsets },
  };
}



