/**
 * A DEEP SECOND LOOK COUNTS ITS RECEIPTS AND IS NOT THE LIVE DECISION (2026-11-16, PLO6 lane).
 *
 * The second look decides with telemetry on inside withSecondLookFireCapture so that its receipts are counted
 * (second_look_<key>_seen). In HorseLogic "telemetry on" also stood for "this is the live decision" at a few
 * places: the process-wide Phase 8 safety sentinel (read, fed and obeyed), and the evidence-mode clocks and
 * budgets. A second look must behave there exactly as it did when it ran with telemetry off.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  seedFastRandom(seed);
  const s = spot();
  return HorseLogic.decide(s.hero, s.gs, 'balanced', {}, { mind: false, ...opts } as never);
}

/** The whole decision without its wall-clock fields (latency and elapsed milliseconds). */
function timeless(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(timeless);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/latency|elapsed/i.test(k) || /Ms$/.test(k)) continue;
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
 * SOURCE LAW. In HorseLogic.ts a block gated on telemetry may only COUNT. A second look runs those blocks
 * (telemetry on inside a capture), so anything else there would make a second look differ from what it was.
 * The law reads every `if` whose condition names telemetryOn(opts), tele or tele15 and refuses a call in its
 * body that is not a counting call (note...) unless the call is listed below with its reason. It also refuses
 * the two shapes that broke this once: `!tele` (a clock or budget chosen by telemetry: use teleLive) and a
 * read of the Phase 8 sentinel that is not behind the live test.
 */
describe('source law: a telemetry-gated block in HorseLogic.ts only counts', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./HorseLogic.ts', import.meta.url)), 'utf8');
  /** A call allowed inside a telemetry-gated block, with why it cannot change a decision. */
  const ALLOWED: Record<string, string> = {
    isTournamentMode: 'pure read of the game state, chooses a receipt name',
    omahaIsWager: 'pure predicate on a decision',
    omahaSameWager: 'pure predicate on two decisions',
    omahaPlanLineUncommitted: 'pure predicate on a plan line',
    wagerBindingPassedShortAllIn: 'pure predicate, chooses a receipt name',
    holdemDrawPresent: 'pure predicate on cards',
    omahaProposeReceipt:
      'queues a receipt (made / vetoed) settled against the final decision; counting only',
    changed: 'a local closure that only calls noteFire',
    decidePreflopV7:
      'a rewound counterfactual for a receipt: the RNG is restored; telemetry is suspended or its fires go to the capture',
    icmOff53: 'the v53 counterfactual closure (decidePreflopV7 rewound)',
    saveFastRandom: 'saves the RNG position the counterfactual restores',
    restoreFastRandom: 'restores the RNG position after the counterfactual',
    withHorseDeepDiveCapture: 'detaches the deep-dive collector for the counterfactual',
    withBrainTelemetrySuspended: 'pauses counters for the counterfactual',
    inSecondLookCapture: 'the live test itself',
  };
  const BUILTIN = /^(if|for|while|switch|return|String|Number|Boolean|Math|Array|Object|Set|Map)$/;
  const GATE = /telemetryOn\(\s*opts\s*\)|\btele(15)?\b/;

  function strip(body: string): string {
    return body
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/`(?:[^`\\]|\\.)*`/g, 'S')
      .replace(/'(?:[^'\\]|\\.)*'/g, 'S');
  }
  function gatedBlocks(): Array<{ line: number; cond: string; body: string }> {
    const out: Array<{ line: number; cond: string; body: string }> = [];
    const re = /\bif\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(SRC))) {
      const lineStart = SRC.lastIndexOf('\n', m.index) + 1;
      const head = SRC.slice(lineStart, m.index).trim();
      if (head.startsWith('//') || head.startsWith('*')) continue;
      let j = m.index + m[0].length;
      for (let depth = 1; depth > 0 && j < SRC.length; j++) {
        if (SRC[j] === '(') depth++;
        else if (SRC[j] === ')') depth--;
      }
      const cond = SRC.slice(m.index + m[0].length, j - 1);
      if (!GATE.test(cond)) continue;
      let k = j;
      while (/\s/.test(SRC[k])) k++;
      let end: number;
      if (SRC[k] === '{') {
        end = k + 1;
        for (let depth = 1; depth > 0 && end < SRC.length; end++) {
          if (SRC[end] === '{') depth++;
          else if (SRC[end] === '}') depth--;
        }
      } else end = SRC.indexOf(';', k) + 1;
      out.push({ line: SRC.slice(0, m.index).split('\n').length, cond, body: SRC.slice(k, end) });
    }
    return out;
  }

  it('finds the gated blocks (the reader works)', () => {
    expect(gatedBlocks().length).toBeGreaterThan(300);
  });

  it('every call in a telemetry-gated block is a counting call or listed with its reason', () => {
    const offenders: string[] = [];
    for (const block of gatedBlocks()) {
      const body = strip(block.body);
      for (const call of body.matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)) {
        const name = call[1];
        if (/^note[A-Z]/.test(name) || BUILTIN.test(name) || name in ALLOWED) continue;
        offenders.push(`HorseLogic.ts:${block.line} ${name}(`);
      }
      // a method call that feeds live state: only the sentinel is known, and only behind the live test
      for (const call of body.matchAll(/([A-Za-z_]\w*)\.observe\s*\(/g))
        if (!/if \(phase8Live\) liveHorsePhase8Safety\.observe\(/.test(body))
          offenders.push(`HorseLogic.ts:${block.line} ${call[1]}.observe(`);
    }
    expect(offenders).toEqual([]);
  });

  it('no clock or budget is chosen by `!tele`, and the Phase 8 sentinel is read behind the live test only', () => {
    expect(SRC.match(/!tele(15)?\b/g) ?? []).toEqual([]);
    const reads = SRC.split('\n')
      .map((text, i) => ({ text, line: i + 1 }))
      .filter((l) => /liveHorsePhase8Safety\./.test(l.text) && !/^\s*(\/\/|\*)/.test(l.text));
    expect(reads.length).toBe(3);
    const lines = SRC.split('\n');
    for (const read of reads) {
      const around = lines.slice(read.line - 5, read.line).join('\n');
      expect(around, `HorseLogic.ts:${read.line}`).toMatch(/phase8Live|inSecondLookCapture\(\)/);
    }
    expect(SRC).toContain('const teleLive = tele && !inSecondLookCapture();');
    expect(SRC).toContain('const phase8Live = teleLive;');
  });
});
