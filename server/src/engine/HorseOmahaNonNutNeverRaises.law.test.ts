/**
 * LAW (PLO-OWNER lead-5 2026-11-22; owner 2026-11-15 12:52 / 12:53: on the turn and river facing a bet a non-nut
 * hand folds or at best calls, never a raise; owner 2026-11-15 12:30: raising draws never happens out of position,
 * only in position with combo draws).
 *
 * Two options, both default OFF (read `=== true`), PLO4/PLO5 cash only:
 *
 *  omahaPricedRaiseNeverMakesNonNutRaise  the priced turn and river raise rule returns a raise only for a hand that
 *      is nut class now or the in-position turn combo draw raising; every other raise becomes its priced call or
 *      fold and a call is never turned into a raise; the nut rule reads the Lightning pools too.
 *  omahaLateFlattenedCallIsPriced  a river raise call_large_river_boat_wager flattened to a call after the
 *      facing-bet EV stage stood aside for the raise is priced by that verdict (fold where the call does not stand).
 *
 * The states: 2,400 generated PLO4/PLO5 cash turn and river decisions facing a wager (1,400 at a table, 1,000 in
 * Lightning pools), every one met while playing league hands with the production switch set of 2026-11-22
 * (HorseOmahaNonNutNeverRaises.states.ndjson.gz), and three real hands (HorseOmahaNonNutNeverRaises.fixture.json):
 * b910fc9e (a call the draw bar made was turned back into a turn all-in), 89b5b740 (a Lightning turn raise no raise
 * rule looked at) and b1e6ae31 (a river raise flattened to a call nobody priced, against a verdict of fold).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import {
  HorseLogic,
  omahaDecisionMemosHeld,
  omahaTurnRiverRaiseNeedsNutsRule,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import { HORSE_DATA_LEDGER, ledgerReceiptFor } from './HorseDataLedger.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import { OMAHA_OPTION_GAME_SCOPE_OPTIONS } from './HorseOmahaOptionGameScope.js';
import { OMAHA_OPTION_BASIS } from './HorseOmahaRuleBasis.js';
import { OMAHA_OPTION_CLASSES } from './HorseOmahaRuleSites.js';
import {
  omahaDecisionRaises,
  omahaRaiseNeedsNutsAdmitsCall,
  omahaRaiseNeedsNutsKeeps,
  omahaRaiseNeedsNutsScope,
} from './HorseOmahaTurnRiverRaiseNeedsNuts.js';
import { OPTION_SHADOW_STAGE } from './HorseOptionShadowStage.js';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
} from './HorseOptionSwitch.js';
import {
  horseDecisionReceiptRefusal,
  omahaNonNutRaiseInLightningGate,
} from './horseDecision/responseValidation.js';

const FIX1 = 'omahaPricedRaiseNeverMakesNonNutRaise';
const FIX2 = 'omahaLateFlattenedCallIsPriced';
const NOW = 1795400000000;

interface State {
  k: string;
  player: SeatPlayer;
  gs: HorseGameStateV2;
  style: string;
  mods: Record<string, unknown>;
}
interface RealHand {
  recorded: { action: string; amount: number };
  player: SeatPlayer;
  gs: HorseGameStateV2;
}
const fixture = JSON.parse(
  readFileSync(new URL('./HorseOmahaNonNutNeverRaises.fixture.json', import.meta.url), 'utf8')
) as { productionOpts: HorseDecideOpts; realHands: Record<string, RealHand> };
const PROD = fixture.productionOpts;
const STATE_LINES = gunzipSync(
  readFileSync(new URL('./HorseOmahaNonNutNeverRaises.states.ndjson.gz', import.meta.url))
)
  .toString('utf8')
  .split('\n')
  .filter(Boolean);
const stateAtLine = (i: number): State => JSON.parse(STATE_LINES[i]!) as State;
const isLightning = (gs: HorseGameStateV2): boolean =>
  (gs as { publicMemoryDomain?: { speed?: string } }).publicMemoryDomain?.speed === 'lightning';

/** Every random stream a decision reads starts from the same seed, so two runs differ only by their options. */
const seedAll = (seed: number): void => {
  HorseMind.reset();
  seedFastRandom(seed);
  seedHorseBetSizeRandom(seed ^ 0x5bd1e995);
  seedHorseTimingRandom(seed ^ 0x9e3779b9);
};
const run = (s: State, extra: HorseDecideOpts): HorseDecision => {
  seedAll(1);
  // performance.now() is frozen: the decision's wall-clock budgets cannot differ between two compared runs
  return withFrozenDecisionClock(() =>
    HorseLogic.decide(
      s.player,
      s.gs,
      s.style as never,
      s.mods as never,
      {
        ...PROD,
        ...extra,
        telemetry: false,
        observeMind: false,
        decisionTimeMs: NOW,
      } as HorseDecideOpts
    )
  );
};
/** The decision is a raise by a hand the one existing classifier does not let raise (Lightning read too). */
const nonNutRaise = (s: State, d: HorseDecision): boolean => {
  const scope = omahaRaiseNeedsNutsScope(s.player, s.gs, true);
  if (!scope) return false;
  return (
    omahaDecisionRaises(d, s.player, scope) &&
    omahaRaiseNeedsNutsKeeps(s.player, s.gs, scope) === null
  );
};
const act = (d: HorseDecision) => ({ action: d.action, amount: d.amount ?? null });
/** The whole decision, every receipt and graph transition included, without the measured wall-clock fields (…Ms). */
const whole = (d: HorseDecision): string =>
  JSON.stringify(d, (key, value) => (/Ms$/.test(key) ? undefined : value));

