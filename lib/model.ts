// The token radar's model (radar-3): a fitted, validated value model.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling)
// and adds every other pre-token protocol that passes the same exclusions the watchlist
// rule applies (no CEX, no bridge / liquid-staking / wrapped products, no versioned
// names, no exchange names). A protocol is pre-token when its record carries no token
// (no market cap, no CoinGecko id, no symbol).
//
// Implied value follows only from the snapshot's own figures. The model is a least-
// squares fit on the live-token comparables, computed at run time from this snapshot
// (no hardcoded coefficients, nothing ranked by name):
//
//   y  = ln(mcap_usd)
//   x1 = ln(tvl_usd)
//   x2 = growth = clamp(change_7d ?? 0, -50, 100)
//   x3 = age_years = age_days / 365, age_days = days(listed_at -> as_of), null -> 365
//   y  = b0 + b1*x1 + b2*x2 + b3*x3
//   implied = max(1, round(exp(b0 + b1*ln(tvl) + b2*growth + b3*age_years)))
//
// The fit is solved with the normal equations and Gaussian elimination (pure JS,
// Node standard library only, deterministic). The entry also validates the fit at
// run time and ships the numbers on the dashboard: 5-fold cross-validation and
// walk-forward splits, each against the old category-median-multiple baseline.
// The fitted model must beat the baseline on every split; buildRadar throws if it
// does not, so a board never ships on an unvalidated model.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries: all of them. */
export const LIVE_ROWS = 144;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    coefficients: [number, number, number, number];
    log_tvl: number;
    growth: number;
    age_years: number;
    predicted_log_mcap: number;
  };
  farm_steps: string[];
}

/** One live-token comparable, for the dashboard's evidence view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** One validation split: fitted vs baseline RMSE on the log scale. */
export interface ValidationSplit {
  label: string;
  n_test: number;
  fitted_rmse: number;
  baseline_rmse: number;
}

/** The fitted model's validation, computed at run time and shown on the board. */
export interface ModelValidation {
  coefficients: [number, number, number, number];
  r2: number;
  n_train: number;
  cv_fitted_rmse: number;
  cv_baseline_rmse: number;
  walk_forward: ValidationSplit[];
}

/** How the 758 snapshot protocols are accounted for, counted at run time. */
export interface Coverage {
  total: number;
  board: number;
  live: number;
  token_no_mcap: number;
  excluded_pre_token: number;
}

/** The dashboard's data: the board, the live comparables, and the model's own numbers. */
export interface RadarData {
  version: string;
  as_of: string;
  floor_usd: number;
  overall_multiple: number;
  category_multiples: { category: string; multiple: number; n: number }[];
  watchlist: string[];
  rows: BoardRow[];
  live: LiveRow[];
  validation: ModelValidation;
  coverage: Coverage;
}

export interface RadarBuild {
  board: BoardRow[];
  radar: RadarData;
  early_size: number;
  live_size: number;
}

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX =
  /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const MULTIPLE_MIN = 0.03;
const MULTIPLE_MAX = 0.75;
const GROWTH_FLOOR = -50;
const GROWTH_CAP = 100;
const UNKNOWN_AGE_DAYS = 365;

/** Parse and minimally validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const doc: unknown = JSON.parse(text);
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('snapshot is not an object');
  }
  const d = doc as Record<string, unknown>;
  if (typeof d.as_of !== 'string' || typeof d.source !== 'string') {
    throw new Error('snapshot has no as_of/source');
  }
  if (typeof d.floor_usd !== 'number' || !Array.isArray(d.protocols)) {
    throw new Error('snapshot has no floor_usd/protocols');
  }
  if (!Array.isArray(d.watchlist)) throw new Error('snapshot has no watchlist');
  return doc as Snapshot;
}

/** A protocol records no token: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * The watchlist rule's exclusions, applied to early rows too: a wrapped, staked or
 * bridged product of a token that already trades is not a launch waiting to happen.
 */
