/**
 * A reference short shove the tournament utility prices, and one it replaces,
 * are countable per variant from named receipts (asked for by the PLO6 lane
 * and the verifier on the sign-off of c7c52fe3):
 *   phase7_short_shove_priced_<variant>_seen
 *   phase7_short_shove_replaced_<variant>_seen
 * The existing phase7_utility_override carries neither the variant nor the
 * reference action, and the telemetry rows carry no variant column.
 *
 * Held on real controller menus (pot limit, plo4, at least three players in,
 * two places paid 65/35, a stack shorter than the Horse's present):
 * - a priced reference shove fires `priced` once for every utility receipt,
 *   under its own variant and no other;
 * - `replaced` fires exactly when the utility selected another action, and
 *   the committed action is then not the all-in;
 * - a short menu whose reference is not the all-in fires neither;
 * - with the Horse's showdown equity cut to 5 percent, and to one winning
 *   sample, the existing arbiter replaces the shove on this sample, and the
 *   receipt counts it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  HorseLogic,
  phase7ShortAllInWagers,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import * as tournamentUtility from './HorseTournamentUtility.js';
import type { TournamentUtilityInput } from './HorseTournamentUtility.js';
import { remainingVariantSpot } from '../benchmark/RemainingVariantPolicyEvidence.js';
import { controllerSpotRandom } from './remainingVariants/RemainingVariantControllerSpots.test-support.js';
import { forEachJointControllerSpot } from './multiway/JointControllerSpots.test-support.js';
import type { HorseDecision, SeatPlayer } from '../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const opts: HorseDecideOpts = {
  telemetry: true,
  mind: false,
  decisionTimeMs: 0,
  phase8Postflop: 'off',
  phase10Plo4: 'off',
  phase11Omaha: 'off',
  phase12Remaining: 'off',
  phase13Joint: 'off',
};

const VARIANT = 'plo4';
const PRICED = `phase7_short_shove_priced_${VARIANT}_seen`;
const REPLACED = `phase7_short_shove_replaced_${VARIANT}_seen`;

/** Showdown samples in which the hero wins exactly `wins` times, and the
 * equity and its standard error those samples have. Null leaves them as dealt. */
function withHeroWins(
  input: TournamentUtilityInput,
  winsOf: ((samples: number) => number) | null
): TournamentUtilityInput {
  if (!winsOf) return input;
  const n = input.showdownSamples.length;
  const wins = winsOf(n);
  const p = wins / n;
  return {
    ...input,
    heroEquity: p,
    equityStandardError: Math.max(Math.sqrt((p * (1 - p)) / n), 1 / (2 * n)),
    showdownSamples: input.showdownSamples.map((sample, index) => ({
      boards: sample.boards.map((board) => ({
        ...board,
        heroHigh:
          index < wins ? Math.max(...board.opponentHigh) + 1 : Math.min(...board.opponentHigh) - 1,
      })),
    })),
  };
}

interface Run {
  decision: HorseDecision;
  built: TournamentUtilityInput | null;
  fires: Map<string, number>;
}

function decide(
  hero: SeatPlayer,
  s: HorseGameStateV2,
  winsOf: ((samples: number) => number) | null
): Run {
  const original = tournamentUtility.evaluateTournamentUtilityDetailed;
  let built: TournamentUtilityInput | null = null;
  const spy = vi
    .spyOn(tournamentUtility, 'evaluateTournamentUtilityDetailed')
    .mockImplementation((input) => {
      built ??= { ...input };
      return original(withHeroWins(input, winsOf));
    });
  try {
    drainFires();
    seedFastRandom(0x5a18);
    const decision = HorseLogic.decide(hero, s, 'balanced', {}, opts);
    return { decision, built, fires: new Map(drainFires().map((r) => [r.feature, r.fires])) };
  } finally {
    spy.mockRestore();
  }
}

const lowEquityReplaced = new Set<string>();
const MEASURED: unknown[] = [];