describe('the two options are registered dark', () => {
  it('release default OFF, switchable both ways, scopable per game, classed, on the ledger, staged for shadow', () => {
    for (const o of [FIX1, FIX2]) {
      expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(o);
      expect(OPTION_SWITCH_OFF_ONLY_NAMES).not.toContain(o);
      expect(OMAHA_OPTION_GAME_SCOPE_OPTIONS).toContain(o);
      expect(OMAHA_OPTION_CLASSES[o]?.cls).toBe('priced');
      expect(OMAHA_OPTION_BASIS[o]).toBeDefined();
      expect(HORSE_DATA_LEDGER.some((e) => e.kind === 'flag' && e.key === o)).toBe(true);
      expect(OPTION_SHADOW_STAGE[o]?.games).toEqual([4, 5]);
      expect((PROD as Record<string, unknown>)[o]).toBeUndefined();
    }
    expect(OPTION_SHADOW_STAGE[FIX1]?.streets).toEqual(['turn', 'river']);
    expect(OPTION_SHADOW_STAGE[FIX2]?.streets).toEqual(['river']);
    for (const r of [
      'omaha_priced_raise_non_nut_raise_not_made',
      'omaha_priced_raise_non_nut_unpriced_called',
      'omaha_late_flattened_call_priced_kept',
      'omaha_late_flattened_call_priced_folded',
    ])
      expect(ledgerReceiptFor(r)?.kind, r).toBe('receipt');
  });
});

