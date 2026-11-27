/**
 * omahaReraisedPotFoldReraiseIsPriced (default OFF; PLO-OWNER lead-8 lane preflop, 2026-11-27) on real production
 * nodes: eleven PLO5 / PLO4 cash decisions of 2026-11-20..27 in which a Horse had opened, a person 3-bet, everyone
 * else was out, the Horse was out of position and FOLDED. Fixture
 * anOmahaReraisedPotFoldReraiseIsPriced.realHands.fixture.json, written by toComplaintFixture: no user id, only the
 * deciding Horse's own cards. The 3-bettor's public record is not in a fixture, so each test states the record it
 * gives him (his 3-bets of his opportunities; the live reads were 0.28 to 0.47 wide).
 *
 *  - whatever his record, a fold the rules left standing becomes the pot re-raise at the largest legal raise-to or
 *    stays a fold, never a call, and a standing call or re-raise is not touched;
 *  - the answer follows his record: against a measured tight 3-bettor (2 of 60) fewer of these hands are re-raised
 *    than against a measured wide one (54 of 60);
 *  - off (absent or false) every decision is byte for byte the one it was, whatever his record.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { RR_LIVE_OPTS } from './HorseOmahaReraisedPotPriced.test-support.js';
import FIXTURE from './anOmahaReraisedPotFoldReraiseIsPriced.realHands.fixture.json';

interface RealHand extends ComplaintFixture {
  ord: number;
  raiserSeat: number;
  recorded: string;
}
const HANDS = FIXTURE as unknown as RealHand[];
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const OFF: HorseDecideOpts = {
  ...RR_LIVE_OPTS,
  telemetry: true,
  observeMind: false,
} as HorseDecideOpts;
const ON = { ...OFF, omahaReraisedPotFoldReraiseIsPriced: true } as HorseDecideOpts;

enableBrainTelemetry();
afterEach(() => HorseMind.reset());

/** Give the 3-bettor (the fixture's anonymous seat id) a public record: `threeBet` 3-bets of `opp` opportunities. */
function setRead(h: RealHand, threeBet: number, opp: number): void {
  HorseMind.reset();
  if (opp <= 0) return;
  const c: ExploitCounters = freshExploitCounters();
  Object.assign(c, {
    hands: opp * 2,
    vpip: opp,
    pfr: opp * 0.8,
    rfiOpp: opp,
    rfi: opp * 0.5,
    threeBetOpp: opp,
    threeBet,
    foldTo3BetOpp: 5,
    foldTo3Bet: 1,
  });
  const map = (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> })
    .exploitCounters;
  for (const size of [2, 3, 4, 5, 6])
    map.set(`${readScopeOf(h.variant, size)}|p${h.raiserSeat}`, { ...c });
}

function decide(h: RealHand, opts: HorseDecideOpts, read: [number, number], seed = 7) {
  const st = stateAt(h, h.actions.find((a) => a.ord === h.ord)!);
  setRead(h, read[0], read[1]);
  seedFastRandom(seed);
  seedHorseTimingRandom(seed);
  drainFires();
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, { ...LIVE.mods }, opts);
  return { d, fires: drainFires().map((f) => f.feature), max: st.pn.maxRaiseTo };
}
const isRaise = (a: string) => a === 'raise' || a === 'all_in';
const strip = (d: unknown) =>
  JSON.stringify(withoutMeasurements(d), (k, v) => (k === 'thinkTime' ? 0 : v));

describe('omahaReraisedPotFoldReraiseIsPriced on real nodes: a Horse that opened and folded to a 3-bet out of position', () => {
  it('the fixture: eleven folds, PLO5 and PLO4, one Horse hand each, no user id', () => {
    expect(HANDS.length).toBe(11);
    expect(new Set(HANDS.map((h) => h.variant))).toEqual(new Set(['plo5', 'plo4']));
    expect(HANDS.every((h) => h.recorded === 'fold')).toBe(true);
    expect(JSON.stringify(HANDS)).not.toMatch(/userId|username/);
    for (const h of HANDS) expect(Object.keys(h.hole).length).toBe(1);
  });

  it('whatever his record: a standing fold becomes the pot re-raise at the largest legal raise-to or stays a fold, never a call; nothing else moves', () => {
    let folds = 0;
    let raised = 0;
    for (const h of HANDS)
      for (const read of [
        [54, 60],
        [12, 60],
        [2, 60],
        [0, 0],
      ] as [number, number][]) {
        const off = decide(h, OFF, read);
        const on = decide(h, ON, read);
        if (off.d.action !== 'fold') {
          expect([h.slug, read, on.d.action, on.d.amount]).toEqual([
            h.slug,
            read,
            off.d.action,
            off.d.amount,
          ]);
          continue;
        }
        folds++;
        expect(on.d.action).not.toBe('call');
        if (isRaise(on.d.action)) {
          raised++;
          if (on.d.action === 'raise') expect(on.d.amount).toBe(on.max);
          expect(on.fires).toContain('omaha_reraised_pot_priced_fold_reraised');
        } else expect(on.fires).toContain('omaha_reraised_pot_priced_fold_reraise_kept');
      }
    expect(folds).toBeGreaterThanOrEqual(8);
    expect(raised).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('the answer follows his record: against a measured tight 3-bettor no more of these hands are re-raised than against a measured wide one', () => {
    const raises = (read: [number, number]) =>
      HANDS.filter((h) => isRaise(decide(h, ON, read).d.action)).length;
    const wide = raises([54, 60]);
    const tight = raises([2, 60]);
    expect(wide).toBeGreaterThanOrEqual(6);
    expect(tight).toBeLessThan(wide);
  }, 120_000);

  it('off (absent, false) every decision is the one it was, whatever his record', () => {
    for (const h of HANDS)
      for (const read of [
        [54, 60],
        [2, 60],
        [0, 0],
      ] as [number, number][]) {
        const a = decide(h, OFF, read);
        const b = decide(
          h,
          { ...OFF, omahaReraisedPotFoldReraiseIsPriced: false } as HorseDecideOpts,
          read
        );
        expect(strip(b.d)).toBe(strip(a.d));
        expect(b.fires.sort()).toEqual(a.fires.sort());
      }
  }, 120_000);
});