describe('the priced and the replaced reference short shove are counted by variant', () => {
  it('plo4 tournament, 65/35 with a shorter stack in: priced on every receipt, replaced only when the utility selects another action', () => {
    enableBrainTelemetry();
    const random = controllerSpotRandom(0x5a1a0000 ^ VARIANT.length ^ (VARIANT.charCodeAt(2) << 8));
    vi.stubGlobal('crypto', {
      getRandomValues(target: Uint32Array) {
        for (let i = 0; i < target.length; i++)
          target[i] = Math.floor(random() * 0x100000000) >>> 0;
        return target;
      },
    });
    const n = { shoves: 0, priced: 0, replaced: 0, replacedAtFivePercent: 0, others: 0 };
    const wrong: unknown[] = [];
    let flagged = 0;
    forEachJointControllerSpot(VARIANT, 'tournament', 900, 0x5a1a + VARIANT.length, (spot) => {
      const { hero, state: s } = spot;
      const legal = s.legalActions ?? [];
      if (
        !legal.includes('all_in') ||
        legal.includes('bet') ||
        legal.includes('raise') ||
        s.minRaiseTo !== null ||
        s.maxRaiseTo !== null ||
        hero.stack <= (s.toCall ?? 0) + 0.005 ||
        !phase7ShortAllInWagers(s, hero, 'pot_limit')
      )
        return;
      const live = s.players.filter((p) => !p.is_sitting_out);
      const heroTotal = hero.stack + hero.totalInvested;
      if (
        live.length < 3 ||
        !live.some((p) => p.seat !== hero.seat && p.stack + p.totalInvested < heroTotal)
      )
        return;
      if (flagged++ >= 150) return;
      s.tournament = {
        ...remainingVariantSpot('flh', 'river', 4, 'tournament').state.tournament!,
        gameVariant: VARIANT,
        currentSmallBlind: s.bigBlind / 2,
        currentBigBlind: s.bigBlind,
        playersLeft: live.length,
        spotsPaid: 2,
        payoutPct: [65, 35],
        stacks: live.map((p) => p.stack + p.totalInvested),
        stackByUser: Object.fromEntries(live.map((p) => [p.user_id, p.stack + p.totalInvested])),
      } as typeof s.tournament;

      const asDealt = decide(hero, s, null);
      if (!asDealt.built) return;
      const where = { stage: s.stage, toCall: s.toCall, stack: hero.stack };
      const shortShoveKeys = (run: Run) =>
        [...run.fires.keys()].filter((key) => key.startsWith('phase7_short_shove_'));
      if (asDealt.built.baseline.action !== 'all_in') {
        // Not the reference shove: neither receipt, whatever was decided.
        if (n.others++ < 12 && shortShoveKeys(asDealt).length)
          wrong.push({ ...where, other: shortShoveKeys(asDealt) });
        return;
      }
      n.shoves++;
      const runs: [string, Run][] = [
        ['as dealt', asDealt],
        ['5 percent', decide(hero, s, (samples) => Math.max(1, Math.round(samples * 0.05)))],
        ['one win', decide(hero, s, () => 1)],
      ];
      for (const [label, run] of runs) {
        const ledger = run.decision.tournamentUtility;
        const receipts = ledger ? (run.fires.get('phase7_tournament_utility') ?? 0) : 0;
        const selectedOther = !!ledger && ledger.selectedAction !== 'all_in';
        const expected = {
          priced: receipts,
          replaced: selectedOther ? receipts : 0,
          keys: [...(receipts ? [PRICED] : []), ...(selectedOther && receipts ? [REPLACED] : [])],
        };
        const got = {
          priced: run.fires.get(PRICED) ?? 0,
          replaced: run.fires.get(REPLACED) ?? 0,
          keys: shortShoveKeys(run).sort(),
        };
        if (
          JSON.stringify(got) !== JSON.stringify(expected) ||
          (ledger && (ledger.baselineAction !== 'all_in' || receipts !== 1)) ||
          (got.replaced > 0 && run.decision.action === 'all_in') ||
          (got.replaced > 0 && ledger?.overrodeBaseline !== true)
        )
          wrong.push({ ...where, label, got, expected, action: run.decision.action });
        if (label === 'as dealt') {
          n.priced += got.priced;
          n.replaced += got.replaced;
        } else if (got.replaced > 0) {
          if (label === '5 percent') n.replacedAtFivePercent++;
          lowEquityReplaced.add(`${flagged}:${label}`);
        }
      }
    });
    expect(wrong.slice(0, 3)).toEqual([]);
    expect(wrong.length).toBe(0);
    expect(n.shoves).toBeGreaterThan(0);
    expect(n.priced).toBeGreaterThan(0);
    expect(n.others).toBeGreaterThan(0);
    // The existing arbiter replaces a shove that almost never wins; the
    // receipt counted each replacement (the failures above name any it did
    // not).
    expect(lowEquityReplaced.size).toBeGreaterThan(0);
    MEASURED.push({ ...n, lowEquityReplaced: [...lowEquityReplaced] });
  }, 600_000);

  it('reports what the sample held', () => {
    expect(MEASURED).toHaveLength(1);
    if (process.env.SHORT_JAM_PRINT) console.log(JSON.stringify(MEASURED));
  });
});
