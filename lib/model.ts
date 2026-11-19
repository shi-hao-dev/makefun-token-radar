// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling)
// and adds the pre-token protocols below the floor with the most TVL, after the same
// exclusions the watchlist rule applies (no CEX, no bridge / liquid-staking / wrapped
// products, no versioned names, no exchange names). A protocol is pre-token when its
// record carries no token (no market cap, no CoinGecko id, no symbol).
//
// Implied value follows only from the snapshot's own figures. The multiple a protocol's
// TVL is worth is NOT a flat number and NOT a hardcoded list of names: it is the median
// market-cap-to-TVL ratio of the live-token protocols in the SAME category, computed
// from this snapshot at run time, falling back to the all-category median where a
// category has too few live comparables. Then:
//
//   growth     = clamp(change_7d, -50, 100) per cent (null counts as 0)
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   chainMult  = 1 + 0.02 x min(chains - 1, 5)            (TVL on more chains is stickier)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity x chainMult))
//
// No protocol name is ever special-cased: the same function scores every row.

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
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

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
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
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
const GROWTH_WEIGHT = 0.5;
const MATURITY_FLOOR = 0.6;
const MATURITY_RANGE = 0.4;
const MATURITY_DAYS = 1095;
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

/**
 * Category multiples from the snapshot's own live-token protocols: for each category
 * with at least 3 live tokens, the median market-cap-to-TVL ratio; plus the
 * all-category median as the fallback. A protocol whose recorded market cap is 0
 * carries no measured value, so it is left out rather than counted as worth nothing.
 * Nothing is hardcoded by protocol name.
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

/** The implied value of one pre-token protocol, and the model's working. */
export function scoreProtocol(
  p: SnapshotProtocol,
  multiples: { byCategory: Map<string, number>; overall: number },
  asOf: string,
): { implied: number; model: BoardRow['model'] } {
  const key = p.category ?? '(no category)';
  const baseMultiple = multiples.byCategory.get(key) ?? multiples.overall;
  const growthPct = clamp(p.change_7d ?? 0, GROWTH_FLOOR, GROWTH_CAP);
  const growthMultiplier = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const age = ageDays(p, asOf);
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMultiplier =
    MATURITY_FLOOR + (Math.min(ageForModel, MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const chainMultiplier = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * baseMultiple * growthMultiplier * maturityMultiplier * chainMultiplier),
  );
  return {
    implied,
    model: {
      base_multiple: baseMultiple,
      growth_pct: growthPct,
      growth_multiplier: growthMultiplier,
      maturity_multiplier: maturityMultiplier,
      chain_multiplier: chainMultiplier,
      age_days: age,
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
 * A farm plan for one protocol: concrete steps with what they cost and how long they
 * take. Steps are built from the protocol's own category and chains, never slogans,
 * and never invent a token name, an APY, or a points program the protocol does not
 * advertise in the snapshot (the snapshot carries none of those).
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const action = CATEGORY_ACTIONS[p.category ?? ''] ?? {
    verb: 'use the protocol',
    second: 'Use a second product of the same protocol to broaden the footprint',
  };
  const chain = primaryChain(p);
  const chain2 = secondChain(p);
  const tvl = p.tvl_usd >= 1_000_000_000
    ? `$${(p.tvl_usd / 1_000_000_000).toFixed(1)}B`
    : `$${Math.round(p.tvl_usd / 1_000_000)}M`;
  return [
    `Set up first: create a fresh wallet you control, fund it on ${chain} with enough for gas plus a $50-$500 test deposit, and check the protocol's own site and docs before you touch any contract. Cost: gas plus the test deposit. Time: 30 minutes.`,
    `Use ${p.name} to ${action.verb} on ${chain}: start with the test deposit, confirm the receipt and the position shows in the app, then scale to your real size only after a week of no issues. Cost: the deposit plus gas. Time: 20 minutes.`,
    `Repeat weekly for at least four weeks: ${action.verb} again in smaller amounts, so the history shows steady use instead of one flash visit. A protocol with ${tvl} of TVL rewards regular users, not one-time wallets. Cost: gas each week. Time: 15 minutes a week.`,
    `${action.second} on ${chain2} where the protocol runs there, keeping the same wallet address so the activity links to one identity. Cost: gas plus a second small deposit. Time: 20 minutes.`,
    `Stay safe and stay eligible: never paste a seed phrase anywhere, never sign a blind transaction, revoke approvals you no longer use, and keep a note of every transaction hash, date and amount in case the launch asks for proof. Cost: nothing but attention. Time: 10 minutes a week.`,
  ];
}

/** Build the ranked board and the dashboard's data from one snapshot. */
export function buildRadar(snapshot: Snapshot): RadarBuild {
  const multiples = categoryMultiples(snapshot.protocols);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  const score = (p: SnapshotProtocol): BoardRow => {
    const { implied, model } = scoreProtocol(p, multiples, snapshot.as_of);
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

  const early = snapshot.protocols
    .filter((p) => isPreToken(p) && !isExcluded(p) && !snapshot.watchlist.includes(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, EARLY_ROWS)
    .map(score);

  const board = [...watchlistRows, ...early]
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_ROWS)
    .map((p): LiveRow => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      ratio: (p.mcap_usd ?? 0) / p.tvl_usd,
    }));

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
