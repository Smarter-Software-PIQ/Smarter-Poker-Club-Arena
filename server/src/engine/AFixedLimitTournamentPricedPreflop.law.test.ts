/**
 * LAW: THE FIXED-LIMIT TOURNAMENT PRICED PREFLOP (Fixed-Limit lane Phase 4,
 * 2026-11-16; HorseDecideOpts.fixedLimitPricedPreflopTournament, read
 * `=== true`, DEFAULT OFF; HorseFixedLimitPreflop.ts).
 *
 * Measured before (lane evidence AB-EVALUATION-2.md 3.6 and
 * P4-TOURNAMENT-PRICED-PREFLOP.md): the CASH priced first in, applied at a
 * six-seat fixed-limit hold'em tournament table against a maniac field,
 * replaced the tournament persona's wider first-in range with the cash chart
 * and folded under-the-gun hands the persona opened. The tournament version
 * never tightens the persona at chip value: it widens a persona fold to a
 * raise inside the reference share divided by the bubble factor, tightens an
 * open only under payout pressure (bubble factor above 1.15), defends a blind
 * to price x bubble factor, and stands aside at 10 big blinds or less, at an
 * All-In-Or-Fold table, for a locked satellite seat and when the tournament
 * context gives no bubble factor.
 *
 * On real HandController fixed-limit tables decided by the real
 * HorseLogic.decide (live Hybrid tournament persona, seeded deals):
 *  (a) option off (absent or false): every decision equals main and no
 *      tournament receipt fires;
 *  (b) cash tables: the option is inert (no context is built);
 *  (c) no-limit and pot-limit tournament tables: decisions identical;
 *  (d) bubble factor 1 (a winner-take-all context), deep stacks: the option
 *      never folds a first-in hand the persona raised, and raises persona
 *      folds inside the reference share;
 *  (e) monotone in the bubble factor: a larger bubble factor never widens the
 *      first-in range or the blind defence (the pure verdict);
 *  (f) every stand-aside keeps the persona's answer and leaves its receipt;
 *  (g) the option is registered, release default OFF.
 */
import { describe, expect, it } from 'vitest';

import { deal, decide, lcg, menuOf, type Table } from './HuVariantSpot.test-support.js';
import {
  FIXED_LIMIT_TOURNAMENT_STAND_ASIDE_BB,
  FIXED_LIMIT_TOURNAMENT_TIGHTEN_BF,
  fixedLimitOpenShare,
  fixedLimitStrengthAtTopShare,
  fixedLimitTournamentFirstInBar,
  fixedLimitTournamentPricedPreflopIntent,
  type FixedLimitPreflopVariant,
  type FixedLimitTournamentPricedCtx,
} from './HorseFixedLimitPreflop.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';
import type { HorseDecision } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';

const ON = { fixedLimitPricedPreflopTournament: true } as const;
const VARIANTS: FixedLimitPreflopVariant[] = ['flh', 'flo8'];
const DEALS = 60;
const T_FIRES = /^fixed_limit_tournament_priced_/;

function foldTo(t: Table, seat: number): void {
  for (let k = 0; k < 12; k++) {
    const cur = t.controller.getCurrentPlayer()!;
    if (cur.seat === seat) return;
    t.controller.performAction(cur.seat, 'fold', undefined, 'player');
  }
  throw new Error(`seat ${seat} never reached`);
}

function fmtTable(
  variant: string,
  fmt: 'cash' | 'tournament',
  n: number,
  seed: number,
  stack = 200
): Table {
  return deal({ variant, fmt, stacks: Array(n).fill(stack), rnd: lcg(seed) });
}

/** First in UTG to small blind of six, the heads-up button, the big blind facing one raise. */
function spots(variant: string, fmt: 'cash' | 'tournament', i: number, stack = 200) {
  const out: { label: string; t: Table }[] = [];
  for (const seat of [4, 5, 6, 1, 2]) {
    const t = fmtTable(variant, fmt, 6, 23000 + i * 7 + seat, stack);
    foldTo(t, seat);
    out.push({ label: `first in seat ${seat} of 6`, t });
  }
  const hu = fmtTable(variant, fmt, 2, 24000 + i, stack);
  foldTo(hu, 1);
  out.push({ label: 'heads-up button first in', t: hu });
  for (const n of [6, 2]) {
    const t = fmtTable(variant, fmt, n, 25000 + i * 3 + n, stack);
    foldTo(t, 1);
    t.controller.performAction(1, 'raise', menuOf(t).minRaiseTo ?? undefined, 'player');
    if (n > 2) t.controller.performAction(2, 'fold', undefined, 'player');
    out.push({ label: n > 2 ? 'big blind vs the button' : 'heads-up big blind', t });
  }
  return out;
}

