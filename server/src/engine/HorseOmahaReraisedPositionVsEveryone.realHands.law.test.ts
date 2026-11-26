/**
 * LAW (real audited hands): omahaReraisedPositionVsEveryoneToAct folds the audited out-of-position multiway calls of
 * a 3-bet that the old position test priced in position (PLO lead-7 lane plo-preflop, 2026-11-26).
 *
 * Three PLO4/PLO5 cash hands of HAND-AUDIT-PLO (tier A: the deciding Horse's cards were shown at showdown; no other
 * card is in the fixture, player ids are neutral), each a call of a 3-bet out of position with a player still to act
 * behind, graded fold-best by the audit. Replayed on the production options of 2026-11-26 (fixture.opts) with no
 * opponent read and five seeds: off, today's brain calls every time (the defect, kept as the control); on, every
 * seed folds where the opener still to act continues often enough (e2a563a7), and never turns a fold into a call. Of the
 * 991 audited preflop decisions facing a raise replayed off and on (lane BUILD.md) the option changes 2, both toward
 * the audit's best, none away from it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { stateAt, actionKind } from './HorseComplaintReplay.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';

interface FixtureHand {
  handId: string;
  ord: number;
  shownHole: string;
  [k: string]: unknown;
}
const FIXTURE = JSON.parse(
  readFileSync(
    new URL('./HorseOmahaReraisedPositionVsEveryone.realHands.fixture.json', import.meta.url),
    'utf8'
  )
) as { opts: HorseDecideOpts; hands: FixtureHand[] };
const SEEDS = [1, 7, 42, 99, 2026];
const FIXED_NOW = 1795501563479;
const hy = HORSE_HYBRID_PROFILES.cash;

function decide(h: FixtureHand, extra: Partial<HorseDecideOpts>, seed: number): string {
  const action = (h.actions as { ord: number }[]).find((a) => a.ord === h.ord)!;
  const st = stateAt(h as never, action as never);
  HorseMind.reset();
  seedFastRandom(seed);
  seedHorseBetSizeRandom(seed ^ 0x5bd1e995);
  seedHorseTimingRandom(seed ^ 0x9e3779b9);
  const d = HorseLogic.decide(
    st.hero,
    JSON.parse(JSON.stringify(st.gs)),
    hy.style,
    { ...hy.mods },
    {
      ...FIXTURE.opts,
      ...extra,
      telemetry: false,
      observeMind: false,
      decisionTimeMs: FIXED_NOW,
    } as HorseDecideOpts
  );
  return actionKind(d.action, d.amount, st.pn);
}

describe('audited out-of-position multiway calls of a 3-bet', () => {
  // e2a563a7: the opener still to act after the big blind continues often enough that the weighted price folds.
  const FOLDS = new Set(['e2a563a7']);
  for (const h of FIXTURE.hands)
    it(`${h.handId} (${h.shownHole}): off calls (the defect); on ${FOLDS.has(h.handId) ? 'folds' : 'never adds a call'}`, () => {
      for (const seed of SEEDS) {
        expect(decide(h, {}, seed)).toBe('call');
        const on = decide(h, { omahaReraisedPositionVsEveryoneToAct: true }, seed);
        if (FOLDS.has(h.handId)) expect(on).toBe('fold');
        else expect(['call', 'fold']).toContain(on);
      }
    });
});
