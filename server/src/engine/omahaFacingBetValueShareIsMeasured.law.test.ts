/**
 * LAW: THE FACING-BET VALUE SHARE IS MEASURED (option omahaFacingBetValueShareIsMeasured, default OFF;
 * HORSE DECISIONS lane 2026-11-19; HorseOmahaFacingBetValueShareMeasured.ts).
 *
 * The audits of the 48-hour human-versus-Horse slice found the largest loss in folds with the price met: the
 * facing-bet verdict priced every bet as the strongest fixed share of ALL holdings, on PLO5 boards straights or
 * better, narrowed by 0.8 per earlier street, whatever the bettor's line or record. With the option on:
 *  - OFF IS OFF: unset and false give the same decision bytes and receipts on every recorded node;
 *  - the recorded folds (audit A #60057733 and eight more, audit B's 127f30c9, d73fc344, 752111cd, ab3f024a,
 *    0a9fac4b) are red with the option off and green with it on; a control keeps its fold;
 *  - the measured value share is exactly the stated one with no opportunity, wider for a measured wide bettor
 *    and narrower for a tight one, and his earlier streets never narrow it more than the stated 0.8 when he is
 *    measured wide;
 *  - the narrowing never makes the verdict fold a set or two pair the bettor's wide read would call: the win
 *    share never falls as the read widens, and with a wide read the set and two-pair nodes call;
 *  - the priced verdict decides where it prices even with omahaFacingBetEv and omahaFlopFacingBetEv off.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { expand, type RecordedFacingBet } from './HorseOmahaFacingBetEv.test-support.js';
import { OMAHA_LIVE_OPTIONS_20261116 } from './HorseOmahaFlopFacingBetEv.test-support.js';
import { omahaFacingBetEvSpot, omahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_MEASURED_LINE_AGGRESSOR,
  OMAHA_TURN_RANGE_FIT,
  omahaFacingBetMeasuredRangeOver,
  omahaMeasuredRangeElasticity,
  omahaMeasuredValueShare,
} from './HorseOmahaFacingBetValueShareMeasured.js';
import {
  VALUE_SHARE_CONTROLS,
  VALUE_SHARE_GREEN,
  VALUE_SHARE_NOTFIXED,
  type ValueShareFixture,
} from './HorseOmahaFacingBetValueShareMeasured.test-support.js';
import { emptyStreetRead, type StreetReadCounters } from './HorseOmahaStreetRead.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3];
/** The production set of the audited hands (archive activation-0106z ON-LIST, the priced turn/river raise on,
 *  the off-only flop shape fold off), without omahaFlopFacingBetEv (it went on 22 minutes before B's window closed). */
const BASE: HorseDecideOpts = (() => {
  const o: Record<string, boolean> = {
    ...OMAHA_LIVE_OPTIONS_20261116,
    omahaTurnRiverRaiseIsPriced: true,
  };
  delete o.omahaReraisedPotFlopContinueNeedsEquityShape;
  return o as HorseDecideOpts;
})();
const ON: HorseDecideOpts = { ...BASE, omahaFacingBetValueShareIsMeasured: true };

function at(f: ValueShareFixture) {
  const { fx, node } = expand(JSON.parse(JSON.stringify(f.rec)) as RecordedFacingBet);
  const st = stateAt(fx, node);
  (st.gs as { publicMemoryDomain?: unknown }).publicMemoryDomain = { speed: f.speed };
  return st;
}
const label = (f: ValueShareFixture) => `${f.source} #${f.rec.n} ${f.rec.st ?? 'river'}`;
interface Outcome {
  actions: string[];
  bytes: string[];
  fires: string[][];
}
function play(f: ValueShareFixture, opts: HorseDecideOpts, record?: StreetReadCounters): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { actions: [], bytes: [], fires: [] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    if (record)
      vi.spyOn(HorseMind, 'omahaStreetReadOf').mockImplementation(() => ({
        counters: JSON.parse(JSON.stringify(record)),
        flop: null,
        turn: null,
        river: null,
      }));
    drainFires();
    seedFastRandom(seed);
    const st = at(f);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    out.actions.push(d.action);
    // horseActionTimeIsPublicOnly draws think time from the timing stream: every byte but that number
    out.bytes.push(
      createHash('sha256')
        .update(
          JSON.stringify(withoutMeasurements(d)).replace(/"thinkTime":[0-9.]+/g, '"thinkTime":0')
        )
        .digest('hex')
    );
    // once-per-process first-sight receipts (*_seen) fire on whichever run comes first: not decision receipts
    out.fires.push(
      drainFires()
        .map((x) => x.feature)
        .filter((x) => !x.endsWith('_seen'))
    );
    vi.restoreAllMocks();
  }
  return out;
}
const continues = (o: Outcome) =>
  o.actions.every((a) => a === 'call' || a === 'all_in' || a === 'raise');
