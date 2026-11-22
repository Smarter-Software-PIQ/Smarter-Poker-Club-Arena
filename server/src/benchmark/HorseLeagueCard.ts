/**
 * ONE LEAGUE CARD FROM THE COMMAND LINE (2026-11-20).
 *
 * The nightly league (HorseLeague.runLeague) deals every card in
 * LEAGUE_MATCHUPS; nothing dealt one named card on demand, so a lane that
 * needed a card result had to wait for the night or hand-write a matchup.
 * This module is the argument handling, the card lookup and the result block
 * of `src/scripts/horseLeagueCard.ts`. It holds no simulator: the script
 * passes the card it resolves here to the league's own runMatchup.
 *
 * Kept free of any HorseLeague value import so its test loads in
 * milliseconds; the card lists are passed in.
 */

import type { LeagueMatchup, LeagueResult, UnmeasurableMatchup } from './HorseLeague.js';

/** Seeds are 32-bit: runMatchup derives every deal from `runSeed ^ ...` under `>>> 0`. */
export const LEAGUE_CARD_MAX_SEED = 0xffff_ffff;
/** Above this a card cannot give every pair its own hand clock (LEAGUE_HAND_CLOCK_MAX_PAIRS). */
export const LEAGUE_CARD_MAX_PAIRS = 65_536;

export const LEAGUE_CARD_USAGE =
  'usage: npx tsx src/scripts/horseLeagueCard.ts --card=<name> --seed=<n>[,<n>...] [--pairs=<n>] [--hydrate-solver-stores]\n' +
  '       npx tsx src/scripts/horseLeagueCard.ts --list\n' +
  '  --card                    exact name of one card in LEAGUE_MATCHUPS\n' +
  '  --seed                    one run seed, or several separated by commas (one full run each)\n' +
  '  --pairs                   duplicate pairs per seed; default is the pairs the card declares\n' +
  '  --hydrate-solver-stores   opt-in: load GTO charts/postflop/V31 stores from Supabase before running\n' +
  '  --list                    print every card name (dealable, then refused) and exit';

export interface LeagueCardArgs {
  list: boolean;
  card: string | null;
  seeds: number[];
  /** null: use the pairs the card declares. */
  pairs: number | null;
  /** Opt-in: hydrate GTO solver stores from Supabase before dealing (default false: offline, zero DB). */
  hydrateSolverStores: boolean;
}

export interface LeagueCardSolverStoreCounts {
  charts: number;
  postflop: number;
  postflopV31: number;
}

/** A refusal the script prints and exits non-zero on; never a stack trace. */
export class LeagueCardRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeagueCardRefusal';
  }
}

function wholeNumber(text: string, what: string, min: number, max: number): number {
  if (!/^\d+$/.test(text)) {
    throw new LeagueCardRefusal(`${what} must be a whole number, got "${text}"`);
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new LeagueCardRefusal(`${what} must be between ${min} and ${max}, got ${text}`);
  }
  return n;
}

export function parseLeagueCardArgs(argv: readonly string[]): LeagueCardArgs {
  const seen = new Map<string, string>();
  let list = false;
  let hydrateSolverStores = false;
  for (const arg of argv) {
    if (arg === '--list') {
      list = true;
      continue;
    }
    if (arg === '--hydrate-solver-stores') {
      if (hydrateSolverStores) throw new LeagueCardRefusal('--hydrate-solver-stores given twice');
      hydrateSolverStores = true;
      continue;
    }
    const m = /^--(card|seed|pairs)=(.+)$/.exec(arg);
    if (!m) throw new LeagueCardRefusal(`unknown argument: ${arg}\n${LEAGUE_CARD_USAGE}`);
    if (seen.has(m[1])) throw new LeagueCardRefusal(`--${m[1]} given twice`);
    seen.set(m[1], m[2]);
  }
  if (list) {
    if (seen.size > 0 || hydrateSolverStores) {
      throw new LeagueCardRefusal('--list takes no other argument');
    }
    return { list: true, card: null, seeds: [], pairs: null, hydrateSolverStores: false };
  }
  const card = seen.get('card');
  if (!card) throw new LeagueCardRefusal(`--card is required\n${LEAGUE_CARD_USAGE}`);
  const seedText = seen.get('seed');
  if (!seedText) {
    // No default seed: a result is only evidence with the seed that made it,
    // and a silent default would give every lane the same deals.
    throw new LeagueCardRefusal(`--seed is required\n${LEAGUE_CARD_USAGE}`);
  }
  const seeds = seedText.split(',').map((s) => wholeNumber(s, '--seed', 1, LEAGUE_CARD_MAX_SEED));
  if (new Set(seeds).size !== seeds.length) {
    throw new LeagueCardRefusal('--seed lists the same seed twice; a repeat is not a second run');
  }
  const pairsText = seen.get('pairs');
  const pairs =
    pairsText === undefined ? null : wholeNumber(pairsText, '--pairs', 2, LEAGUE_CARD_MAX_PAIRS);
  return { list: false, card, seeds, pairs, hydrateSolverStores };
}