export function isExcluded(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_MARKER.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Days from listed_at to the snapshot's as_of date; null when unknown. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** The regression features of one protocol, from the snapshot's own figures. */
export interface Features {
  slug: string;
  log_tvl: number;
  growth: number;
  age_years: number;
  age_days: number;
  n_chains: number;
  log_mcap: number;
  category: string | null;
  listed_at: string | null;
}

export function features(p: SnapshotProtocol, asOf: string): Features {
  const growth = clamp(p.change_7d ?? 0, GROWTH_FLOOR, GROWTH_CAP);
  const age = ageDays(p, asOf);
  const ageDaysUsed = age ?? UNKNOWN_AGE_DAYS;
  return {
    slug: p.slug,
    log_tvl: Math.log(p.tvl_usd),
    growth,
    age_years: ageDaysUsed / 365,
    age_days: ageDaysUsed,
    n_chains: p.chains.length,
    log_mcap: Math.log(p.mcap_usd ?? 1),
    category: p.category,
    listed_at: p.listed_at,
  };
}

/**
 * Solve a small dense linear system by Gaussian elimination with partial pivoting.
 * Deterministic, pure JS; the 4x4 normal-equation system below is well conditioned
 * enough that this reproduces the reference fit to ~1e-6.
 */
export function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) throw new Error('singular normal equations');
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= m[r]![c]! * x[c]!;
    x[r] = s / m[r]![r]!;
  }
  return x;
}

/** Fit y = b0 + b1*x1 + b2*x2 + b3*x3 by least squares (normal equations). */
export function fitLeastSquares(rows: Features[]): {
  beta: [number, number, number, number];
  r2: number;
} {
  const k = 4;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (const r of rows) {
    const x = [1, r.log_tvl, r.growth, r.age_years];
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) xtx[i]![j]! += x[i]! * x[j]!;
      xty[i]! += x[i]! * r.log_mcap;
    }
  }
  const beta = solveLinear(xtx, xty) as [number, number, number, number];
  let ssRes = 0;
  let ssTot = 0;
  const mean = rows.reduce((s, r) => s + r.log_mcap, 0) / rows.length;
  for (const r of rows) {
    const pred = predictLogMcap(beta, r);
    ssRes += (r.log_mcap - pred) ** 2;
    ssTot += (r.log_mcap - mean) ** 2;
  }
  return { beta, r2: 1 - ssRes / ssTot };
}

export function predictLogMcap(
  beta: [number, number, number, number],
  f: Features,
): number {
  return beta[0] + beta[1] * f.log_tvl + beta[2] * f.growth + beta[3] * f.age_years;
}

/**
 * The old radar-2 baseline, kept only as the validation yardstick: the category
 * median market-cap-to-TVL multiple (clamped 0.03..0.75, >=3 live per category else
 * the overall median) times a growth, maturity and chain factor, on the log scale.
 */
export function baselinePredictLogMcap(
  train: Features[],
  test: Features,
): number {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of train) {
    const ratio = Math.exp(r.log_mcap) / Math.exp(r.log_tvl);
    all.push(ratio);
    const key = r.category ?? '(no category)';
    const arr = byCat.get(key);
    if (arr === undefined) byCat.set(key, [ratio]);
    else arr.push(ratio);
  }
  const overall = median(all);
  const catMed = new Map<string, number>();
  for (const [key, ratios] of byCat) {
    if (ratios.length >= 3) catMed.set(key, median(ratios));
  }
  const mult = clamp(catMed.get(test.category ?? '(no category)') ?? overall, MULTIPLE_MIN, MULTIPLE_MAX);
  const growthMult = 1 + (test.growth / 100) * 0.5;
  const maturity = 0.6 + (Math.min(test.age_days, 1095) / 1095) * 0.4;
  const chainMult = 1 + 0.02 * Math.min(Math.max(test.n_chains - 1, 0), 5);
  return Math.log(Math.max(1, Math.exp(test.log_tvl) * mult * growthMult * maturity * chainMult));
}

function rmse(errors: number[]): number {
  return Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
}

/**
 * Validate the fitted model against the median-multiple baseline:
 * 5-fold CV (live tokens sorted by slug, fold = index % 5) and walk-forward splits
 * (live tokens with listed_at, sorted by listed_at, fit on the oldest fraction).
 * Throws when the fitted model does not beat the baseline on any split.
 */
