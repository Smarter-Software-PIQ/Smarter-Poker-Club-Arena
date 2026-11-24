/**
 * LAW (plo-lead6 2026-11-24, BUILD-II step 2; owner 2026-11-24 12:30 / 12:35 AM CST: no unconditioned random play in
 * Hold'em, the best play by math). holdemFlopIsPriced (default OFF): the priced chooser on the NLH flop, cash and
 * Lightning only, with the range-level plan (minimum defence, one size and balanced bluffs) and the computed
 * two-street realization.
 * States: HorseHoldemLateStreetIsPriced.flop.states.ndjson.gz, 460 generated NLH cash and Lightning flop states
 * (league self-play with the production rows of 2026-11-24, holdemValueAndCallsArePriced off): 260 heads-up facing a
 * wager, 140 heads-up checked to or first to act, 60 multiway. Only the deciding Horse's cards are in a state.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
} from './HorseOptionSwitch.js';
import {
  holdemIsComboDraw,
  holdemIsDraw,
  holdemLateHeroRange,
  holdemLateRealization,
  holdemLateSpot,
  holdemLateVerdict,
} from './HorseHoldemLateStreetIsPriced.js';
import { holdemOpponentLineRange } from './HorseHoldemTurnRiverRaiseNeedsValue.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';

const FLOP = 'holdemFlopIsPriced';
const LATE = 'holdemLateStreetIsPriced';
const NOW = 1795400000000;
interface State {
  k: string;
  set: 'flop_facing' | 'flop_open' | 'flop_multiway';
  player: SeatPlayer;
  gs: HorseGameStateV2;
  style: string;
  mods: Record<string, unknown>;
}
const fixture = JSON.parse(
  readFileSync(
    new URL('./HorseHoldemTurnRiverRaiseNeedsValue.fixture.json', import.meta.url),
    'utf8'
  )
) as { productionOpts: HorseDecideOpts };
const PROD = { ...fixture.productionOpts, holdemValueAndCallsArePriced: false } as HorseDecideOpts;
const LINES = gunzipSync(
  readFileSync(new URL('./HorseHoldemLateStreetIsPriced.flop.states.ndjson.gz', import.meta.url))
)
  .toString('utf8')
  .split('\n')
  .filter(Boolean);
const at = (i: number): State => JSON.parse(LINES[i]!) as State;
const ALL = LINES.map((_, i) => i);
const FACING = ALL.filter((i) => at(i).set === 'flop_facing');
const OPEN = ALL.filter((i) => at(i).set === 'flop_open');
const MULTI = ALL.filter((i) => at(i).set === 'flop_multiway');
const run = (s: State, extra: HorseDecideOpts, seed = 1, telemetry = false): HorseDecision => {
  HorseMind.reset();
  seedFastRandom(seed);
  seedHorseBetSizeRandom(seed ^ 0x5bd1e995);
  seedHorseTimingRandom(seed ^ 0x9e3779b9);
  return withFrozenDecisionClock(() =>
    HorseLogic.decide(
      s.player,
      s.gs,
      s.style as never,
      s.mods as never,
      {
        ...PROD,
        ...extra,
        telemetry,
        observeMind: false,
        decisionTimeMs: NOW,
      } as HorseDecideOpts
    )
  );
};
const act = (d: HorseDecision) => `${d.action}:${d.amount ?? ''}`;
const whole = (d: HorseDecision) =>
  JSON.stringify(d, (k, v) => (/Ms$|thinkTime/.test(k) ? undefined : v));
const verdictOf = (s: State, player: SeatPlayer = s.player) => {
  HorseMind.reset();
  const spot = holdemLateSpot(player, s.gs, false, true, false);
  if (!spot) return null;
  const v = holdemLateVerdict(player, s.gs, spot, true, (to) => to, {
    bluffRaise: false,
    decisionRaiseTo: null,
  });
  return v ? { spot, v } : null;
};
const c = (rank: string, suit: string) => ({ rank, suit }) as Card;

describe('the flop option is registered dark', () => {
  it('default OFF, switchable, on the ledger, with its receipts', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(FLOP);
    expect(OPTION_SWITCH_OFF_ONLY_NAMES).not.toContain(FLOP);
    expect(HORSE_DATA_LEDGER.some((e) => e.kind === 'flag' && e.key === FLOP)).toBe(true);
    for (const r of [
      'holdem_flop_priced_check',
      'holdem_flop_priced_bet_value',
      'holdem_flop_priced_bet_bluff',
      'holdem_flop_priced_call',
      'holdem_flop_priced_fold',
      'holdem_flop_priced_raise_value',
      'holdem_flop_priced_draw_raise',
      'holdem_flop_priced_mix_defend',
      'holdem_flop_priced_mix_bet',
      'holdem_late_priced_mix_defend',
      'holdem_late_priced_mix_bet',
    ])
      expect(
        HORSE_DATA_LEDGER.some((e) => e.kind === 'receipt' && e.key === r),
        r
      ).toBe(true);
    expect((PROD as Record<string, unknown>)[FLOP]).toBeUndefined();
  });
});

describe('LAW: minimum defence on the flop', () => {
  it("across the Horse's own range at a heads-up flop node facing a bet it folds at most the bettor's break-even + 0.05", () => {
    let nodes = 0;
    for (const i of FACING.filter((_, j) => j % 26 === 0)) {
      const s = at(i);
      const base = verdictOf(s);
      if (!base || base.spot.live.length !== 1) continue;
      // the Horse's own range at the node, as the range plan reads it
      HorseMind.reset();
      const range = holdemLateHeroRange(s.player, s.gs, true);
      if (!range) continue;
      const r = { range };
      const P = base.spot.pot;
      const bettorIn = Number(base.spot.bettor?.bet ?? 0) || base.spot.toCall;
      const alpha = Math.min(1, bettorIn / P);
      let w = 0;
      let folded = 0;
      const order = r.range.order.filter((k, j) => j % 5 === 0 && r.range.weight[k]! > 0);
      for (const k of order) {
        const hand = r.range.combos[k]!;
        const got = verdictOf(s, { ...s.player, cards: hand } as SeatPlayer);
        if (!got) continue;
        w += r.range.weight[k]!;
        if (got.v.best.kind === 'fold') folded += r.range.weight[k]!;
      }
      if (w <= 0) continue;
      expect(folded / w, s.k).toBeLessThanOrEqual(alpha + 0.05);
      nodes++;
    }
    expect(nodes).toBeGreaterThanOrEqual(5);
  }, 600_000);

  it('no fold where the call prices at or above zero (every heads-up and multiway facing state)', () => {
    let folds = 0;
    for (const i of [...FACING, ...MULTI]) {
      const got = verdictOf(at(i));
      if (!got || got.v.best.kind !== 'fold') continue;
      folds++;
      expect(got.v.options.find((o) => o.kind === 'call')!.ev, at(i).k).toBeLessThan(0);
    }
    expect(folds).toBeGreaterThan(10);
  }, 600_000);
});

describe('LAW: the flop chooser is the math; its only draw is model-requested and receipted', () => {
  it('same state and same seed give the same action; any seed of the random streams gives the same action', () => {
    let compared = 0;
    for (const i of ALL.filter((_, j) => j % 4 === 0)) {
      const a = run(at(i), { [FLOP]: true }, 1);
      expect(act(run(at(i), { [FLOP]: true }, 1)), at(i).k).toBe(act(a));
      expect(act(run(at(i), { [FLOP]: true }, 987654321)), at(i).k).toBe(act(a));
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  }, 600_000);

  it('every residual-frequency draw is one the range plan asked for, in (0, 1), and is receipted', () => {
    enableBrainTelemetry();
    let draws = 0;
    for (const i of [...FACING, ...OPEN]) {
      // the decision first: it primes the Horse's own preflop range (HorseHoldemOwnPreflopRange) that the plan reads
      drainFires();
      run(at(i), { [FLOP]: true }, 1, true);
      const fired = drainFires().map((f) => f.feature);
      const got = verdictOf(at(i));
      if (!got) continue;
      const plan = got.v.range;
      if (plan && plan.draw !== null) {
        draws++;
        expect(plan.frequency).toBeGreaterThan(0);
        expect(plan.frequency).toBeLessThan(1);
        expect(
          fired.some(
            (f) => f === 'holdem_flop_priced_mix_defend' || f === 'holdem_flop_priced_mix_bet'
          ),
          at(i).k
        ).toBe(true);
      } else
        expect(
          fired.filter((f) => f.startsWith('holdem_flop_priced_mix')),
          at(i).k
        ).toEqual([]);
    }
    expect(draws).toBeGreaterThanOrEqual(0);
  }, 600_000);

  it('identity-free: renaming every player and flipping who is a Horse changes no action', () => {
    let n = 0;
    for (const i of ALL.filter((_, j) => j % 5 === 0)) {
      const s = at(i);
      const rename = (u: string | undefined) =>
        u === undefined ? u : `anon-${u.split('').reverse().join('')}`;
      const t = JSON.parse(JSON.stringify(s)) as State;
      t.player.user_id = rename(t.player.user_id)!;
      t.player.username = 'X';
      for (const p of t.gs.players) {
        p.user_id = rename(p.user_id)!;
        p.username = 'X';
        (p as { is_horse?: boolean }).is_horse = !(p as { is_horse?: boolean }).is_horse;
      }
      for (const a of t.gs.actionHistory ?? [])
        if (a.userId !== undefined) a.userId = rename(a.userId)!;
      (t.gs as { humanUserIds?: string[] }).humanUserIds = [];
      const a = verdictOf(s);
      const b = verdictOf(t);
      expect(b?.v.best.kind, s.k).toBe(a?.v.best.kind);
      expect(b?.v.best.to, s.k).toBe(a?.v.best.to);
      n++;
    }
    expect(n).toBeGreaterThan(50);
  }, 600_000);
});

describe('LAW: draws, raises and the realization', () => {
  it('a draw is never raised out of position; in position only a combo draw raises without value', () => {
    let raises = 0;
    for (const i of FACING) {
      const s = at(i);
      const got = verdictOf(s);
      if (!got || got.v.best.kind !== 'raise') continue;
      raises++;
      const value = got.v.valueRaise.get(got.v.best.to) === true;
      if (value) continue;
      expect(got.spot.inPosition, s.k).toBe(true);
      expect(holdemIsComboDraw(s.player.cards, s.gs.communityCards ?? []), s.k).toBe(true);
    }
    expect(raises).toBeGreaterThan(0);
  }, 600_000);

  it('the realization is computed, not a constant: a nut flush draw is credited above its raw equity, a weak pair below', () => {
    const board = [c('K', 'hearts'), c('7', 'hearts'), c('2', 'clubs')];
    const s = at(FACING[0]!);
    const r = holdemOpponentLineRange(
      s.player,
      { ...s.gs, communityCards: board },
      s.gs.players.find((p) => p.seat !== s.player.seat && !p.is_folded)!,
      false,
      1
    );
    expect(r).not.toBeNull();
    const nfd = holdemLateRealization([c('A', 'hearts'), c('5', 'hearts')], board, r!.range, {
      betShare: 0.6,
      foldNext: 0.4,
      inPosition: true,
      seed: 1,
    });
    const weak = holdemLateRealization([c('3', 'diamonds'), c('3', 'spades')], board, r!.range, {
      betShare: 0.6,
      foldNext: 0.4,
      inPosition: false,
      seed: 1,
    });
    expect(holdemIsDraw([c('A', 'hearts'), c('5', 'hearts')], board)).toBe(true);
    expect(nfd.rho).toBeGreaterThan(weak.rho);
    expect(nfd.rho).not.toBe(0.88);
    expect(weak.rho).toBeLessThan(1);
  });
});

describe('inertness and the validator', () => {
  it('off equals unset; the turn/river option does not act on the flop; tournaments are untouched', () => {
    for (const i of ALL.filter((_, j) => j % 3 === 0)) {
      expect(whole(run(at(i), { [FLOP]: false }))).toBe(whole(run(at(i), {})));
      expect(whole(run(at(i), { [LATE]: true }))).toBe(whole(run(at(i), {})));
    }
    for (const i of ALL.filter((_, j) => j % 9 === 0)) {
      const s = at(i);
      const t = { ...s, gs: { ...s.gs, gameMode: 'tournament' } as HorseGameStateV2 };
      expect(holdemLateSpot(t.player, t.gs, true, true, true)).toBeNull();
    }
  }, 600_000);

  it("the flop chooser's passive answers are admitted under its gate", () => {
    let checked = 0;
    for (const i of ALL) {
      const s = at(i);
      const on = run(s, { [FLOP]: true });
      if (on.policyGraph === undefined || !['check', 'call', 'fold'].includes(on.action)) continue;
      const ctx = { player: s.player, gameState: s.gs, [LATE]: true };
      expect(horseDecisionReceiptRefusal(structuredClone(on), 'nlh', ctx), s.k).toBeNull();
      if (++checked >= 60) break;
    }
    expect(checked).toBeGreaterThan(30);
  }, 600_000);
});
