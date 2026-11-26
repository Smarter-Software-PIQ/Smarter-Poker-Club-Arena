/**
 * GRADE IN CHIPS: the out-of-position 3-bet range against a 4-bet (HorseOopReraiseRangeHolds), option ON vs OFF.
 *
 *   mirror: a league mirror card, a = production opts + the option, b = production opts, same seeds (HorseLeague
 *           runMatchup). bb/100 is A's (ON's) chips against B (OFF); OFF is its negative.
 *   probe:  heads-up against a scripted opener (ExploiterLeague runExploiterCell, exploiter in seat 0). The script
 *           plays the production Horse (option OFF) everywhere except its answer to the Horse's 3-bet after its own
 *           button open:
 *             a  4-bets every such 3-bet (pot in PLO, 2.3x in NLH), then plays the Horse;
 *             b  4-bets only with aces or kings, otherwise never re-raises (the Horse's fold or call stands; a raise
 *                becomes a call);
 *             c  calls every such 3-bet.
 *           The Horse's bb/100 is minus the script's. Both arms run on the same seed in one process and are
 *           differenced hand by hand (ExploiterCellSpec.onPair).
 *
 *   npx tsx server/scripts/oop-reraise-range/league.ts --opts <production opts json> --mode mirror --variant plo5 \
 *     --seats 6 --stack 100 --pairs 2000 --seed 7 [--cap 0.45] --out <file.ndjson>
 *   npx tsx server/scripts/oop-reraise-range/league.ts --opts <...> --mode probe --probe a --variant plo5 \
 *     --stack 100 --pairs 2000 --seed 7 --out <file.ndjson>
 *
 * Every arm is sandboxed (no live HorseMind state, no database).
 */
import { readFileSync, appendFileSync } from 'node:fs';
import {
  runMatchup,
  type LeagueMatchup,
  type LeagueSeatSpot,
} from '../../src/benchmark/HorseLeague.js';
import {
  runExploiterCell,
  exploiterSpotHelpers as H,
  type ExploiterPolicy,
  type ExploiterVariant,
} from '../../src/benchmark/ExploiterLeague.js';
import { HORSE_HYBRID_PROFILES } from '../../src/engine/HorseHybridProfile.js';
import type { HorseDecideOpts, HorseProfileMods } from '../../src/engine/HorseLogic.js';