describe('LAW: with omahaPricedRaiseNeverMakesNonNutRaise on, no non-nut hand raises a turn or river bet', () => {
  it('the states are 2,400 PLO4/PLO5 cash turn and river decisions facing a wager, 1,000 of them in Lightning', () => {
    expect(STATE_LINES.length).toBe(2400);
    let lightning = 0;
    const games = new Set<string>();
    for (let i = 0; i < STATE_LINES.length; i++) {
      const s = stateAtLine(i);
      expect(['turn', 'river']).toContain(s.gs.stage);
      expect(s.gs.toCall).toBeGreaterThan(0);
      expect((s.gs as { gameMode?: string }).gameMode).toBe('cash');
      expect(omahaRaiseNeedsNutsScope(s.player, s.gs, true), s.k).not.toBeNull();
      games.add(String(s.gs.gameVariant));
      if (isLightning(s.gs)) lightning++;
    }
    expect([...games].sort()).toEqual(['plo4', 'plo5']);
    expect(lightning).toBe(1000);
  });

  it('whole decisions: 0 non-nut raises with the option on (the same states raise without it), and only a raise is changed, into a call or a fold', () => {
    let offNonNut = 0;
    let offNonNutLightning = 0;
    let onNonNut = 0;
    let changed = 0;
    const directions: Record<string, number> = {};
    for (let i = 0; i < STATE_LINES.length; i++) {
      const off = run(stateAtLine(i), {});
      const s = stateAtLine(i);
      const on = run(s, { [FIX1]: true });
      const offRaised = nonNutRaise(s, off);
      if (offRaised) {
        offNonNut++;
        if (isLightning(s.gs)) offNonNutLightning++;
      }
      if (nonNutRaise(s, on)) onNonNut++;
      if (JSON.stringify(act(off)) === JSON.stringify(act(on))) continue;
      changed++;
      // only a non-nut raise is ever changed, and only into a call (the all-in call included) or a fold
      expect(offRaised, s.k).toBe(true);
      const scope = omahaRaiseNeedsNutsScope(s.player, s.gs, true)!;
      expect(omahaDecisionRaises(on, s.player, scope), s.k).toBe(false);
      expect(['call', 'fold', 'all_in'], s.k).toContain(on.action);
      const dir = on.action === 'fold' ? 'raise->fold' : 'raise->call';
      directions[dir] = (directions[dir] ?? 0) + 1;
    }
    expect(onNonNut).toBe(0);
    // the hole this closes is in these states, at a table and in Lightning
    expect(offNonNut).toBeGreaterThan(20);
    expect(offNonNutLightning).toBeGreaterThan(5);
    expect(offNonNut - offNonNutLightning).toBeGreaterThan(5);
    expect(changed).toBe(offNonNut);
    expect(directions['raise->call'] ?? 0).toBeGreaterThan(0);
  }, 600_000);

  it('the outermost raise rule: a call it is handed never comes back a raise, and a non-nut raise it is handed comes back a call or a fold', () => {
    const rule = (s: State, d: HorseDecision, extra: HorseDecideOpts): HorseDecision => {
      seedAll(1);
      return withFrozenDecisionClock(() =>
        omahaTurnRiverRaiseNeedsNutsRule(d, s.player, s.gs, {
          ...PROD,
          ...extra,
          telemetry: false,
          observeMind: false,
          decisionTimeMs: NOW,
        } as HorseDecideOpts)
      );
    };
    let callBecameRaiseOff = 0;
    let callBecameRaiseOn = 0;
    let nonNutRaiseKeptOn = 0;
    let nonNutRaisesHanded = 0;
    for (let i = 0; i < STATE_LINES.length; i++) {
      const s = stateAtLine(i);
      const scope = omahaRaiseNeedsNutsScope(s.player, s.gs, true)!;
      if (scope.allIn) continue; // a call for the whole stack: there is no raise to make
      const call: HorseDecision = { action: 'call', amount: scope.paid, thinkTime: 0 };
      if (omahaDecisionRaises(rule(s, call, {}), s.player, scope)) callBecameRaiseOff++;
      const calledOn = rule(stateAtLine(i), call, { [FIX1]: true });
      if (omahaDecisionRaises(calledOn, s.player, scope)) callBecameRaiseOn++;
      if (omahaRaiseNeedsNutsKeeps(s.player, s.gs, scope) !== null) continue;
      for (const raise of [
        { action: 'all_in', thinkTime: 0 } as HorseDecision,
        ...(typeof s.gs.minRaiseTo === 'number' && s.gs.legalActions?.includes('raise')
          ? [{ action: 'raise', amount: s.gs.minRaiseTo, thinkTime: 0 } as HorseDecision]
          : []),
      ]) {
        nonNutRaisesHanded++;
        const out = rule(stateAtLine(i), raise, { [FIX1]: true });
        if (omahaDecisionRaises(out, s.player, scope)) nonNutRaiseKeptOn++;
        else expect(['call', 'fold'], s.k).toContain(out.action);
      }
    }
    expect(callBecameRaiseOn).toBe(0);
    expect(nonNutRaiseKeptOn).toBe(0);
    expect(nonNutRaisesHanded).toBeGreaterThan(2000);
    // without the option the rule does turn calls into raises in these states (hand b910fc9e's bug)
    expect(callBecameRaiseOff).toBeGreaterThan(0);
  }, 600_000);

  it('outside PLO4/PLO5 cash high on one board the option changes nothing: tournament, hi-lo, bomb pot, two boards', () => {
    const mutations: Array<(gs: HorseGameStateV2) => void> = [
      (gs) => {
        (gs as { gameMode?: string }).gameMode = 'tournament';
      },
      (gs) => {
        gs.variantRules = { ...(gs.variantRules as object), splitLow8OrBetter: true } as never;
      },
      (gs) => {
        gs.bombPot = true;
      },
      (gs) => {
        gs.boardCount = 2;
        gs.communityCards2 = [...(gs.communityCards ?? [])].reverse();
      },
    ];
    let compared = 0;
    for (let i = 0; i < STATE_LINES.length; i += 12) {
      const m = mutations[(i / 12) % mutations.length]!;
      const a = stateAtLine(i);
      const b = stateAtLine(i);
      m(a.gs);
      m(b.gs);
      const off = run(a, {});
      const on = run(b, { [FIX1]: true, [FIX2]: true });
      expect(whole(on), a.k).toBe(whole(off));
      compared++;
    }
    expect(compared).toBe(200);
  }, 600_000);

  it('both options false are the options unset (default-off inertness inside this build)', () => {
    for (let i = 0; i < STATE_LINES.length; i += 8) {
      const unset = run(stateAtLine(i), {});
      const off = run(stateAtLine(i), { [FIX1]: false, [FIX2]: false });
      expect(whole(off), String(i)).toBe(whole(unset));
    }
  }, 600_000);
});