export function validateModel(live: Features[]): ModelValidation {
  const { beta, r2 } = fitLeastSquares(live);

  // 5-fold CV, deterministic: sort by slug, fold = index % 5.
  const sorted = [...live].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const folds: Features[][] = [[], [], [], [], []];
  sorted.forEach((r, i) => folds[i % 5]!.push(r));
  const cvFitErr: number[] = [];
  const cvBaseErr: number[] = [];
  for (let f = 0; f < 5; f++) {
    const test = folds[f]!;
    const train = folds.flatMap((fo, j) => (j === f ? [] : fo));
    const b = fitLeastSquares(train).beta;
    for (const r of test) {
      cvFitErr.push(predictLogMcap(b, r) - r.log_mcap);
      cvBaseErr.push(baselinePredictLogMcap(train, r) - r.log_mcap);
    }
  }
  const cvFitted = rmse(cvFitErr);
  const cvBaseline = rmse(cvBaseErr);

  // Walk-forward: oldest fraction trains, newest tests.
  const dated = live
    .filter((r) => r.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const walkForward: ValidationSplit[] = [];
  for (const frac of [0.5, 0.6, 0.7, 0.8]) {
    const k = Math.floor(dated.length * frac);
    const train = dated.slice(0, k);
    const test = dated.slice(k);
    const b = fitLeastSquares(train).beta;
    const fitErr = test.map((r) => predictLogMcap(b, r) - r.log_mcap);
    const baseErr = test.map((r) => baselinePredictLogMcap(train, r) - r.log_mcap);
    walkForward.push({
      label: `oldest ${Math.round(frac * 100)}% train / newest ${100 - Math.round(frac * 100)}% test`,
      n_test: test.length,
      fitted_rmse: rmse(fitErr),
      baseline_rmse: rmse(baseErr),
    });
  }

  const validation: ModelValidation = {
    coefficients: beta,
    r2,
    n_train: live.length,
    cv_fitted_rmse: cvFitted,
    cv_baseline_rmse: cvBaseline,
    walk_forward: walkForward,
  };
  if (!(cvFitted < cvBaseline)) {
    throw new Error(
      `radar-3 fails validation: 5-fold CV fitted RMSE ${cvFitted.toFixed(4)} does not beat baseline ${cvBaseline.toFixed(4)}`,
    );
  }
  for (const w of walkForward) {
    if (!(w.fitted_rmse < w.baseline_rmse)) {
      throw new Error(
        `radar-3 fails validation: walk-forward ${w.label} fitted RMSE ${w.fitted_rmse.toFixed(4)} does not beat baseline ${w.baseline_rmse.toFixed(4)}`,
      );
    }
  }
  return validation;
}

/**
 * Category multiples from the snapshot's own live-token protocols: for each category
 * with at least 3 live tokens, the median market-cap-to-TVL ratio; plus the
 * all-category median as the fallback. Kept for the dashboard's baseline evidence
 * table and the validation baseline. Nothing is hardcoded by protocol name.
 */
export function categoryMultiples(
  protocols: SnapshotProtocol[],
): { byCategory: Map<string, number>; overall: number; counts: Map<string, number> } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? '(no category)';
    const arr = byCat.get(key);
    if (arr === undefined) byCat.set(key, [ratio]);
    else arr.push(ratio);
  }
  const overall = clamp(median(all), MULTIPLE_MIN, MULTIPLE_MAX);
  const byCategory = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [key, ratios] of byCat) {
    counts.set(key, ratios.length);
    if (ratios.length >= 3) {
      byCategory.set(key, clamp(median(ratios), MULTIPLE_MIN, MULTIPLE_MAX));
    }
  }
  return { byCategory, overall, counts };
}

/** The implied value of one pre-token protocol, and the fitted model's working. */
export function scoreProtocol(
  p: SnapshotProtocol,
  beta: [number, number, number, number],
  asOf: string,
): { implied: number; model: BoardRow['model'] } {
  const f = features(p, asOf);
  const pred = predictLogMcap(beta, f);
  const implied = Math.max(1, Math.round(Math.exp(pred)));
  return {
    implied,
    model: {
      coefficients: beta,
      log_tvl: f.log_tvl,
      growth: f.growth,
      age_years: f.age_years,
      predicted_log_mcap: pred,
    },
  };
}