/**
 * Opt-in solver store hydration for horseLeagueCard.ts. Matches
 * HorseLeagueComputeWorker.ts by loading all three stores in parallel before
 * dealing, and fails closed if all three return 0 rows.
 */
export async function hydrateLeagueCardSolverStores(loaders: {
  loadCharts: () => Promise<number>;
  loadPostflop: () => Promise<number>;
  loadPostflopV31: () => Promise<number>;
  getCounts: () => LeagueCardSolverStoreCounts;
}): Promise<LeagueCardSolverStoreCounts> {
  const [chartsLoaded, postflopLoaded, postflopV31Loaded] = await Promise.all([
    loaders.loadCharts(),
    loaders.loadPostflop(),
    loaders.loadPostflopV31(),
  ]);
  const counts = loaders.getCounts();
  if (
    chartsLoaded === 0 &&
    postflopLoaded === 0 &&
    postflopV31Loaded === 0 &&
    counts.charts === 0 &&
    counts.postflop === 0 &&
    counts.postflopV31 === 0
  ) {
    throw new LeagueCardRefusal(
      'REFUSED: --hydrate-solver-stores requested, but all three solver stores returned 0 rows ' +
        '(charts=0 postflop=0 postflopV31=0)'
    );
  }
  return counts;
}

/**
 * The one card to deal. Refuses a name on the refused list with its recorded
 * reason (checked first: the reason is the answer the caller needs), and a
 * name on neither list.
 */
export function resolveLeagueCard(
  name: string,
  matchups: readonly LeagueMatchup[],
  unmeasurable: readonly UnmeasurableMatchup[]
): LeagueMatchup {
  const refused = unmeasurable.find((u) => u.name === name);
  if (refused) {
    throw new LeagueCardRefusal(
      `REFUSED: ${name} is listed in UNMEASURABLE_MATCHUPS and is not dealt. ` +
        `Recorded reason: ${refused.reason}`
    );
  }
  const found = matchups.filter((m) => m.name === name);
  if (found.length === 1) return found[0];
  if (found.length > 1) {
    throw new LeagueCardRefusal(`REFUSED: ${found.length} cards are named ${name}`);
  }
  const near = matchups
    .map((m) => m.name)
    .filter((n) => n.includes(name) || name.includes(n))
    .slice(0, 8);
  throw new LeagueCardRefusal(
    `REFUSED: no league card is named ${name}.` +
      (near.length > 0 ? ` Names containing it: ${near.join(', ')}.` : '') +
      ' Run with --list for every name.'
  );
}

export function leagueCardPairs(matchup: LeagueMatchup, requested: number | null): number {
  if (requested !== null) return requested;
  if (matchup.pairs !== undefined) return matchup.pairs;
  throw new LeagueCardRefusal(
    `REFUSED: ${matchup.name} declares no pairs of its own; pass --pairs=<n>`
  );
}

/** The option keys whose value differs between the arms: what the card measures. */
export function leagueCardOptionsUnderTest(matchup: Pick<LeagueMatchup, 'a' | 'b'>): string[] {
  const a = matchup.a as Record<string, unknown>;
  const b = matchup.b as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
}

/** The nightly's own words for a result (HorseLeague.runLeague's log line). */
export function leagueCardVerdict(
  r: Pick<LeagueResult, 'bb100' | 'stderr' | 'inert'>
): 'INERT' | 'SIGNIFICANT' | 'not resolved' {
  if (r.inert === true) return 'INERT';
  return Math.abs(r.bb100) > 2 * r.stderr ? 'SIGNIFICANT' : 'not resolved';
}

export interface LeagueCardRunFacts {
  matchup: LeagueMatchup;
  /** leagueResultConfig(matchup, arm), as the nightly stores config_a / config_b. */
  configA: Record<string, unknown>;
  configB: Record<string, unknown>;
  pairs: number;
  seed: number;
  result: LeagueResult;
  engineRevision: string;
  solverStores: { charts: number; postflop: number; postflopV31: number };
  equityGovernor: string;
}

