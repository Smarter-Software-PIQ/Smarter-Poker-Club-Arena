/**
 * A DEEP SECOND LOOK COUNTS ITS RECEIPTS AND IS NOT THE LIVE DECISION (2026-11-16, PLO6 lane).
 *
 * The second look decides with telemetry on inside withSecondLookFireCapture so that its receipts are counted
 * (second_look_<key>_seen). In HorseLogic "telemetry on" also stood for "this is the live decision" at a few
 * places: the process-wide Phase 8 safety sentinel (read, fed and obeyed), and the evidence-mode clocks and
 * budgets. A second look must behave there exactly as it did when it ran with telemetry off.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import {
  BRAIN_TELEMETRY_FEATURE_MAX_LENGTH,
  SECOND_LOOK_KEY_TOO_LONG_RECEIPT,
  drainFires,
  enableBrainTelemetry,
  inSecondLookCapture,
  noteSecondLookFires,
  secondLookReceiptKey,
  withSecondLookFireCapture,
} from './BrainTelemetry.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { liveHorsePhase8Safety } from './HorsePhase8Safety.js';
import type { Card, SeatPlayer } from '../types.js';

const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;
const seat = (n: number, cards: Card[], stack = 3000): SeatPlayer =>
  ({
    seat: n,
    user_id: `u${n}`,
    username: `u${n}`,
    stack,
    bet: 0,
    totalInvested: 100,
    cards,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  }) as never as SeatPlayer;

type Spot = { hero: SeatPlayer; gs: HorseGameStateV2 };

function tournamentFlop(): Spot {
  const hero = seat(1, [c('A', 'spades'), c('K', 'spades')]);
  const gs = {
    players: [hero, seat(3, []), seat(5, [])],
    communityCards: [c('Q', 'hearts'), c('8', 'diamonds'), c('3', 'clubs')],
    pot: 300,
    currentBet: 0,
    minRaise: 100,
    stage: 'flop',
    gameVariant: 'nlh',
    bigBlind: 100,
    smallBlind: 50,
    dealerSeat: 1,
    actionHistory: [],
    gameMode: 'tournament',
    format: 'mtt',
  } as never as HorseGameStateV2;
  return { hero, gs };
}
function ploRiver(): Spot {
  const hero = seat(
    1,
    [c('9', 'spades'), c('6', 'spades'), c('A', 'hearts'), c('J', 'diamonds')],
    200
  );
  const gs = {
    players: [hero, seat(3, [], 200)],
    communityCards: [
      c('K', 'spades'),
      c('T', 'spades'),
      c('4', 'spades'),
      c('7', 'diamonds'),
      c('2', 'hearts'),
    ],
    pot: 40,
    currentBet: 20,
    minRaise: 20,
    stage: 'river',
    gameVariant: 'plo4',
    bigBlind: 2,
    dealerSeat: 3,
    actionHistory: [],
    gameMode: 'cash',
    format: 'cash',
  } as never as HorseGameStateV2;
  return { hero, gs };
}
function preflop(variant: 'nlh' | 'plo5', tournament: boolean): Spot {
  const cards =
    variant === 'nlh'
      ? [c('A', 'spades'), c('Q', 'spades')]
      : [c('A', 'spades'), c('A', 'hearts'), c('K', 'spades'), c('Q', 'hearts'), c('7', 'clubs')];
  const hero = seat(1, cards, tournament ? 3000 : 200);
  const bb = tournament ? 100 : 2;
  const gs = {
    players: [hero, seat(3, [], tournament ? 3000 : 200), seat(5, [], tournament ? 3000 : 200)],
    communityCards: [],
    pot: bb * 1.5,
    currentBet: bb,
    minRaise: bb,
    stage: 'preflop',
    gameVariant: variant,
    bigBlind: bb,
    smallBlind: bb / 2,
    dealerSeat: 1,
    actionHistory: [],
    gameMode: tournament ? 'tournament' : 'cash',
    format: tournament ? 'mtt' : 'cash',
  } as never as HorseGameStateV2;
  return { hero, gs };
}

function decide(spot: () => Spot, opts: Record<string, unknown>, seed: number) {
  return withFrozenDecisionClock(() => {
    seedFastRandom(seed);
    const s = spot();
    return HorseLogic.decide(s.hero, s.gs, 'balanced', {}, { mind: false, ...opts } as never);
  });
}

/**
 * The wall-clock fields of a decision: measured times, never chosen ones. Named one by one, so a field that
 * is a CHOICE (budgetMs: the budget a phase was given) is compared like everything else.
 */
const WALL_CLOCK_FIELDS = new Set([
  'analysisMs',
  'elapsedMs',
  'latencyMs',
  'policyMs',
  'simulationMs',
  'utilityLatencyMs',
]);