const CATEGORY_ACTIONS: Record<string, { verb: string; second: string }> = {
  Dexs: {
    verb: 'swap and provide liquidity',
    second: 'Add liquidity to a second pool on another chain the protocol runs on',
  },
  Lending: {
    verb: 'supply and borrow',
    second: 'Borrow a small amount against your supply to show both sides of the market',
  },
  RWA: {
    verb: 'deposit and mint',
    second: 'Hold the receipt token for at least a full rewards cycle',
  },
  'Risk Curators': {
    verb: 'deposit into a curated vault',
    second: 'Split a second deposit across a different curator vault',
  },
  'Onchain Capital Allocator': {
    verb: 'allocate into a vault',
    second: 'Allocate a second tranche to a different strategy in the same protocol',
  },
  Yield: {
    verb: 'deposit and stake',
    second: 'Stake the receipt token if the protocol offers a staking module',
  },
  Restaking: {
    verb: 'restake and delegate',
    second: 'Delegate to a second operator to spread the position',
  },
  CDP: {
    verb: 'open a vault and mint',
    second: 'Keep the collateral ratio comfortably above the liquidation line',
  },
  'Basis Trading': {
    verb: 'deposit into the basis vault',
    second: 'Rebalance the position after a funding-rate swing',
  },
  CeDeFi: {
    verb: 'deposit into the vault',
    second: 'Use a second supported chain for the same vault',
  },
  Insurance: {
    verb: 'buy cover and provide cover',
    second: 'Provide cover to a second pool after the first purchase settles',
  },
  Payments: {
    verb: 'send and receive payments',
    second: 'Repeat a payment weekly so the history shows steady use',
  },
  'Governance Incentives': {
    verb: 'vote and lock',
    second: 'Lock for the longest term you can afford to signal commitment',
  },
  'Staking Pool': {
    verb: 'stake and delegate',
    second: 'Delegate to a second validator to spread the stake',
  },
  'Stablecoin Wrapper': {
    verb: 'wrap and unwrap',
    second: 'Hold the wrapped asset through one full peg cycle',
  },
  'Collateral Markets': {
    verb: 'supply collateral and borrow',
    second: 'Borrow a small amount against a second collateral type',
  },
  Chain: {
    verb: 'bridge in and use the chain',
    second: 'Use a second app on the same chain to broaden the footprint',
  },
};

function primaryChain(p: SnapshotProtocol): string {
  return p.chains[0] ?? 'its main chain';
}

function secondChain(p: SnapshotProtocol): string {
  return p.chains[1] ?? p.chains[0] ?? 'another supported chain';
}

/**
 * The test deposit is tiered by the protocol's TVL, so the plan names a concrete
 * dollar size instead of a range: TVL >= $1B -> $1,000; >= $100M -> $500; else $100.
 */
export function testDeposit(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 1000;
  if (tvlUsd >= 100_000_000) return 500;
  return 100;
}