const folds = (o: Outcome) => o.actions.every((a) => a === 'fold');

/** A street record with every first-bet cell at `hit` of `opp` (decayed cells hold at most about 44). */
function record(hit: number, opp: number): StreetReadCounters {
  const r = emptyStreetRead();
  for (const s of ['flop', 'turn', 'river'] as const) r.bet[s] = { hit, opp };
  for (const t of ['paired', 'rainbow', 'twoTone', 'monotone'] as const) {
    r.cbet[t] = { hit, opp };
    r.flopBet[t] = { hit, opp };
  }
  return r;
}
const WIDE = record(40, 44);
const TIGHT = record(4, 44);

afterEach(() => vi.restoreAllMocks());

describe('the facing-bet value share is measured', () => {
  it('1. OFF IS OFF: unset and false give the same decision bytes and receipts on every node', () => {
    for (const f of [...VALUE_SHARE_GREEN, ...VALUE_SHARE_CONTROLS, ...VALUE_SHARE_NOTFIXED]) {
      const unset = play(f, BASE);
      const off = play(f, { ...BASE, omahaFacingBetValueShareIsMeasured: false });
      expect(off.bytes, label(f)).toEqual(unset.bytes);
      expect(off.fires, label(f)).toEqual(unset.fires);
      expect(
        unset.fires
          .flat()
          .some(
            (x) =>
              x.startsWith('omaha_facing_bet_value_share') ||
              x === 'omaha_facing_bet_measured_range_priced'
          ),
        label(f)
      ).toBe(false);
    }
  }, 240_000);

  it('2. RED OFF, GREEN ON: every recorded fold with the price met continues with the option on', () => {
    expect(VALUE_SHARE_GREEN.length).toBeGreaterThanOrEqual(14);
    expect(VALUE_SHARE_GREEN.some((f) => f.rec.n === 60057733)).toBe(true);
    for (const f of VALUE_SHARE_GREEN) {
      const off = play(f, BASE);
      const on = play(f, ON);
      expect(folds(off), `${label(f)} off ${off.actions}`).toBe(true);
      expect(continues(on), `${label(f)} on ${on.actions}`).toBe(true);
    }
  }, 240_000);

  it("3. a person's turn or river first bet is priced on his measured range, with its receipt", () => {
    for (const f of VALUE_SHARE_GREEN.filter((x) => String(x.rec.st ?? 'river') !== 'flop')) {
      const on = play(f, ON);
      const priced = on.fires.filter((x) =>
        x.includes('omaha_facing_bet_measured_range_priced')
      ).length;
      // the priced raise site may answer a node whose reference raised: its call is the same verdict
      expect(
        priced + on.fires.filter((x) => x.includes('omaha_priced_raise_called')).length,
        label(f)
      ).toBeGreaterThan(0);
    }
  }, 240_000);

  it('4. a control keeps its fold, and the folds it does not change stay as they are', () => {
    for (const f of [...VALUE_SHARE_CONTROLS, ...VALUE_SHARE_NOTFIXED]) {
      expect(play(f, ON).actions, label(f)).toEqual(play(f, BASE).actions);
    }
  }, 240_000);

  it("5. THE PRICED VERDICT DECIDES: with omahaFacingBetEv and omahaFlopFacingBetEv off, the option's verdict answers and continues", () => {
    const bare: HorseDecideOpts = { ...BASE, omahaFacingBetEv: false, omahaFlopFacingBetEv: false };
    for (const n of [60057733, 60050654, 59994787]) {
      const f = VALUE_SHARE_GREEN.find((x) => x.rec.n === n)!;
      expect(
        play(f, bare)
          .fires.flat()
          .some((x) => /facing_bet_ev_(call|fold)$/.test(x)),
        label(f)
      ).toBe(false);
      const on = play(f, { ...bare, omahaFacingBetValueShareIsMeasured: true });
      expect(continues(on), label(f)).toBe(true);
      expect(
        on.fires.every((x) => x.some((y) => /^omaha_(flop_)?facing_bet_ev_call$/.test(y))),
        label(f)
      ).toBe(true);
    }
  }, 240_000);

  it('6. THE STREET RECORD MOVES V: exactly the stated share with no opportunity, wider when wide, narrower when tight', () => {
    expect(omahaMeasuredRangeElasticity('person')).toBeCloseTo(0.95, 1);
    expect(omahaMeasuredRangeElasticity('horse')).toBeCloseTo(0.47, 1);
    const f = VALUE_SHARE_GREEN.find((x) => x.rec.n === 60057733)!;
    const st = at(f);
    const spot = omahaFacingBetEvSpot(st.hero, st.gs as never)!;
    const h = st.gs.actionHistory;
    const b = st.gs.communityCards;
    expect(omahaMeasuredValueShare(spot, null, 'person', h, b)).toBeNull();
    expect(omahaMeasuredValueShare(spot, WIDE, null, h, b)).toBeNull();
    const none = omahaMeasuredValueShare(spot, emptyStreetRead(), 'person', h, b)!;
    expect(none.factor).toBe(1);
    expect(none.valueShare).toBe(spot.valueShare);
    const wide = omahaMeasuredValueShare(spot, WIDE, 'person', h, b)!;
    const tight = omahaMeasuredValueShare(spot, TIGHT, 'person', h, b)!;
    expect(wide.valueShare).toBeGreaterThan(spot.valueShare);
    expect(tight.valueShare).toBeLessThan(spot.valueShare);
    // the bettor opened the turn: that earlier street is read; wide never narrows more than the stated 0.8
    expect(wide.earlier.length).toBe(1);
    for (const e of wide.earlier)
      expect(Math.pow(OMAHA_MEASURED_LINE_AGGRESSOR, 1 / e.g)).toBeGreaterThan(
        OMAHA_MEASURED_LINE_AGGRESSOR
      );
    // a raise has no cell: the street of the raise is not moved
    expect(
      omahaMeasuredValueShare({ ...spot, isRaise: true }, WIDE, 'person', h, b)!.current
    ).toBeNull();
  });

  it('7. THE NARROWING NEVER TURNS A WIDE READ INTO A FOLD: the win share never falls as the read widens', () => {
    for (const f of VALUE_SHARE_GREEN.filter((x) => String(x.rec.st ?? 'river') !== 'flop')) {
      const st = at(f);
      const spot = omahaFacingBetEvSpot(st.hero, st.gs as never);
      if (!spot) continue;
      let last = -1;
      for (const hit of [0, 8, 16, 24, 32, 40, 44]) {
        const moved = omahaMeasuredValueShare(
          spot,
          record(hit, 44),
          'person',
          st.gs.actionHistory,
          st.gs.communityCards
        )!;
        const v = omahaFacingBetEvVerdict(
          { ...spot, valueShare: moved.valueShare },
          st.hero.cards ?? [],
          st.gs.communityCards ?? [],
          [],
          null,
          { rake: 0, realization: 0.9 }
        )!;
        expect(v.pWin + 1e-9, `${label(f)} hit ${hit}`).toBeGreaterThanOrEqual(last);
        last = v.pWin;
      }
    }
  }, 120_000);

  it('8. with a wide measured read the set and two-pair nodes call, and a tight read is what can fold them', () => {
    for (const n of [60057733, 59992630, 60077745, 60050654]) {
      const f = VALUE_SHARE_GREEN.find((x) => x.rec.n === n)!;
      expect(continues(play(f, ON, WIDE)), label(f)).toBe(true);
    }
  }, 240_000);

  it('9. PLO6 and multiway spots are outside the measured range; the turn fit is in force', () => {
    expect(OMAHA_TURN_RANGE_FIT.byLine.length).toBe(2);
    for (const rows of OMAHA_TURN_RANGE_FIT.byLine)
      for (const row of rows) expect(row.reduce((a, x) => a + x, 0) / row.length).toBeCloseTo(1, 1);
    const f = VALUE_SHARE_GREEN.find((x) => x.rec.n === 60057733)!;
    const st = at(f);
    const spot = omahaFacingBetEvSpot(st.hero, st.gs as never)!;
    const base = omahaFacingBetEvVerdict(
      spot,
      st.hero.cards ?? [],
      st.gs.communityCards ?? [],
      [],
      null,
      { rake: 0 }
    )!;
    const six = [...(st.hero.cards ?? []), { rank: '2', suit: 'hearts' } as never];
    expect(
      omahaFacingBetMeasuredRangeOver(
        spot,
        base,
        six,
        st.gs.communityCards ?? [],
        [],
        st.gs.actionHistory,
        0
      )
    ).toBeNull();
    expect(
      omahaFacingBetMeasuredRangeOver(
        { ...spot, behind: 1 },
        base,
        st.hero.cards ?? [],
        st.gs.communityCards ?? [],
        [],
        st.gs.actionHistory,
        0
      )
    ).toBeNull();
    expect(
      omahaFacingBetMeasuredRangeOver(
        spot,
        base,
        st.hero.cards ?? [],
        st.gs.communityCards ?? [],
        [],
        st.gs.actionHistory,
        0
      )!.call
    ).toBe(true);
  });
});