const arg = (k: string, d?: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const MODE = arg('mode', 'mirror')!;
const VARIANT = arg('variant', 'plo5')!;
const SEATS = Number(arg('seats', MODE === 'probe' ? '2' : '6'));
const STACK = Number(arg('stack', '100'));
const PAIRS = Number(arg('pairs', '1000'));
const SEED = Number(arg('seed', '7'));
const OUT = arg('out', '/dev/null')!;
const PROD = (
  arg('opts') ? JSON.parse(readFileSync(arg('opts')!, 'utf8')).opts : {}
) as HorseDecideOpts;
const OPTION =
  VARIANT === 'nlh' ? 'holdemOopReraiseRangeHoldsVsReraise' : 'omahaOopReraiseRangeHoldsVsReraise';
const CAP = arg('cap');
const ON = {
  ...PROD,
  [OPTION]: true,
  ...(CAP !== undefined ? { reraiseFoldShareCap: Number(CAP) } : {}),
} as HorseDecideOpts;

/** Heads-up: the script's own seat facing the Horse's 3-bet after its own first-in raise (the small blind is the
 *  button heads-up, so the opener is in position and the 3-bettor, the big blind, out of position). */
function facingOopThreeBet(s: LeagueSeatSpot): boolean {
  if (s.numSeats !== 2 || s.stage !== 'preflop' || s.toCall <= 0) return false;
  const raises = s.history.filter(
    (a) =>
      a.stage === 'preflop' && (a.action === 'raise' || a.action === 'bet' || a.action === 'all_in')
  );
  return raises.length === 2 && raises[0].userId === s.userId && raises[1].userId !== s.userId;
}
function holdsAcesOrKings(s: LeagueSeatSpot): boolean {
  const n: Record<string, number> = {};
  for (const c of s.cards) n[c.rank] = (n[c.rank] ?? 0) + 1;
  return (n.A ?? 0) >= 2 || (n.K ?? 0) >= 2;
}
function fourBet(s: LeagueSeatSpot) {
  return s.isPotLimit ? H.potWager(s, 1) : H.wager(s, 2.3 * s.currentBet);
}
const hy = HORSE_HYBRID_PROFILES.cash;
/** The script's base play: the production Horse with the option OFF in both arms. */
const baseHorse = (s: LeagueSeatSpot) =>
  s.horseDecide(hy.style, { ...(hy.mods as HorseProfileMods) }, PROD) as {
    action: string;
    amount?: number;
  };

/** Probe a: the hands where the script 4-bet the Horse's 3-bet, and those in which the Horse then continued (the
 *  script acted again in the hand: facing a 5-bet, or after the flop). A new hand is a change of the script's own
 *  cards (two consecutive deals with the same cards are not told apart: rare, and only this count is touched). */
let lastCards = '';
let handNo = 0;
const handKey = (s: LeagueSeatSpot): string => {
  const c = s.cards.map((x) => x.rank + x.suit).join('');
  if (c !== lastCards) {
    lastCards = c;
    handNo++;
  }
  return String(handNo);
};
const fourBetHands = new Set<string>();
const continuedHands = new Set<string>();
function noteContinue(s: LeagueSeatSpot): void {
  const k = handKey(s);
  if (fourBetHands.has(k) && (s.stage !== 'preflop' || s.toCall > 0)) continuedHands.add(k);
}

const PROBES: Record<string, ExploiterPolicy> = {
  a: (s) => {
    noteContinue(s);
    if (!facingOopThreeBet(s)) return baseHorse(s);
    fourBetHands.add(handKey(s));
    return fourBet(s);
  },
  b: (s) => {
    if (!facingOopThreeBet(s)) return baseHorse(s);
    if (holdsAcesOrKings(s)) return fourBet(s);
    const d = baseHorse(s);
    return H.isWager(d) ? H.call(s) : d;
  },
  c: (s) => (facingOopThreeBet(s) ? H.call(s) : baseHorse(s)),
};

async function main() {
  const t0 = Date.now();
  if (MODE === 'mirror') {
    const m: LeagueMatchup = {
      name: `${VARIANT}_${SEATS}max_${STACK}bb_oop_reraise_on_vs_off`,
      variant: VARIANT,
      seats: SEATS,
      stackBB: STACK,
      pairs: PAIRS,
      productionStyles: true,
      a: ON,
      b: PROD,
    } as LeagueMatchup;
    const r = await runMatchup(m, PAIRS, SEED);
    const row = {
      mode: MODE,
      variant: VARIANT,
      seats: SEATS,
      stack: STACK,
      pairs: PAIRS,
      seed: SEED,
      cap: CAP ?? null,
      hands: r.hands,
      onBb100: r.bb100,
      se: r.stderr,
      illegal: r.illegalActions,
      truncated: r.truncatedStreets,
      fallbacks: r.brainExceptionFallbacks ?? 0,
      ms: Date.now() - t0,
    };
    appendFileSync(OUT, JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row));
    return;
  }
  const probe = arg('probe', 'a')!;
  // Both arms on the same seed, one after the other: the deal of pair p is the same in both, so the per-hand
  // difference (ON - OFF) is the graded number; each arm's own bb/100 against the script is shown beside it.
  const arms: Record<string, number[]> = { off: [], on: [] };
  const rows: Record<string, unknown> = {};
  for (const arm of ['off', 'on'] as const) {
    let threeBetsFaced = 0;
    fourBetHands.clear();
    continuedHands.clear();
    const policy = PROBES[probe];
    const r = await runExploiterCell({
      exploiter: 'horse_mirror',
      variant: VARIANT as ExploiterVariant,
      seats: SEATS,
      stackBB: STACK,
      pairs: PAIRS,
      seed: SEED,
      memory: 'on',
      horseOpts: arm === 'on' ? ON : PROD,
      policy: (sp, h) => {
        if (facingOopThreeBet(sp)) threeBetsFaced++;
        return policy(sp, h);
      },
      onPair: (_p, e) => arms[arm].push(-e),
    });
    rows[arm] = {
      horseBb100: -r.exploiterBb100,
      se: r.exploiterSe,
      threeBetsFaced,
      ...(probe === 'a'
        ? {
            foldToFourBet:
              fourBetHands.size > 0 ? 1 - continuedHands.size / fourBetHands.size : null,
          }
        : {}),
      illegal: r.illegalActions,
      truncated: r.truncatedStreets,
      fallbacks: r.brainExceptionFallbacks,
    };
  }
  const d = arms.on.map((x, k) => x - arms.off[k]);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, d.length - 1));
  const row = {
    mode: MODE,
    probe,
    variant: VARIANT,
    seats: SEATS,
    stack: STACK,
    pairs: PAIRS,
    seed: SEED,
    cap: CAP ?? null,
    ...rows,
    onMinusOffBb100: mean * 100,
    onMinusOffSe: (sd / Math.sqrt(d.length)) * 100,
    handsDiffering: d.filter((x) => x !== 0).length,
    ms: Date.now() - t0,
  };
  appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