/** The whole decision without its wall-clock fields. */
function timeless(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(timeless);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (WALL_CLOCK_FIELDS.has(k)) continue;
      out[k] = timeless(v);
    }
    return out;
  }
  return value;
}

const sentinel = liveHorsePhase8Safety as unknown as {
  consecutiveBudgetFailures: number;
  eligibleSinceFire: number;
  disabledReason: string | null;
};
const sentinelState = () => ({
  consecutiveBudgetFailures: sentinel.consecutiveBudgetFailures,
  eligibleSinceFire: sentinel.eligibleSinceFire,
  disabledReason: sentinel.disabledReason,
});

describe('a second look is not the live decision', () => {
  let saved: ReturnType<typeof sentinelState>;
  beforeEach(() => {
    enableBrainTelemetry();
    drainFires();
    saved = sentinelState();
    sentinel.consecutiveBudgetFailures = 0;
    sentinel.eligibleSinceFire = 0;
    sentinel.disabledReason = null;
  });
  afterEach(() => {
    Object.assign(sentinel, saved);
    vi.restoreAllMocks();
    drainFires();
  });

  it('a tournament postflop second look does not feed the Phase 8 sentinel; the fast look does', () => {
    const observe = vi.spyOn(liveHorsePhase8Safety, 'observe');
    decide(tournamentFlop, { telemetry: true }, 11);
    // the spot reaches Phase 8: the live (fast) decision feeds the sentinel
    expect(observe).toHaveBeenCalledTimes(1);
    observe.mockClear();
    const before = sentinelState();
    const captured = withSecondLookFireCapture(() =>
      decide(tournamentFlop, { telemetry: true }, 11)
    );
    expect(observe).not.toHaveBeenCalled();
    expect(sentinelState()).toEqual(before);
    // its Phase 8 receipts are still collected
    expect(captured.fired.has('phase8_seen')).toBe(true);
    // telemetry off (the second look before this change) did not feed it either
    decide(tournamentFlop, {}, 11);
    expect(observe).not.toHaveBeenCalled();
  });

  it('a second look ignores a tripped sentinel exactly as with telemetry off; the fast look obeys it', () => {
    for (const seed of [11, 4242, 7]) {
      sentinel.disabledReason = null;
      const off = decide(tournamentFlop, {}, seed) as { tournamentPostflop?: { reason?: string } };
      sentinel.disabledReason = 'eligible_but_silent';
      const captured = withSecondLookFireCapture(() =>
        decide(tournamentFlop, { telemetry: true }, seed)
      ).value as { tournamentPostflop?: { reason?: string } };
      expect(timeless(captured), `seed ${seed}`).toEqual(timeless(off));
      expect(String(captured.tournamentPostflop?.reason)).not.toMatch(/^disabled_/);
      const live = decide(tournamentFlop, { telemetry: true }, seed) as {
        tournamentPostflop?: { reason?: string };
      };
      expect(String(live.tournamentPostflop?.reason), `seed ${seed}`).toBe(
        'disabled_eligible_but_silent'
      );
      expect(sentinel.disabledReason).toBe('eligible_but_silent');
    }
  });

  it('the whole decision is the same with telemetry off and on inside the capture: tournament postflop, Omaha, preflop', () => {
    const spots: Array<[string, () => Spot]> = [
      ['tournament flop', tournamentFlop],
      ['plo4 cash river', ploRiver],
      ['nlh cash preflop', () => preflop('nlh', false)],
      ['nlh tournament preflop', () => preflop('nlh', true)],
      ['plo5 cash preflop', () => preflop('plo5', false)],
      ['plo5 tournament preflop', () => preflop('plo5', true)],
    ];
    for (const [name, spot] of spots)
      for (const seed of [11, 4242, 90210, 7, 31337]) {
        const off = decide(spot, {}, seed);
        drainFires(); // a receipt that is not telemetry-gated counts for the telemetry-off decision
        const captured = withSecondLookFireCapture(() => decide(spot, { telemetry: true }, seed));
        expect(timeless(captured.value), `${name} seed ${seed}`).toEqual(timeless(off));
        expect(captured.fired.size, `${name} seed ${seed}`).toBeGreaterThan(0);
        expect(inSecondLookCapture()).toBe(false);
        // nothing the capture collected was counted under its own name
        expect(drainFires(), `${name} seed ${seed}`).toEqual([]);
      }
  });
});