const pick = (d: HorseDecision) => ({ action: d.action, amount: d.amount ?? null });
const wagers = (d: HorseDecision) => d.action === 'raise' || d.action === 'bet';

describe('(a)(b)(c) off is main, cash is inert, no-limit and pot-limit are identical', () => {
  for (const variant of VARIANTS) {
    it(`${variant} tournament, option off or false: main's answer, no tournament receipt`, () => {
      enableBrainTelemetry();
      for (let i = 0; i < 20; i++) {
        for (const { label, t } of spots(variant, 'tournament', i)) {
          const seed = 26000 + i;
          const absent = decide(t, seed, { telemetry: true }).d;
          const firedAbsent = drainFires().filter((f) => T_FIRES.test(f.feature));
          const off = decide(t, seed, {
            fixedLimitPricedPreflopTournament: false,
            telemetry: true,
          }).d;
          const firedOff = drainFires().filter((f) => T_FIRES.test(f.feature));
          expect(pick(off), `${variant} ${label} deal ${i}`).toEqual(pick(absent));
          expect(firedAbsent.concat(firedOff)).toEqual([]);
        }
      }
    }, 240_000);

    it(`${variant} cash: the option is inert on every spot (no context, no receipt)`, () => {
      enableBrainTelemetry();
      for (let i = 0; i < DEALS; i++) {
        for (const { label, t } of spots(variant, 'cash', i)) {
          const seed = 27000 + i;
          const off = decide(t, seed, { telemetry: true }).d;
          drainFires();
          const on = decide(t, seed, { ...ON, telemetry: true }).d;
          const fired = drainFires().filter((f) => T_FIRES.test(f.feature));
          expect(pick(on), `${variant} ${label} deal ${i}`).toEqual(pick(off));
          expect(
            fired.map((f) => f.feature),
            `${variant} ${label} deal ${i}`
          ).toEqual([]);
        }
      }
    }, 240_000);
  }

  for (const variant of ['nlh', 'plo4']) {
    it(`${variant} tournament: every decision with the option on equals off`, () => {
      for (let i = 0; i < 30; i++) {
        for (const { label, t } of spots(variant, 'tournament', i)) {
          const seed = 28000 + i;
          expect(pick(decide(t, seed, ON).d), `${variant} ${label} deal ${i}`).toEqual(
            pick(decide(t, seed).d)
          );
        }
      }
    }, 240_000);
  }
});

describe('(d) bubble factor 1, deep stacks: never folds a persona open, raises persona folds inside the share', () => {
  for (const variant of VARIANTS) {
    it(`${variant}: winner-take-all tournament context, 100 big blinds`, () => {
      enableBrainTelemetry();
      let widened = 0;
      let firstInFires = 0;
      for (let i = 0; i < DEALS; i++) {
        for (const { label, t } of spots(variant, 'tournament', i)) {
          if (label.includes('big blind')) continue;
          const seed = 29000 + i;
          const off = decide(t, seed, { telemetry: true }).d;
          drainFires();
          const on = decide(t, seed, { ...ON, telemetry: true }).d;
          const fired = drainFires().map((f) => f.feature);
          if (fired.includes('fixed_limit_tournament_priced_first_in')) firstInFires++;
          if (wagers(off)) expect(wagers(on), `${variant} ${label} deal ${i}`).toBe(true);
          if (!wagers(off) && wagers(on)) widened++;
        }
      }
      expect(widened, `${variant} persona folds raised`).toBeGreaterThan(0);
      expect(firstInFires).toBeGreaterThan(0);
    }, 240_000);
  }
});