describe('the three real hands (rebuilt with HorseComplaintReplay.stateAt from the recorded public snapshot)', () => {
  const hy = HORSE_HYBRID_PROFILES.cash;
  const SEEDS = [1, 7, 42, 99, 2026];
  const replay = (id: string, extra: HorseDecideOpts, seed: number, telemetry = false) => {
    const h = structuredClone(fixture.realHands[id]!);
    seedAll(seed);
    if (telemetry) {
      enableBrainTelemetry();
      drainFires();
    }
    const d = withFrozenDecisionClock(() =>
      HorseLogic.decide(h.player, h.gs, hy.style, { ...hy.mods }, {
        ...PROD,
        ...extra,
        telemetry,
        observeMind: false,
        decisionTimeMs: NOW,
      } as HorseDecideOpts)
    );
    const fires = telemetry ? drainFires().map((f) => f.feature) : [];
    return { d, h, fires };
  };

  it('b910fc9e (PLO5 table, out of position, aces and the nut flush draw facing a turn bet of 185): the all-in becomes the call', () => {
    for (const seed of SEEDS) {
      const was = replay('b910fc9e', {}, seed);
      expect(was.h.gs.stage).toBe('turn');
      expect(act(was.d), `seed ${seed}`).toEqual({ action: 'all_in', amount: null });
      expect(nonNutRaise({ ...was.h, k: '', style: '', mods: {} }, was.d)).toBe(true);
      const now = replay('b910fc9e', { [FIX1]: true }, seed);
      expect(act(now.d), `seed ${seed}`).toEqual({ action: 'call', amount: 185 });
    }
    const t = replay('b910fc9e', { [FIX1]: true }, 1, true);
    expect(t.fires).toContain('omaha_priced_raise_non_nut_raise_not_made');
    expect(t.fires).not.toContain('omaha_priced_raise_made_bluff');
    expect(replay('b910fc9e', {}, 1, true).fires).toContain('omaha_priced_raise_made_bluff');
  });

  it('89b5b740 (PLO5 Lightning, top two pair and the nut flush draw facing a turn bet of 60): the raise becomes the call, and the receipt validator admits it only for a decision that may have run with the option', () => {
    for (const seed of SEEDS) {
      const was = replay('89b5b740', {}, seed);
      expect(isLightning(was.h.gs)).toBe(true);
      expect(act(was.d), `seed ${seed}`).toEqual({ action: 'raise', amount: 120 });
      const now = replay('89b5b740', { [FIX1]: true }, seed);
      expect(act(now.d), `seed ${seed}`).toEqual({ action: 'call', amount: 60 });
    }
    const { d, h } = replay('89b5b740', { [FIX1]: true }, 1);
    expect(omahaRaiseNeedsNutsAdmitsCall(h.player, h.gs, 60)).toBe(false);
    expect(omahaRaiseNeedsNutsAdmitsCall(h.player, h.gs, 60, true)).toBe(true);
    const ctx = { player: h.player, gameState: h.gs, omahaPricedRaise: true };
    expect(horseDecisionReceiptRefusal(structuredClone(d), 'plo5', ctx)).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        ...ctx,
        omahaNonNutRaiseInLightning: true,
      })
    ).toBeNull();
    expect(omahaNonNutRaiseInLightningGate(undefined, null)).toBe(false);
    expect(omahaNonNutRaiseInLightningGate({ [FIX1]: true }, null)).toBe(true);
    expect(omahaNonNutRaiseInLightningGate({ [FIX1]: 'yes' }, null)).toBe(false);
  });

  it('b1e6ae31 (PLO5 table, fours full of twos facing a pot river bet of 91): the late-flattened call is priced and folds; nothing else in the hand set moves', () => {
    for (const seed of SEEDS) {
      const was = replay('b1e6ae31', {}, seed);
      expect(was.h.gs.stage).toBe('river');
      expect(act(was.d), `seed ${seed}`).toEqual({ action: 'call', amount: 91 });
      expect(act(replay('b1e6ae31', { [FIX2]: true }, seed).d), `seed ${seed}`).toEqual({
        action: 'fold',
        amount: null,
      });
      // fix 1 alone does not touch it, and fix 2 alone does not touch the two raise hands
      expect(act(replay('b1e6ae31', { [FIX1]: true }, seed).d)).toEqual({
        action: 'call',
        amount: 91,
      });
      expect(act(replay('b910fc9e', { [FIX2]: true }, seed).d).action).toBe('all_in');
      expect(act(replay('89b5b740', { [FIX2]: true }, seed).d)).toEqual({
        action: 'raise',
        amount: 120,
      });
    }
    const t = replay('b1e6ae31', { [FIX2]: true }, 1, true);
    expect(t.fires).toContain('omaha_late_flattened_call_priced_folded');
    expect(replay('b1e6ae31', {}, 1, true).fires).not.toContain(
      'omaha_late_flattened_call_priced_folded'
    );
    // the equivalent path of the priced raise rule: with the facing-bet verdict off, its own priced call decides
    const viaRaiseRule = replay('b1e6ae31', { [FIX2]: true, omahaFacingBetEv: false }, 1, true);
    expect(act(viaRaiseRule.d)).toEqual({ action: 'fold', amount: null });
    expect(viaRaiseRule.fires).toContain('omaha_late_flattened_call_priced_folded');
    expect(act(replay('b1e6ae31', { omahaFacingBetEv: false }, 1).d)).toEqual({
      action: 'call',
      amount: 91,
    });
    expect(omahaDecisionMemosHeld()).toEqual([]);
  });
});
