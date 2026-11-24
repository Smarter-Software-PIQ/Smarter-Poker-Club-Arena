/**
 * LAW (plo-lead6 Hold'em late-street audit 2026-11-24; owner 2026-11-15 12:52 / 12:53: on the turn and river facing a
 * bet a hand that is not a value hand folds or at best calls, never raises).
 *
 * holdemTurnRiverRaiseNeedsValue, default OFF (read `=== true`), No-Limit Hold'em cash, Lightning and tournaments:
 * the outermost answer of wager_rules. A turn or river raise facing a wager stands only for a VALUE HAND, the Horse's
 * equity against the continuing part of every live opponent's line range above 0.5
 * (HorseHoldemTurnRiverRaiseNeedsValue.holdemLateRaiseVerdict); any other raise becomes the priced call or fold.
 *
 * The states: 2,526 generated NLH turn and river decisions facing a wager with chips behind (cash 1,245, Lightning
 * 468, tournaments 813), every one met while playing league hands on bf6fb356036e with the production switch rows of
 * 2026-11-24 05:20Z (scale-16 capture of scripts/ops/horse-decision-crossbuild-replay.mjs), plus 657 control states
 * (preflop, flop and turn/river not facing a wager) (HorseHoldemTurnRiverRaiseNeedsValue.states.ndjson.gz). Three real
 * hands of b99bd306892c (HorseHoldemTurnRiverRaiseNeedsValue.fixture.json, rebuilt with HorseComplaintReplay.stateAt
 * from the recorded public snapshot; only the deciding Horse's own cards are kept): 3ba439af (NLH cash turn raise to
 * 101 with 4d5d), 4a4ff3bb (NLH cash turn raise to 104 with KhTh), 6a1150c2 (NLH cash river check-raise to 131 with
 * 3c4c, two pair below the top pair).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import { HORSE_DATA_LEDGER, ledgerReceiptFor } from './HorseDataLedger.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import { parseExtract, stateAt } from './HorseComplaintReplay.js';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
} from './HorseOptionSwitch.js';
import {
  HOLDEM_LATE_RAISE_VALUE_EQUITY,
  holdemLateRaiseScope,
  holdemLateRaiseTo,
  holdemLateRaiseVerdict,
  holdemTurnRiverRaiseNeedsValueRule,
} from './HorseHoldemTurnRiverRaiseNeedsValue.js';
import {
  holdemTurnRiverRaiseNeedsValueGate,
  horseDecisionReceiptRefusal,
} from './horseDecision/responseValidation.js';

const OPT = 'holdemTurnRiverRaiseNeedsValue';
const NOW = 1795400000000;

interface State {
  k: string;
  set: 'late' | 'control';
  group: string;
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
) as {
  productionOpts: HorseDecideOpts;
  realHands: Record<string, { node: number; hand: unknown }>;
};
const PROD = fixture.productionOpts;
const LINES = gunzipSync(
  readFileSync(new URL('./HorseHoldemTurnRiverRaiseNeedsValue.states.ndjson.gz', import.meta.url))
)
  .toString('utf8')
  .split('\n')
  .filter(Boolean);
const stateAtLine = (i: number): State => JSON.parse(LINES[i]!) as State;
const LATE = LINES.map((_, i) => i).filter((i) => stateAtLine(i).set === 'late');
const CONTROL = LINES.map((_, i) => i).filter((i) => stateAtLine(i).set === 'control');

const seedAll = (seed: number): void => {
  HorseMind.reset();
  seedFastRandom(seed);
  seedHorseBetSizeRandom(seed ^ 0x5bd1e995);
  seedHorseTimingRandom(seed ^ 0x9e3779b9);
};
const run = (s: State, extra: HorseDecideOpts, seed = 1): HorseDecision => {
  seedAll(seed);
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
/** The final decision raises a turn/river wager with a hand the verdict does not call a value hand. */
const nonValueRaise = (s: State, d: HorseDecision): boolean => {
  const scope = holdemLateRaiseScope(s.player, s.gs);
  if (!scope) return false;
  const to = holdemLateRaiseTo(d, scope);
  if (to === null) return false;
  HorseMind.reset();
  return holdemLateRaiseVerdict(s.player, s.gs, scope, to, true).kind !== 'value';
};
const act = (d: HorseDecision) => ({ action: d.action, amount: d.amount ?? null });
const whole = (d: HorseDecision): string =>
  JSON.stringify(d, (key, value) => (/Ms$/.test(key) ? undefined : value));