const fixed = (n: number, digits: number): string =>
  Number.isFinite(n) ? n.toFixed(digits) : 'n/a';

export function formatLeagueCardResult(f: LeagueCardRunFacts): string {
  const m = f.matchup;
  const r = f.result;
  const verdict = leagueCardVerdict(r);
  const options = leagueCardOptionsUnderTest(m);
  const shape = [
    `variant=${m.variant ?? 'nlh'}`,
    `seats=${m.seats ?? 6}`,
    `stackBB=${m.stackBB ?? 100}`,
    `gameMode=${m.context?.gameMode ?? 'cash'}`,
    m.opponentPopulation ? `field=${m.opponentPopulation}` : 'field=mirror',
    m.humanPersona ? `humanPersona=${m.humanPersona}` : null,
    m.hybridBaseline ? 'hybridBaseline' : null,
    m.productionStyles ? 'productionStyles' : null,
    m.moodClock ? `moodClock=${m.moodClock}` : null,
    m.handIdentity ? `handIdentity=${m.handIdentity}` : null,
    m.memoryLearning ? `memoryLearning=${m.memoryLearning}` : null,
    m.spot ? 'spot-seeded' : null,
  ].filter((x): x is string => x !== null);
  const stores = f.solverStores;
  const lines = [
    '=== LEAGUE CARD RESULT ===',
    `card:            ${m.name}`,
    `option:          ${options.length > 0 ? options.join(', ') : '(the arms carry the same options)'}`,
    `arm A:           ${JSON.stringify(f.configA)}`,
    `arm B:           ${JSON.stringify(f.configB)}`,
    `table:           ${shape.join(' ')}`,
    `pairs:           ${f.pairs} requested, ${r.hands / 2} played (${r.hands} hands)`,
    `seed:            ${f.seed}`,
    `bb/100 (A - B):  ${fixed(r.bb100, 2)}`,
    `stderr:          ${fixed(r.stderr, 2)}` +
      (r.blockStderr !== undefined
        ? ` (block stderr ${fixed(r.blockStderr, 2)} over ${r.stderrBlocks} blocks)`
        : ''),
    `z:               ${r.stderr > 0 ? fixed(r.bb100 / r.stderr, 2) : 'n/a (stderr is 0)'}`,
    `SIGNIFICANT:     ${verdict === 'SIGNIFICANT' ? 'yes' : 'no'} (${verdict}; rule |bb/100| > 2 x stderr)`,
    `divergent pairs: ${r.divergentPairs ?? 'n/a'}`,
    `harness:         illegal=${r.illegalActions} truncated=${r.truncatedStreets} ` +
      `corrected=${r.correctedActions ?? 'n/a'} brainFallbacks=${r.brainExceptionFallbacks ?? 'n/a'}`,
    `engine revision: ${f.engineRevision}`,
    `solver stores:   charts=${stores.charts} postflop=${stores.postflop} postflopV31=${stores.postflopV31}` +
      (stores.charts + stores.postflop + stores.postflopV31 === 0
        ? ' (EMPTY: the nightly worker hydrates these from the database; this run did not)'
        : ''),
    `equity governor: ${f.equityGovernor}`,
    `wall time:       ${fixed(r.durationMs / 1000, 1)} s`,
  ];
  if (r.hands / 2 !== f.pairs) {
    lines.push(
      `NOTE:            ${r.hands / 2} of ${f.pairs} requested pairs were played; the figures cover the played pairs only`
    );
  }
  lines.push('=== END ===');
  return lines.join('\n');
}

/**
 * Several seeds of the same card and pair count, as one figure: the mean of
 * the per-seed bb/100 and the standard error of that mean from the per-seed
 * standard errors (independent seeds). null for fewer than two runs, unequal
 * pair counts, or any inert run (an inert run measured nothing to pool).
 */
export function pooledLeagueCardSeeds(
  results: readonly Pick<LeagueResult, 'bb100' | 'stderr' | 'hands' | 'inert'>[]
): { bb100: number; stderr: number; seeds: number } | null {
  if (results.length < 2) return null;
  if (results.some((r) => r.inert === true || r.hands !== results[0].hands)) return null;
  const k = results.length;
  const bb100 = results.reduce((s, r) => s + r.bb100, 0) / k;
  const stderr = Math.sqrt(results.reduce((s, r) => s + r.stderr * r.stderr, 0)) / k;
  return { bb100, stderr, seeds: k };
}