describe('a second_look_ key the writer would refuse', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    drainFires();
  });
  it('is not counted under that name; the second look counts one fixed receipt instead', () => {
    const fits = 'k'.repeat(
      BRAIN_TELEMETRY_FEATURE_MAX_LENGTH - 'second_look_'.length - '_seen'.length
    );
    const tooLong = `${fits}x`;
    expect(secondLookReceiptKey(fits)).toHaveLength(BRAIN_TELEMETRY_FEATURE_MAX_LENGTH);
    noteSecondLookFires(new Set([fits, tooLong, `${tooLong}y`, 'short_key']));
    const rows = new Map(drainFires().map((r) => [r.feature, r.fires]));
    expect(rows.get(secondLookReceiptKey(fits))).toBe(1);
    expect(rows.get('second_look_short_key_seen')).toBe(1);
    expect(rows.has(secondLookReceiptKey(tooLong))).toBe(false);
    expect(rows.get(SECOND_LOOK_KEY_TOO_LONG_RECEIPT)).toBe(1);
    expect([...rows.keys()].every((k) => k.length <= BRAIN_TELEMETRY_FEATURE_MAX_LENGTH)).toBe(
      true
    );
    expect(SECOND_LOOK_KEY_TOO_LONG_RECEIPT.startsWith('second_look_')).toBe(true);
  });
});

/**
 * SOURCE LAW. In HorseLogic.ts code gated on telemetry may only COUNT. A second look runs that code
 * (telemetry on inside a capture), so anything else there would make a second look differ from what it was.
 *
 * What the law reads (comments and string contents blanked first):
 *  - every `if` whose condition names telemetryOn(opts), tele, tele15, teleLive or phase8Live, with its whole
 *    else chain. In it: every plain call, every method call (a.b.c(...)) and every assignment or ++/--. A
 *    counting call (noteFire, noteWatch, noteWatchMax, noteDecisionMs) and a pure builtin pass; anything else
 *    must be listed below WITH THE NUMBER OF SITES it has today and why it cannot change a decision. A new
 *    site of a listed name changes the number and fails, so a listing is per call site, not per name.
 *  - every use of those names OUTSIDE an `if` condition (a ternary, `tele && f()`, an argument, an object
 *    field, an alias): each line is listed with its count; a new one fails.
 *  - the two shapes that broke this once: `!tele` (a clock or budget chosen by telemetry: use teleLive) and
 *    a read of the Phase 8 sentinel that is not behind the live test.
 *
 * What it does not read: code gated only through a value that is itself set under telemetry (the two
 * counterfactual results tightOff and v53IcmOff are read later in plain `if`s), and files other than
 * HorseLogic.ts. The decision-equality test above is the behavioural guard for those.
 */
type LawSurvey = {
  blocks: number;
  calls: Map<string, number>;
  methods: Map<string, number>;
  assigns: Map<string, number>;
  outside: Map<string, number>;
};
type LawAllow = {
  calls: Record<string, [number, string]>;
  methods: Record<string, [number, string]>;
  assigns: Record<string, [number, string]>;
  outside: Record<string, [number, string]>;
};

const LAW_GATE = /telemetryOn\(\s*opts\s*\)|\btele(15|Live)?\b|\bphase8Live\b/;
const LAW_COUNTING = /^(noteFire|noteWatch|noteWatchMax|noteDecisionMs)$/;
const LAW_KEYWORD = /^(if|for|while|switch|return|typeof|catch|function|new|else|do|await|void)$/;
/** Pure builtins: they read their arguments and write nothing. And the gate itself (an else-if condition inside a gated chain names it). */
const LAW_PURE_CALL = /^(String|Number|Boolean|telemetryOn)$/;
const LAW_PURE_METHOD = /^(Math\.(max|min|abs|round|floor|ceil)|Number\.isFinite)$/;