// The pure verdict, swept over strengths and bubble factors.
function ctx(
  variant: FixedLimitPreflopVariant,
  dealt: number,
  behind: number,
  bf: number | null,
  standAside: FixedLimitTournamentPricedCtx['standAside'] = null
): FixedLimitTournamentPricedCtx {
  return {
    variant,
    dealt,
    behind,
    openerBehind: 2,
    openerAllIn: false,
    bubbleFactor: bf,
    standAside,
  };
}
const firstInSpot = (c: FixedLimitTournamentPricedCtx, strength: number, stackBB = 60) => ({
  priced: c,
  strength,
  tightness: 1,
  stackBB,
  raises: 0,
  limpers: 0,
  callers: 0,
  toCall: 2,
  bigBlind: 2,
  currentBet: 2,
  blind: null,
  odds: 1,
});
const defenceSpot = (c: FixedLimitTournamentPricedCtx, strength: number) => ({
  priced: c,
  strength,
  tightness: 1,
  stackBB: 60,
  raises: 1,
  limpers: 0,
  callers: 0,
  toCall: 2,
  bigBlind: 2,
  currentBet: 4,
  blind: 'bb' as const,
  odds: 2 / 9,
});
const BFS = [1, 1.05, 1.1, 1.15, 1.2, 1.4, 1.7, 2.2, 3];
const STRENGTHS = Array.from({ length: 101 }, (_, k) => k / 100);

describe('(e) monotone in the bubble factor', () => {
  for (const variant of VARIANTS) {
    it(`${variant}: a larger bubble factor never widens the first-in raises or the blind defence`, () => {
      for (const [dealt, behind] of [
        [6, 5],
        [6, 2],
        [6, 1],
        [2, 1],
      ] as const) {
        let prevRaise: Set<number> | null = null;
        let prevCall: Set<number> | null = null;
        for (const bf of BFS) {
          const raise = new Set<number>();
          const call = new Set<number>();
          for (const s of STRENGTHS) {
            const r = fixedLimitTournamentPricedPreflopIntent(
              firstInSpot(ctx(variant, dealt, behind, bf), s),
              { a: 'fold' }
            );
            if (r?.intent?.a === 'raiseTo') raise.add(s);
            const d = fixedLimitTournamentPricedPreflopIntent(
              defenceSpot(ctx(variant, dealt, behind, bf), s),
              { a: 'fold' }
            );
            if (d?.intent?.a === 'call') call.add(s);
          }
          if (prevRaise)
            for (const s of raise)
              expect(prevRaise.has(s), `${variant} ${dealt}/${behind} bf ${bf} raise ${s}`).toBe(
                true
              );
          if (prevCall)
            for (const s of call)
              expect(prevCall.has(s), `${variant} ${dealt}/${behind} bf ${bf} call ${s}`).toBe(
                true
              );
          prevRaise = raise;
          prevCall = call;
        }
      }
    });

    it(`${variant}: a persona open folds only above bubble factor ${FIXED_LIMIT_TOURNAMENT_TIGHTEN_BF}, and only below the share at that factor`, () => {
      for (const bf of BFS) {
        for (const s of STRENGTHS) {
          const c = ctx(variant, 6, 5, bf);
          const r = fixedLimitTournamentPricedPreflopIntent(firstInSpot(c, s), { a: 'raiseTo' });
          const bar = fixedLimitTournamentFirstInBar(c, 1, 60, bf)!.raiseBar;
          if (bf <= FIXED_LIMIT_TOURNAMENT_TIGHTEN_BF) expect(r, `bf ${bf} s ${s}`).toBeNull();
          else if (s >= bar) expect(r, `bf ${bf} s ${s}`).toBeNull();
          else expect(r?.intent?.a, `bf ${bf} s ${s}`).toBe('fold');
        }
      }
    });

    it(`${variant}: at bubble factor 1 and 25 big blinds or more the first-in share is the reference share`, () => {
      const ref = fixedLimitOpenShare(variant, 6, 5)!.raise;
      const b = fixedLimitTournamentFirstInBar(ctx(variant, 6, 5, 1), 1, 40, 1)!;
      expect(b.share).toBeCloseTo(ref, 10);
      expect(b.raiseBar).toBeCloseTo(fixedLimitStrengthAtTopShare(variant, ref), 10);
      const short = fixedLimitTournamentFirstInBar(ctx(variant, 6, 5, 1), 1, 15, 1)!;
      expect(short.share).toBeLessThan(ref);
    });
  }
});