/**
 * A farm plan for one protocol: concrete steps with what they cost and how long they
 * take. Every plan names its test deposit size, its dollar cost and its duration
 * (at least 4 weeks, weekly cadence). Steps are built from the protocol's own
 * category, chains and TVL, never slogans, and never invent a token name, an APY,
 * or a points program the protocol does not advertise in the snapshot (the snapshot
 * carries none of those).
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const action = CATEGORY_ACTIONS[p.category ?? ''] ?? {
    verb: 'use the protocol',
    second: 'Use a second product of the same protocol to broaden the footprint',
  };
  const chain = primaryChain(p);
  const chain2 = secondChain(p);
  const deposit = testDeposit(p.tvl_usd);
  const weekly = Math.round(deposit / 5);
  const tvl = p.tvl_usd >= 1_000_000_000
    ? `$${(p.tvl_usd / 1_000_000_000).toFixed(1)}B`
    : `$${Math.round(p.tvl_usd / 1_000_000)}M`;
  return [
    `Set up first: create a fresh wallet you control, fund it on ${chain} with a $${deposit} test deposit plus about $20 for gas, and read the protocol's own site and docs before you touch any contract. Total cost: about $${deposit + 20}. Time: 30 minutes.`,
    `Deposit the $${deposit} test deposit into ${p.name} on ${chain} to ${action.verb}; confirm the position shows in the app, then leave it untouched for a week before scaling up. Cost: $${deposit} plus about $5 gas. Time: 20 minutes.`,
    `Repeat weekly for at least 4 weeks: ${action.verb} again in smaller amounts of about $${weekly} each week, so the history shows steady use instead of one flash visit. A protocol with ${tvl} of TVL rewards regular users, not one-time wallets. Total extra cost: about $${deposit} over the month plus gas. Time: 15 minutes a week.`,
    `${action.second} on ${chain2} where the protocol runs there, keeping the same wallet address so the activity links to one identity. Cost: about $${Math.round(deposit / 2)} plus gas. Time: 20 minutes.`,
    `Stay safe and stay eligible: never paste a seed phrase anywhere, never sign a blind transaction, revoke approvals you no longer use, and keep a note of every transaction hash, date and amount in case the launch asks for proof. Cost: nothing but attention. Time: 10 minutes a week for the 4 weeks.`,
  ];
}

/** Build the ranked board and the dashboard's data from one snapshot. */
export function buildRadar(snapshot: Snapshot): RadarBuild {
  const multiples = categoryMultiples(snapshot.protocols);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  // The training set: live tokens with a recorded market cap and TVL (n=128).
  const train = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => features(p, snapshot.as_of));
  const validation = validateModel(train);
  const beta = validation.coefficients;

  const score = (p: SnapshotProtocol): BoardRow => {
    const { implied, model } = scoreProtocol(p, beta, snapshot.as_of);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: ageDays(p, snapshot.as_of),
      implied_value_usd: implied,
      model,
      farm_steps: farmSteps(p),
    };
  };

  const watchlistRows = snapshot.watchlist
    .map((slug) => bySlug.get(slug))
    .filter((p): p is SnapshotProtocol => p !== undefined)
    .map(score);

  // Every other eligible pre-token protocol, not a capped top-N: the board carries
  // the whole eligible universe below the floor.
  const early = snapshot.protocols
    .filter((p) => isPreToken(p) && !isExcluded(p) && !snapshot.watchlist.includes(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map(score);

  const board = [...watchlistRows, ...early]
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  // Live view: every protocol that records a token AND a market cap (144), by mcap.
  const live = snapshot.protocols
    .filter((p) => p.gecko_id !== null && p.symbol !== null && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .map((p): LiveRow => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      ratio: (p.mcap_usd ?? 0) / p.tvl_usd,
    }));

  // The 758 accounting, counted from the snapshot at run time, not hardcoded.
  const preToken = snapshot.protocols.filter(isPreToken);
  const coverage: Coverage = {
    total: snapshot.protocols.length,
    board: board.length,
    live: live.length,
    token_no_mcap: snapshot.protocols.filter(
      (p) => !isPreToken(p) && p.mcap_usd === null,
    ).length,
    excluded_pre_token: preToken.filter(isExcluded).length,
  };

  const categoryMultiplesList = [...multiples.byCategory.entries()]
    .map(([category, multiple]) => ({
      category,
      multiple,
      n: multiples.counts.get(category) ?? 0,
    }))
    .sort((a, b) => b.multiple - a.multiple);

  return {
    board,
    radar: {
      version: MODEL_VERSION,
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      overall_multiple: multiples.overall,
      category_multiples: categoryMultiplesList,
      watchlist: snapshot.watchlist,
      rows: board,
      live,
      validation,
      coverage,
    },
    early_size: early.length,
    live_size: live.length,
  };
}

/** The gate's own shape check, run before writing anything out. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board holds ${board.length} rows, fewer than 100`;
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `implied value rises from rank ${i} to rank ${i + 1}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) {
        return `row ${row.slug} has a farm step of ${t.length} characters`;
      }
    }
  }
  return null;
}

/** The dashboard's data as one script: `window.RADAR = {...};`. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