/** Comments and the contents of strings blanked; length and line breaks kept, so positions still hold. */
function lawStrip(src: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/`(?:[^`\\]|\\.)*`/g, (s) => '`' + blank(s.slice(1, -1)) + '`')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (s) => "'" + blank(s.slice(1, -1)) + "'")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (s) => '"' + blank(s.slice(1, -1)) + '"')
    .replace(/\/\/.*$/gm, blank);
}

type LawBlock = { condStart: number; condEnd: number; bodyStart: number; bodyEnd: number };

function lawGatedBlocks(S: string): LawBlock[] {
  const closeOf = (open: string, close: string, from: number) => {
    let j = from;
    for (let depth = 1; depth > 0 && j < S.length; j++) {
      if (S[j] === open) depth++;
      else if (S[j] === close) depth--;
    }
    return j;
  };
  const skipSpace = (from: number) => {
    let k = from;
    while (k < S.length && /\s/.test(S[k])) k++;
    return k;
  };
  /** The end of the statement or block starting at k. */
  const statementEnd = (k: number) => {
    if (S[k] === '{') return closeOf('{', '}', k + 1);
    const semi = S.indexOf(';', k);
    return semi < 0 ? S.length : semi + 1;
  };
  const out: LawBlock[] = [];
  const re = /\bif\s*\(/g;
  const elseRe = /else\b/y;
  const elseIfRe = /if\s*\(/y;
  let m: RegExpExecArray | null;
  while ((m = re.exec(S))) {
    const condEnd = closeOf('(', ')', m.index + m[0].length);
    if (!LAW_GATE.test(S.slice(m.index, condEnd))) continue;
    const bodyStart = skipSpace(condEnd);
    let bodyEnd = statementEnd(bodyStart);
    // the else chain is the same gate read the other way: it belongs to the gated code
    for (;;) {
      const k = skipSpace(bodyEnd);
      elseRe.lastIndex = k;
      if (!elseRe.test(S)) break;
      let next = skipSpace(elseRe.lastIndex);
      elseIfRe.lastIndex = next;
      if (elseIfRe.test(S)) next = skipSpace(closeOf('(', ')', elseIfRe.lastIndex));
      bodyEnd = statementEnd(next);
    }
    out.push({ condStart: m.index, condEnd, bodyStart, bodyEnd });
  }
  return out;
}

function lawSurvey(src: string): LawSurvey {
  const S = lawStrip(src);
  const blocks = lawGatedBlocks(S);
  const calls = new Map<string, number>();
  const methods = new Map<string, number>();
  const assigns = new Map<string, number>();
  const outside = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const inCondition = new Uint8Array(S.length);
  for (const b of blocks) inCondition.fill(1, b.condStart, b.condEnd);
  // a gated block inside a gated block is read once, with the outer one
  const outer = blocks.filter(
    (b) => !blocks.some((o) => o !== b && o.bodyStart <= b.condStart && o.bodyEnd >= b.bodyEnd)
  );
  for (const b of outer) {
    const body = S.slice(b.bodyStart, b.bodyEnd);
    for (const call of body.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = call[1];
      if (LAW_KEYWORD.test(name) || LAW_COUNTING.test(name) || LAW_PURE_CALL.test(name)) continue;
      bump(calls, name);
    }
    for (const call of body.matchAll(
      /(?<![\w$])((?:[A-Za-z_$][\w$]*)(?:\??\.[A-Za-z_$][\w$]*)+)\s*\(/g
    )) {
      const path = call[1].replace(/\?\./g, '.');
      if (!LAW_PURE_METHOD.test(path)) bump(methods, path);
    }
    for (const a of body.matchAll(
      /(?<![\w$.])((?:const|let|var)\s+)?([A-Za-z_$][\w$.[\]]*)\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/g
    )) {
      if (a[1]) continue; // a local declaration
      if (a.index > 0 && /[=!<>]/.test(body[a.index - 1])) continue;
      bump(assigns, a[2]);
    }
    for (const a of body.matchAll(
      /(?:\+\+|--)\s*([A-Za-z_$][\w$.]*)|([A-Za-z_$][\w$.]*)\s*(?:\+\+|--)/g
    ))
      bump(assigns, `${a[1] ?? a[2]}++`);
  }
  let pos = 0;
  for (const line of S.split('\n')) {
    const re = /telemetryOn\(|\btele(15|Live)?\b|\bphase8Live\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)))
      if (inCondition[pos + m.index] !== 1) bump(outside, line.trim().replace(/\s+/g, ' '));
    pos += line.length + 1;
  }
  return { blocks: blocks.length, calls, methods, assigns, outside };
}

/** Every difference between what the source holds and what is listed, in both directions. */
function lawOffenders(found: LawSurvey, allow: LawAllow): string[] {
  const out: string[] = [];
  for (const kind of ['calls', 'methods', 'assigns', 'outside'] as const) {
    const names = new Set([...found[kind].keys(), ...Object.keys(allow[kind])]);
    for (const name of names) {
      const have = found[kind].get(name) ?? 0;
      const listed = allow[kind][name]?.[0] ?? 0;
      if (have !== listed) out.push(`${kind}: ${name} found ${have}, listed ${listed}`);
    }
  }
  return out.sort();
}

const NO_ALLOW: LawAllow = { calls: {}, methods: {}, assigns: {}, outside: {} };

describe('source law: telemetry-gated code in HorseLogic.ts only counts', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./HorseLogic.ts', import.meta.url)), 'utf8');
  /** Everything telemetry-gated in HorseLogic.ts that is not a counting call: [sites today, why it is safe]. */
  const ALLOW: LawAllow = {
    calls: {
      run: [
        1,
        'receiptWagerRuleStage runs its stage behind the gate exactly as it runs it without (the same call, the same arguments)',
      ],
      isTournamentMode: [10, 'pure read of the game state; chooses a receipt name'],
      omahaIsWager: [1, 'pure predicate on a decision'],
      omahaSameWager: [4, 'pure predicate on two decisions'],
      omahaPlanLineUncommitted: [1, 'pure predicate on a plan line'],
      wagerBindingPassedShortAllIn: [1, 'pure predicate; chooses a receipt name'],
      holdemDrawPresent: [1, 'pure predicate on cards'],
      riverNutsAlreadyFull: [
        1,
        'pure predicate on cards (hasRiverNuts), in the condition of a gated else-if; chooses a receipt',
      ],
      omahaProposeReceipt: [
        21,
        'queues a receipt (made / vetoed) settled against the final decision; the queue is cleared per decide',
      ],
      changed: [3, 'a local closure that only calls noteFire'],
      noteHorsePlayStyleReceipt: [
        2,
        'a local function that only calls noteFire (the one play style receipt of a decision)',
      ],
      noteGtoMiss: [1, 'HorseGtoExecution: two noteFire calls'],
      noteHorseActionClamped: [5, 'a watchcounter (dropped inside a second-look capture)'],
      noteHorsePlanReevaluated: [2, 'a watchcounter (dropped inside a second-look capture)'],
      noteHorseTelemetryOpportunity: [2, 'a watchcounter (dropped inside a second-look capture)'],
      decidePreflopV7: [
        2,
        'the two rewound counterfactuals (v53 ICM off, tight read off): the RNG is restored in a finally and the deep-dive collector is detached',
      ],
      icmOff53: [1, 'the v53 counterfactual closure (decidePreflopV7, rewound)'],
      saveFastRandom: [2, 'saves the RNG position a counterfactual restores'],
      restoreFastRandom: [2, 'restores the RNG position after a counterfactual'],
      withHorseDeepDiveCapture: [2, 'detaches the deep-dive collector for a counterfactual'],
      withBrainTelemetrySuspended: [1, 'pauses the counters for the tight-read counterfactual'],
      inSecondLookCapture: [1, 'the live test itself'],
      verdictOf: [
        1,
        'omahaTurnStabDefenceIsPriced receipt: the pure facing-bet verdict (omahaFacingBetEvVerdict: no random draw, no telemetry, no memory) on the unadjusted spot, compared to name a receipt; the decision is the same either way',
      ],
      omahaBetReadBluffShare: [
        1,
        'omahaBetReadIsPerOpponent receipt (lane CR2): the pure bluff-share arithmetic of the read already taken (no random draw, no telemetry, no memory), only to write the receipt amount',
      ],
      gtoDefence: [
        1,
        'cashDefenceTrimColdCalls per-hand option receipt: the pure defence base (no random draw, no telemetry, no memory) on the same cards and spot with the trim taken out, read only by the rewound intent that names the receipt',
      ],
      clamp01: [1, 'pure arithmetic on the untrimmed defence base of that receipt'],
      holdemPersonaContinueBar: [
        1,
        'pure arithmetic: the same persona shift the live base takes, on the untrimmed base of that receipt',
      ],
      noteDecisionRuleReceipt: [
        30,
        'BrainTelemetry: copies the action a receipted rule was given and the one it left into the active isolated decision or second-look capture; never alters the decision (2026-11-26: +3, the river opening value and bluff receipts and the trips-board full house call; +3 the flop raise price receipts; +3 the opening bluff receipts)',
      ],
    },
    methods: {
      'bands.some': [1, 'pure read of a local array; chooses a receipt name'],
      'oppReads.some': [1, 'pure read of a local array; chooses a receipt name'],
      'receipt.reason.startsWith': [1, 'pure string test; chooses a receipt name'],
      'liveHorsePhase8Safety.observe': [
        1,
        'feeds the Phase 8 sentinel: only behind phase8Live, which is false inside a second look (checked below)',
      ],
    },
    assigns: {
      tightOff: [
        2,
        'the tight-read counterfactual result (a local), read only to choose a receipt',
      ],
      v53IcmOff: [2, 'the v53 counterfactual result (a local), read only to choose a receipt'],
      gtoDefend72TrimOff: [
        1,
        'the untrimmed defence base of the cashDefenceTrimColdCalls receipt (a local), read only by the rewound intent that names the receipt',
      ],
      huDefendToPricePending: [
        1,
        'a per-decision pending receipt, reset at each decide, read only by noteFire',
      ],
    },
    outside: {
      'const tele = telemetryOn(opts);': [
        58,
        'the local name of the gate (two names on each line; includes holdemPersonaPostflopPriced helper, the opening-side priced rule, the multiway opening priced rule and the tournament bluff priced rule)',
      ],
      'const tele15 = telemetryOn(opts);': [2, 'the local name of the gate (preflop)'],
      'const teleLive = tele && !inSecondLookCapture();': [
        2,
        'the live test: telemetry and not a second look (two names on the line)',
      ],
      'const phase8Live = teleLive;': [
        2,
        'the Phase 8 name of the live test (two names on the line)',
      ],
      'const disabledReason = phase8Live ? liveHorsePhase8Safety.disabledReason : null;': [
        1,
        'the sentinel is read only when live; a second look passes null as with telemetry off',
      ],
      '!teleLive': [1, 'evidence-mode clock: a second look keeps the zero clock'],
      'opts.phase10EvidenceMode && !teleLive ? () => 0 : undefined,': [
        1,
        'evidence-mode clock: a second look keeps the zero clock',
      ],
      'opts.phase11EvidenceMode && !teleLive ? () => 0 : undefined,': [
        1,
        'evidence-mode clock: a second look keeps the zero clock',
      ],
      'opts.phase12EvidenceMode && !teleLive ? () => 0 : undefined,': [
        1,
        'evidence-mode clock: a second look keeps the zero clock',
      ],
      'opts.phase13EvidenceMode && !teleLive ? () => 0 : undefined,': [
        1,
        'evidence-mode clock: a second look keeps the zero clock',
      ],
      'opts.phase13EvidenceMode && !teleLive': [
        1,
        'evidence-mode budget: a second look keeps the fixed budget',
      ],
      'const jointNow = opts.phase13EvidenceMode && !teleLive ? () => 0 : () => performance.now();':
        [1, 'evidence-mode clock: a second look keeps the zero clock'],
      'const graph = new HorsePolicyGraph(undefined, tele);': [
        1,
        'the policy graph counts its node receipts when told to; it decides the same either way',
      ],
      "reconcileHorsePhaseReceipts(phaseReceiptsBeforeLaterOwners, decision, ' ', tele);": [
        1,
        'reconciles receipts against the final decision; counting only',
      ],
      'pendingPlanFingerprintTelemetry = tele15;': [
        1,
        'a pending flag read only to count the plan fingerprint receipt',
      ],
      '? { omahaManiacReRaiseMeasured: true, omahaManiacReRaiseReceipt: telemetryOn(opts) }': [
        1,
        'asks the read for its receipt; the measured width is the same either way',
      ],
      'noteLayer: telemetryOn(opts)': [1, 'a counting callback handed to the preflop layer'],
      'telemetryOn(opts) ? noteIcmBustPaysPlaceFactorChanged : undefined': [
        1,
        'a counting callback (one noteFire) handed to withIcmBustPaysPlace, called once after the decision returns; the decision is the same either way',
      ],
      'telemetry: telemetryOn(opts),': [
        8,
        'passes the gate to a module that counts with it (2026-11-24: also omahaMultiwayValueBetRule and omahaFlopCallTreeRule, which only noteFire with it; and the re-raised pot price rule)',
      ],
      'telemetryOn(opts) &&': [1, 'the head of a gated counting expression'],
      'equilibriumAnchored !== null && verdict !== null && telemetryOn(opts)': [
        1,
        'omahaFacingBetPriorIsPeopleMeasured: decides whether to re-run the verdict on the old read only to name the changed receipt; the decision is the same either way',
      ],
      tele: [
        2,
        'the gate passed as an argument to a module that counts with it (and to omahaValueSizeIsUnreadableRule, which only counts with it)',
      ],
      'tele: boolean': [
        6,
        'the gate as the parameter of omahaBetSizeByPublicStateRule, omahaValueSizeIsUnreadableRule, holdemRiverBoatLeadPriced, riverNoBlockerBetRule, holdemAllInCallReference and horseSlowplayPricedDecision, read there only to count',
      ],
      'readonly tele: boolean;': [
        1,
        'the gate as a field of the v78CommitsWithoutJam priced context, read there only to name the v78 priced allow / veto receipt; the veto is the same either way',
      ],
      'tele: tele15,': [
        2,
        'the gate passed in the v78 priced context (v78NoCommittingBluffRaiseIsPriced), read there only to count',
      ],
      'tele: boolean,': [
        1,
        'the gate as the parameter of receiptWagerRuleStage (LEAKMAP), read there only to name a stage receipt; the stage runs the same either way',
      ],
      'receiptWagerRuleStage(tele, stage, before, run);': [
        1,
        'passes the gate to receiptWagerRuleStage, which runs the stage either way and only counts with it',
      ],
      'decision = holdemRaiseDefenceReference(decision, player, gs, opts, tele, {': [
        1,
        'passes the gate to the tournament raise defence reference (HorseHoldemTournamentRaiseDefenceWiring), which only counts with it (its receipts); the fold, call, jam or re-raise is the same either way',
      ],
      'decision = holdemAllInCallReference(decision, player, gs, vi, opts, tele);': [
        1,
        'passes the gate to the tournament all-in call reference, which only counts with it; the call or fold is the same either way',
      ],
      tele15: [
        1,
        'the gate passed as the last argument to holdemRiverBoatLeadPriced, which only counts with it; the lead is the same either way',
      ],
      'this.omahaBetSizeByPublicStateRule(d, player, gs, vi, opts, tele),': [
        1,
        'passes the gate to the public bet size rule, which only counts with it; the size is the same either way',
      ],
      'tele15,': [1, 'the gate passed in the v31 input, read there to count'],
      '? { ...r, decision: this.riverNoBlockerBetRule(r.decision, player, gs, vi, opts, tele) }': [
        1,
        'passes the gate to the river no-blocker-bet rule (horseRiverNoBlockerBet), which only counts with it; the decision is the same either way',
      ],
      'applyOmahaBigBetSizeRange(oppReads, opponents, player, gs, tele15);': [
        1,
        'passes the gate to omahaBigBetSizeIsPriced range helper, which only counts receipts with it; the range strength is the same either way',
      ],
      'const priced = omahaPricedLimpedPotSize(decision, player, gs, rake, tele);': [
        1,
        'passes the gate to omahaBigBetSizeIsPriced limped-pot sizing helper, which only counts receipts with it; the bet size is the same either way',
      ],
    },
  };

  it('finds the gated blocks (the reader works)', () => {
    expect(lawSurvey(SRC).blocks).toBeGreaterThan(300);
  });

  it('every call, method call, assignment and outside use is a counting one or listed with its site count', () => {
    expect(lawOffenders(lawSurvey(SRC), ALLOW)).toEqual([]);
    for (const kind of ['calls', 'methods', 'assigns', 'outside'] as const)
      for (const [name, [, why]] of Object.entries(ALLOW[kind]))
        expect(why.length, `${kind} ${name} has a reason`).toBeGreaterThan(10);
  });

  it('the Phase 8 sentinel is fed only behind the live test', () => {
    const S = lawStrip(SRC);
    const feeds = [...S.matchAll(/\bliveHorsePhase8Safety\.observe\s*\(/g)];
    const guarded = [
      ...S.matchAll(/\bif\s*\(\s*phase8Live\s*\)\s*\{?\s*liveHorsePhase8Safety\.observe\s*\(/g),
    ];
    expect(feeds).toHaveLength(1);
    expect(guarded).toHaveLength(feeds.length);
  });

  it('no clock or budget is chosen by `!tele`, and the Phase 8 sentinel is read behind the live test only', () => {
    const S = lawStrip(SRC);
    expect(S.match(/!tele(15)?\b/g) ?? []).toEqual([]);
    const memberUses = [...S.matchAll(/\bliveHorsePhase8Safety\.\w+/g)].map((m) => m[0]);
    expect(memberUses).toEqual([
      'liveHorsePhase8Safety.disabledReason',
      'liveHorsePhase8Safety.observe',
      'liveHorsePhase8Safety.disabledReason',
    ]);
    expect([
      ...S.matchAll(/\bphase8Live\s*\?\s*liveHorsePhase8Safety\.disabledReason\s*:\s*null\b/g),
    ]).toHaveLength(1);
    expect([
      ...S.matchAll(
        /!\(\s*telemetryOn\(\s*opts\s*\)\s*&&\s*!inSecondLookCapture\(\)\s*&&\s*liveHorsePhase8Safety\.disabledReason\s*\)/g
      ),
    ]).toHaveLength(1);
    expect(S.match(/\bliveHorsePhase8Safety\b/g) ?? []).toHaveLength(4);
    expect(SRC).toContain('const teleLive = tele && !inSecondLookCapture();');
    expect(SRC).toContain('const phase8Live = teleLive;');
  });

  describe('the law fails on each shape it exists to catch (synthetic sources through the same reader)', () => {
    const offendersOf = (src: string, allow: LawAllow = NO_ALLOW) =>
      lawOffenders(lawSurvey(src), allow);
    const cases: Array<[string, string, string]> = [
      [
        'a memo written in a gated block (a method call)',
        'function f(opts) { const tele = telemetryOn(opts);\n if (tele) HorseMind.someMemo.set(k, v);\n}',
        'methods: HorseMind.someMemo.set found 1, listed 0',
      ],
      [
        'a wall-clock read in a gated block',
        'if (tele) { noteFire("a"); performance.now(); }',
        'methods: performance.now found 1, listed 0',
      ],
      [
        'a push onto shared state in a gated block',
        'if (tele15) { arr.push(1); }',
        'methods: arr.push found 1, listed 0',
      ],
      [
        'a method on this in a gated block',
        'if (telemetryOn(opts)) this.remember(x);',
        'methods: this.remember found 1, listed 0',
      ],
      [
        'the journaled deep-dive capture written from a gated block (a note name that does not count)',
        'if (tele) noteHorseDeepDiveRule("rule");',
        'calls: noteHorseDeepDiveRule found 1, listed 0',
      ],
      [
        'a plain call that is not listed',
        'if (tele) { rememberOpponent(seat); }',
        'calls: rememberOpponent found 1, listed 0',
      ],
      [
        'an assignment in a gated block',
        'if (tele) lastSeenStreet = street;',
        'assigns: lastSeenStreet found 1, listed 0',
      ],
      [
        'a compound assignment in a gated block',
        'if (tele) { state.total += 1; }',
        'assigns: state.total found 1, listed 0',
      ],
      [
        'an increment in a gated block',
        'if (tele) { budgetUsed++; }',
        'assigns: budgetUsed++ found 1, listed 0',
      ],
      [
        'the else branch of a gated if',
        'if (tele) noteFire("a");\nelse cache.set(1, 2);',
        'methods: cache.set found 1, listed 0',
      ],
      [
        'an else-if branch of a gated if',
        'if (tele) { noteFire("a"); } else if (other) { cache.clear(); }',
        'methods: cache.clear found 1, listed 0',
      ],
      [
        'a budget chosen by a ternary on the gate',
        'const budget = tele ? live : fixed;',
        'outside: const budget = tele ? live : fixed; found 1, listed 0',
      ],
      [
        'a call behind `tele &&`',
        'tele && remember(x);',
        'outside: tele && remember(x); found 1, listed 0',
      ],
      [
        'an alias of the gate',
        'const quiet = tele15;',
        'outside: const quiet = tele15; found 1, listed 0',
      ],
      [
        'the gate passed as an argument',
        'decideDeep(player, tele);',
        'outside: decideDeep(player, tele); found 1, listed 0',
      ],
      [
        'the gate as an object field',
        'const o = { live: telemetryOn(opts) };',
        'outside: const o = { live: telemetryOn(opts) }; found 1, listed 0',
      ],
    ];
    for (const [title, src, offender] of cases)
      it(title, () => {
        expect(offendersOf(src)).toContain(offender);
      });

    it('a listing is per site: one more site of a listed call fails', () => {
      const allow: LawAllow = { ...NO_ALLOW, calls: { decidePreflopV7: [2, 'two rewound sites'] } };
      const two = 'if (tele) { decidePreflopV7(a); }\nif (tele) { decidePreflopV7(b); }';
      expect(offendersOf(two, allow)).toEqual([]);
      expect(offendersOf(`${two}\nif (tele) { decidePreflopV7(c); }`, allow)).toContain(
        'calls: decidePreflopV7 found 3, listed 2'
      );
    });

    it('counting calls, pure builtins, local declarations and comparisons pass; comments and strings are not read', () => {
      const clean = [
        'if (tele) {',
        '  const label = String(street) + "tele && cache.set(1)"; // tele ? a : b',
        '  /* if (tele) cache.set(1, 2); */',
        '  if (count === 3 && other >= 2) noteFire(label);',
        '  noteWatch("x", Math.max(1, 2));',
        '  noteDecisionMs("scope", 1);',
        '}',
      ].join('\n');
      expect(offendersOf(clean)).toEqual([]);
    });

    it('a stale listing fails too (the list cannot rot)', () => {
      const allow: LawAllow = { ...NO_ALLOW, calls: { gone: [1, 'was removed from the source'] } };
      expect(offendersOf('if (tele) noteFire("a");', allow)).toEqual([
        'calls: gone found 0, listed 1',
      ]);
    });
  });
});

/**
 * SOURCE LAW. outsideSecondLookCapture suspends the capture, so inside it a second look is "live" again
 * (it feeds and obeys the Phase 8 sentinel and uses live clocks). It exists for offline harnesses that read a
 * look's own fires. No file outside server/src/benchmark may call it.
 */
describe('source law: outsideSecondLookCapture is called from the benchmark harness only', () => {
  const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(entry.name)) files.push(path);
    }
  };
  walk(SRC_ROOT);
  const users = files
    .filter((path) => /\boutsideSecondLookCapture\b/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(SRC_ROOT, path).split(sep).join('/'))
    .sort();

  it('reads the whole of server/src', () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(users).toContain('engine/BrainTelemetry.ts');
  });

  it('every file that names it is its definition, this law, or under benchmark/', () => {
    const outsideBenchmark = users.filter(
      (path) =>
        !path.startsWith('benchmark/') &&
        path !== 'engine/BrainTelemetry.ts' &&
        path !== 'engine/SecondLookIsNotLive.test.ts'
    );
    expect(outsideBenchmark).toEqual([]);
    expect(users.filter((path) => path.startsWith('benchmark/')).length).toBeGreaterThan(0);
  });

  it('BrainTelemetry.ts defines it and does not call it', () => {
    const own = lawStrip(readFileSync(join(SRC_ROOT, 'engine/BrainTelemetry.ts'), 'utf8'));
    const codeUses = own.match(/\boutsideSecondLookCapture\b/g) ?? [];
    const definitions = own.match(/\bexport function outsideSecondLookCapture\b/g) ?? [];
    expect(definitions).toHaveLength(1);
    expect(codeUses).toHaveLength(1);
  });
});