describe('the option is registered dark', () => {
  it('release default OFF, switchable, on the ledger with its receipts, absent from the production rows', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(OPT);
    expect(OPTION_SWITCH_OFF_ONLY_NAMES).not.toContain(OPT);
    expect(HORSE_DATA_LEDGER.some((e) => e.kind === 'flag' && e.key === OPT)).toBe(true);
    expect((PROD as Record<string, unknown>)[OPT]).toBeUndefined();
    for (const r of [
      'holdem_turn_river_raise_value_kept',
      'holdem_turn_river_raise_not_value_called',
      'holdem_turn_river_raise_not_value_folded',
      'holdem_turn_river_raise_not_value_unpriced_called',
      'holdem_turn_river_raise_rule_failed',
    ])
      expect(ledgerReceiptFor(r)?.kind, r).toBe('receipt');
    expect(HOLDEM_LATE_RAISE_VALUE_EQUITY).toBe(0.5);
  });
});

describe("LAW: with holdemTurnRiverRaiseNeedsValue on, no Hold'em turn or river raise is made by a hand that is not a value hand", () => {
  it('the late states are NLH turn and river decisions facing a wager with chips behind, cash, Lightning and tournaments', () => {
    expect(LATE.length).toBe(2526);
    const groups = new Set<string>();
    for (const i of LATE) {
      const s = stateAtLine(i);
      expect(s.gs.gameVariant).toBe('nlh');
      expect(holdemLateRaiseScope(s.player, s.gs), s.k).not.toBeNull();
      groups.add(s.group);
    }
    expect([...groups].sort()).toEqual(['lightning_nlh', 'nlh_cash', 'nlh_tourn']);
  });

  it('whole decisions: 0 non-value raises with the option on (the same states raise without it), and only a raise is changed, into a call or a fold', () => {
    let offNonValue = 0;
    let onNonValue = 0;
    let changed = 0;
    const dirs: Record<string, number> = {};
    for (const i of LATE) {
      const off = run(stateAtLine(i), {});
      const on = run(stateAtLine(i), { [OPT]: true });
      const s = stateAtLine(i);
      const offRaised = nonValueRaise(s, off);
      if (offRaised) offNonValue++;
      if (nonValueRaise(s, on)) onNonValue++;
      if (JSON.stringify(act(off)) === JSON.stringify(act(on))) continue;
      changed++;
      expect(offRaised, s.k).toBe(true);
      expect(['call', 'fold'], s.k).toContain(on.action);
      const d = `${off.action}->${on.action}`;
      dirs[d] = (dirs[d] ?? 0) + 1;
    }
    expect(onNonValue).toBe(0);
    expect(offNonValue).toBeGreaterThan(30);
    expect(changed).toBe(offNonValue);
    expect((dirs['raise->call'] ?? 0) + (dirs['all_in->call'] ?? 0)).toBeGreaterThan(0);
  }, 600_000);

  it('the rule never turns a call, a fold or a check into a raise, and keeps a value raise', () => {
    const legalize = (d: HorseDecision) => d;
    for (const i of LATE.filter((_, j) => j % 5 === 0)) {
      const s = stateAtLine(i);
      const scope = holdemLateRaiseScope(s.player, s.gs)!;
      for (const d of [
        { action: 'call', amount: scope.call, thinkTime: 0 },
        { action: 'fold', thinkTime: 0 },
      ] as HorseDecision[]) {
        HorseMind.reset();
        expect(
          holdemTurnRiverRaiseNeedsValueRule(d, s.player, s.gs, { [OPT]: true }, legalize)
        ).toBe(d);
      }
    }
  }, 600_000);

  it('outside its scope the option changes nothing: the control states (preflop, flop, not facing a wager) are whole-decision identical', () => {
    for (const i of CONTROL) {
      const off = run(stateAtLine(i), {});
      const on = run(stateAtLine(i), { [OPT]: true });
      expect(whole(on), stateAtLine(i).k).toBe(whole(off));
    }
  }, 600_000);

  it('the option false is the option unset (default-off inertness inside this build)', () => {
    for (const i of LATE.filter((_, j) => j % 4 === 0)) {
      expect(whole(run(stateAtLine(i), { [OPT]: false }))).toBe(whole(run(stateAtLine(i), {})));
    }
  }, 600_000);

  it('the receipt validator admits the withheld raise only for a decision that may have run with the option', () => {
    let checked = 0;
    let folds = 0;
    let refusedWithoutGate = 0;
    for (const i of LATE) {
      const s = stateAtLine(i);
      const off = run(s, {});
      const on = run(stateAtLine(i), { [OPT]: true });
      if (on.action === off.action || on.policyGraph === undefined) continue;
      const ctx = { player: s.player, gameState: s.gs };
      expect(
        horseDecisionReceiptRefusal(structuredClone(on), 'nlh', { ...ctx, [OPT]: true }),
        s.k
      ).toBeNull();
      // without the gate an older admission can still admit some of these changes (a call of a raise, a Lightning
      // fold); the gate is what admits the rest
      if (horseDecisionReceiptRefusal(structuredClone(on), 'nlh', ctx) !== null)
        refusedWithoutGate++;
      if (on.action === 'fold') folds++;
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
    expect(folds).toBeGreaterThan(0);
    expect(refusedWithoutGate).toBeGreaterThan(0);
    expect(holdemTurnRiverRaiseNeedsValueGate(undefined, null)).toBe(false);
    expect(holdemTurnRiverRaiseNeedsValueGate({ [OPT]: true }, null)).toBe(true);
    expect(holdemTurnRiverRaiseNeedsValueGate({ [OPT]: 'yes' }, null)).toBe(false);
  }, 600_000);
});

describe("the three real hands (rebuilt with HorseComplaintReplay.stateAt; only the deciding Horse's own cards)", () => {
  const SEEDS = [1, 7, 42, 99, 2026];
  const replay = (id: string, extra: HorseDecideOpts, seed: number, telemetry = false) => {
    const rh = fixture.realHands[id]!;
    const hand = parseExtract(structuredClone(rh.hand));
    const node = hand.actions.find((a) => a.ord === rh.node)!;
    const st = stateAt(hand, node);
    const hy = HORSE_HYBRID_PROFILES.cash;
    seedAll(seed);
    if (telemetry) {
      enableBrainTelemetry();
      drainFires();
    }
    const d = withFrozenDecisionClock(() =>
      HorseLogic.decide(st.hero, st.gs, hy.style, { ...hy.mods }, {
        ...PROD,
        ...extra,
        telemetry,
        observeMind: false,
        decisionTimeMs: NOW,
      } as HorseDecideOpts)
    );
    const fires = telemetry ? drainFires().map((f) => f.feature) : [];
    return { d, st, fires };
  };
  const raises = (d: HorseDecision) => d.action === 'raise' || d.action === 'all_in';

  it('3ba439af (cash turn, 4d5d, a gutshot facing 21 into 96): the random raise becomes the priced fold', () => {
    let offRaised = 0;
    for (const seed of SEEDS) {
      const was = replay('3ba439af', {}, seed);
      expect(was.st.gs.stage).toBe('turn');
      if (raises(was.d)) offRaised++;
      expect(act(replay('3ba439af', { [OPT]: true }, seed).d), `seed ${seed}`).toEqual({
        action: 'fold',
        amount: null,
      });
    }
    expect(offRaised).toBeGreaterThan(0);
    expect(replay('3ba439af', { [OPT]: true }, 42, true).fires).toContain(
      'holdem_turn_river_raise_not_value_folded'
    );
  });

  it('4a4ff3bb (cash turn, KhTh facing 30 into 91): the random raise becomes the call of 30', () => {
    let offRaised = 0;
    for (const seed of SEEDS) {
      if (raises(replay('4a4ff3bb', {}, seed).d)) offRaised++;
      expect(act(replay('4a4ff3bb', { [OPT]: true }, seed).d), `seed ${seed}`).toEqual({
        action: 'call',
        amount: 30,
      });
    }
    expect(offRaised).toBeGreaterThan(0);
  });

  it("6a1150c2 (cash river check-raise with 3c4c, two pair under the board's top card, facing 29 into 113): the raise becomes the call of 29", () => {
    let offRaised = 0;
    for (const seed of SEEDS) {
      const was = replay('6a1150c2', {}, seed);
      expect(was.st.gs.stage).toBe('river');
      if (raises(was.d)) offRaised++;
      expect(act(replay('6a1150c2', { [OPT]: true }, seed).d), `seed ${seed}`).toEqual({
        action: 'call',
        amount: 29,
      });
    }
    expect(offRaised).toBeGreaterThanOrEqual(3);
    expect(replay('6a1150c2', { [OPT]: true }, 1, true).fires).toContain(
      'holdem_turn_river_raise_not_value_called'
    );
  });
});