/** A tournament spot with the state edited (stand-aside fixtures). */
function standAsideCases(variant: string) {
  const cases: {
    name: string;
    receipt: string;
    build: (i: number) => Table;
    patch?: (gs: HorseGameStateV2) => void;
  }[] = [
    {
      // 20 chips at a big blind of 2: exactly 10 big blinds (written out, not
      // read from the constant, so a moved threshold fails here).
      name: '10 big blinds',
      receipt: 'fixed_limit_tournament_priced_stand_aside_short_stack',
      build: (i) => {
        const t = fmtTable(variant, 'tournament', 6, 31000 + i, 20);
        foldTo(t, 4);
        return t;
      },
    },
    {
      name: 'All-In-Or-Fold table',
      receipt: 'fixed_limit_tournament_priced_stand_aside_all_in_or_fold',
      build: (i) => {
        const t = fmtTable(variant, 'tournament', 6, 32000 + i);
        foldTo(t, 4);
        return t;
      },
      patch: (gs) => {
        (gs as { allInOrFold?: boolean }).allInOrFold = true;
      },
    },
    {
      name: 'locked satellite seat',
      receipt: 'fixed_limit_tournament_priced_stand_aside_satellite_locked',
      build: (i) => {
        const t = fmtTable(variant, 'tournament', 6, 33000 + i);
        foldTo(t, 4);
        return t;
      },
      patch: (gs) => {
        const t = gs.tournament as Record<string, unknown>;
        const hero = gs.players.find((p) => p.seat === gs.heroSeat)!;
        const stacks = gs.players.map((p) => (p.seat === gs.heroSeat ? hero.stack : 100));
        Object.assign(t, {
          satellite: true,
          satelliteSeats: 5,
          spotsPaid: 5,
          playersLeft: 6,
          payoutPct: [20, 20, 20, 20, 20],
          stacks,
          stackByUser: Object.fromEntries(gs.players.map((p, k) => [p.user_id, stacks[k]])),
        });
      },
    },
    {
      name: 'incomplete tournament context (no stack vector)',
      receipt: 'fixed_limit_tournament_priced_stand_aside_incomplete_context',
      build: (i) => {
        const t = fmtTable(variant, 'tournament', 6, 34000 + i);
        foldTo(t, 4);
        return t;
      },
      patch: (gs) => {
        Object.assign(gs.tournament as Record<string, unknown>, { stacks: [], stackByUser: {} });
      },
    },
  ];
  return cases;
}

describe('(f) every stand-aside keeps the persona answer and leaves its receipt', () => {
  for (const variant of VARIANTS) {
    for (const c of standAsideCases(variant)) {
      it(`${variant}: ${c.name}`, () => {
        enableBrainTelemetry();
        let fires = 0;
        for (let i = 0; i < 30; i++) {
          const t = c.build(i);
          const seed = 35000 + i;
          const off = decide(t, seed, { telemetry: true }, c.patch).d;
          drainFires();
          const on = decide(t, seed, { ...ON, telemetry: true }, c.patch).d;
          const fired = drainFires().map((f) => f.feature);
          expect(pick(on), `${variant} ${c.name} deal ${i}`).toEqual(pick(off));
          expect(
            fired.filter((f) => T_FIRES.test(f) && f !== c.receipt),
            `${variant} ${c.name} deal ${i}`
          ).toEqual([]);
          if (fired.includes(c.receipt)) fires++;
        }
        // A hand the V46 class gate folds (Omaha: three of a rank, a double-paired
        // low rainbow hand) never reaches a fixed-limit layer: no receipt there.
        expect(fires, `${variant} ${c.name}: ${c.receipt}`).toBeGreaterThanOrEqual(27);
      }, 240_000);
    }
  }
});

describe('(g) registered, release default OFF; the stated thresholds', () => {
  it('the stand-aside stack is 10 big blinds and the tightening bubble factor 1.15', () => {
    expect(FIXED_LIMIT_TOURNAMENT_STAND_ASIDE_BB).toBe(10);
    expect(FIXED_LIMIT_TOURNAMENT_TIGHTEN_BF).toBe(1.15);
  });
  it('fixedLimitPricedPreflopTournament is in the release-default-OFF list', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('fixedLimitPricedPreflopTournament');
  });
});
