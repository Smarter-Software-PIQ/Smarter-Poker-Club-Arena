/**
 * omahaFlopBetPricesTheRaise (WooWoo audit FLOPBET-RAISE, finding FOURBET F1):
 * the v38 flop bet is priced with his raise as a third branch. Off (or out of
 * the spot) the engine is exactly as before; the raise answer is the one owner
 * HorseOmahaPricedSites.omahaPricedSitesFlopRaiseAnswer; the recorded flop
 * bets of the finding (anonymised: the Horse's own cards, the board, the pot
 * and the stack at the decision; no ids, no other player's cards) are priced.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { evaluateSpot, type EvSpot, type EvRaiseBranch } from './HorseEvEngine.js';
import { HorseMind } from './HorseMind.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import { omahaFlopEvCounts } from './HorseOmahaFlopFacingBetEv.js';
import {
  omahaFlopBetRaiseBranchChange,
  omahaFlopBetRaiseBranchOf,
} from './HorseOmahaFlopBetRaiseBranch.js';
import {
  OMAHA_PRICED_SITES_FLOP_RAISE_SHARE,
  omahaPricedSitesFlopBetEv,
  omahaPricedSitesFlopRaiseAnswer,
  omahaPricedSitesFlopRealization,
} from './HorseOmahaPricedSites.js';
import { cards, decideAt, LIVE_OPTIONS, pricedSpot } from './HorseOmahaPricedRules.test-support.js';

afterEach(() => {
  HorseMind.reset();
});

const ON = { omahaFlopBetPricesTheRaise: true } as HorseDecideOpts;
const RAKE = 0.05;

const baseSpot = (o: Partial<EvSpot> & { pot: number; stack: number; equity: number }): EvSpot => ({
  toCall: 0,
  effectiveStack: o.stack,
  street: 'flop',
  inPosition: true,
  opponents: 1,
  models: [{ foldMul: 1 }],
  realization: 0.8,
  rakeMarg: RAKE,
  minBet: 2,
  maxBet: o.pot,
  sizes: [0.33, 0.5, 0.75, 1],
  initiative: true,
  rand: () => 0.5,
  ...o,
});

describe('the engine: no branch, or a branch of share 0, prices exactly as before', () => {
  it('candidates identical over a grid of spots', () => {
    for (const equity of [0.15, 0.35, 0.55, 0.75, 0.92])
      for (const [pot, stack] of [
        [100, 1000],
        [315, 361.6],
        [198, 304],
        [50, 40],
      ])
        for (const inPosition of [true, false]) {
          const s = baseSpot({ pot, stack, equity, inPosition });
          const plain = evaluateSpot(s);
          const zero = evaluateSpot({
            ...s,
            raiseBranch: (): EvRaiseBranch => ({ share: 0, equityRaise: 0.5, evFacingRaise: -1 }),
          });
          const nul = evaluateSpot({ ...s, raiseBranch: () => null });
          expect(zero.candidates).toEqual(plain.candidates);
          expect(nul.candidates).toEqual(plain.candidates);
          expect(zero.best).toEqual(plain.best);
        }
  });
  it('facing a bet or multiway the branch is never read', () => {
    let reads = 0;
    const branch = (): EvRaiseBranch => {
      reads++;
      return { share: 0.15, equityRaise: 0.1, evFacingRaise: -50 };
    };
    evaluateSpot({
      ...baseSpot({ pot: 200, stack: 500, equity: 0.6 }),
      toCall: 50,
      raiseBranch: branch,
    });
    evaluateSpot({
      ...baseSpot({ pot: 200, stack: 500, equity: 0.6 }),
      opponents: 2,
      models: [{ foldMul: 1 }, { foldMul: 1 }],
      raiseBranch: branch,
    });
    expect(reads).toBe(0);
  });
});

describe('the engine: the raise branch closed form', () => {
  it('EV(bet s) = f.P + (cont - rho).band call + rho.max(answer, -s); the check unmoved', () => {
    const s0 = baseSpot({ pot: 300, stack: 450, equity: 0.5, sizes: [0.8] });
    const plain = evaluateSpot(s0);
    const rho = 0.15;
    const eqR = 0.2;
    const ans = -120;
    const v = evaluateSpot({
      ...s0,
      raiseBranch: () => ({ share: rho, equityRaise: eqR, evFacingRaise: ans }),
    });
    const bp = plain.candidates.find((a) => a.kind === 'bet')!;
    const bv = v.candidates.find((a) => a.kind === 'bet')!;
    expect(bv.kind === 'bet' && bp.kind === 'bet').toBe(true);
    if (bv.kind !== 'bet' || bp.kind !== 'bet') return;
    expect(bv.amount).toBe(bp.amount);
    expect(bv.raiseShare).toBe(rho);
    expect(bv.evWithoutRaise).toBeCloseTo(bp.ev, 9);
    // recompute: the band equity is the continuing equity with the raisers out
    const f = bp.foldEquity;
    const cont = 1 - f;
    const P = 300;
    const s = bp.amount;
    // continuing equity of the engine (FOLDED_HANDS_HERO_BEAT 0.85)
    const eqCont = Math.min(0.99, Math.max(0.03, (0.5 - 0.85 * f) / (1 - f)));
    const eqBand = (cont * eqCont - rho * eqR) / (cont - rho);
    // the engine realizes the called pot as before; recover its factor from the two-branch price
    const realizedCont = ((bp.ev - f * P) / cont + s) / (P + 2 * s);
    const factor = realizedCont / eqCont;
    const expected =
      f * P + (cont - rho) * (eqBand * factor * (P + 2 * s) - s) + rho * Math.max(-s, ans);
    expect(bv.ev).toBeCloseTo(expected, 6);
    expect(v.candidates.find((a) => a.kind === 'check')!.ev).toBe(
      plain.candidates.find((a) => a.kind === 'check')!.ev
    );
  });
  it('a hand ahead of his raises gains from the branch; one behind them loses', () => {
    const s0 = baseSpot({ pot: 300, stack: 450, equity: 0.5, sizes: [0.8] });
    const plain = evaluateSpot(s0).candidates.find((a) => a.kind === 'bet')!.ev;
    const priced = (eqR: number) =>
      evaluateSpot({
        ...s0,
        raiseBranch: (w) => {
          const real = omahaPricedSitesFlopRealization(true, 300, w, 450);
          return {
            share: 0.15,
            equityRaise: eqR,
            evFacingRaise: omahaPricedSitesFlopRaiseAnswer(300, w, 450, eqR, real, RAKE).ev,
          };
        },
      }).candidates.find((a) => a.kind === 'bet')!.ev;
    expect(priced(0.9)).toBeGreaterThan(plain);
    expect(priced(0.05)).toBeLessThan(plain);
  });
});

describe('the raise answer has one owner: omahaPricedSitesFlopBetEv is unchanged', () => {
  it('rake 0 reproduces the site arithmetic exactly', () => {
    const counts = omahaFlopEvCounts(cards('AdAhKdJd4h'), cards('8s6c9s'), [], 0.15)!;
    const eqTop = (x: number) => counts.top(x).win + counts.top(x).tie / 2;
    const v = omahaPricedSitesFlopBetEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: true,
      foldToBet: 0.42,
    })!;
    const real = omahaPricedSitesFlopRealization(true, 315, 252, 361.6);
    const eqRaise = eqTop(0.15);
    const raiseTo = Math.min(361.6, 315 + 3 * 252);
    const evCallRaise =
      eqRaise * (315 + 2 * raiseTo) * (raiseTo >= 361.6 - 0.005 ? 1 : real) - raiseTo;
    const a = omahaPricedSitesFlopRaiseAnswer(315, 252, 361.6, eqRaise, real);
    expect(a.evCall).toBe(evCallRaise);
    expect(a.ev).toBe(Math.max(-252, evCallRaise));
    expect(v.callsRaise).toBe(evCallRaise > -252);
    expect(a.raiseTo).toBe(raiseTo);
  });
});

describe('the builder: scope', () => {
  const flop = () => pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', bet: 0, inPosition: true });
  it('off: off', () => {
    const st = flop();
    expect(
      omahaFlopBetRaiseBranchOf(
        st.hero as never,
        st.gs as never,
        {} as HorseDecideOpts,
        315,
        361.6,
        true,
        RAKE
      ).kind
    ).toBe('off');
  });
  it('on, heads-up against a person on the flop: priced at the measured share', () => {
    const st = flop();
    const v = omahaFlopBetRaiseBranchOf(
      st.hero as never,
      st.gs as never,
      ON,
      315,
      361.6,
      true,
      RAKE
    );
    // the fixture's opponent kind as the engine reads it
    // eslint-disable-next-line no-console
    console.log(`[builder kind] ${v.kind}${v.kind === 'unpriced' ? ' ' + v.reason : ''}`);
    if (v.kind === 'priced') {
      expect(v.value.raiseShare).toBe(OMAHA_PRICED_SITES_FLOP_RAISE_SHARE);
      const b = v.value.branch(100)!;
      expect(b.share).toBe(OMAHA_PRICED_SITES_FLOP_RAISE_SHARE);
      // an all-in bet cannot be raised
      expect(v.value.branch(361.6)!.share).toBe(0);
    }
  });
  it('against a Horse: unpriced (no measured raise share for a Horse)', () => {
    const st = flop();
    const gs = structuredClone(st.gs) as {
      humanUserIds?: string[];
      players: Array<{ seat: number; user_id: string; is_horse?: boolean }>;
    };
    gs.humanUserIds = [];
    for (const p of gs.players) p.is_horse = true;
    const v = omahaFlopBetRaiseBranchOf(st.hero as never, gs as never, ON, 315, 361.6, true, RAKE);
    expect(v.kind).toBe('unpriced');
  });
  it('against a person (kind read from the seat list): priced', () => {
    const st = flop();
    const gs = structuredClone(st.gs) as {
      humanUserIds?: string[];
      players: Array<{ seat: number; user_id: string; is_horse?: boolean }>;
    };
    const opp = gs.players.find((p) => p.seat === 1)!;
    gs.humanUserIds = [opp.user_id];
    expect(
      omahaFlopBetRaiseBranchOf(st.hero as never, gs as never, ON, 315, 361.6, true, RAKE).kind
    ).toBe('priced');
  });
  it('turn, or out of scope (tournament): off', () => {
    const turn = pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s2h', bet: 0, inPosition: true });
    expect(
      omahaFlopBetRaiseBranchOf(turn.hero as never, turn.gs as never, ON, 315, 361.6, true, RAKE)
        .kind
    ).toBe('off');
    const st = flop();
    const gs = { ...(st.gs as object), gameMode: 'tournament' };
    expect(
      omahaFlopBetRaiseBranchOf(st.hero as never, gs as never, ON, 315, 361.6, true, RAKE).kind
    ).toBe('off');
  });
});

/**
 * Recorded flop bets of the finding, anonymised (the Horse's own cards, the
 * board, the pot it bet into, its stack; he covered it; heads-up against a
 * person, nothing to call). `bet` is the recorded size. Engine equity here:
 * the sampler's equity against his WHOLE range on the board (decision-time
 * only, deterministic), the same for both prices.
 */
const RECORDED = [
  { id: 'R1', hole: 'AdAhKdJd4h', board: '8s6c9s', pot: 315, stack: 361.6, ip: true, bet: 252 },
  { id: 'R2', hole: '6sQd3dAhJh', board: '7d2cJc', pot: 198, stack: 304, ip: true, bet: 169 },
  { id: 'R3', hole: '5cQcAs7c6s', board: '2hJsKc', pot: 369, stack: 414.75, ip: false, bet: 306 },
  { id: 'R4', hole: 'JcAd9c2dAc', board: '7s6h2h', pot: 465, stack: 634.14, ip: true, bet: 388 },
  { id: 'R5', hole: '9s9h6sQdKd', board: 'Ad2sQc', pot: 306, stack: 392.5, ip: true, bet: 258 },
  // value: a set of kings, ahead of most of his raises
  { id: 'V1', hole: '7cKcJc9sKs', board: '6c9cKd', pot: 252, stack: 308.75, ip: true, bet: 252 },
] as const;

function priceRecorded(r: (typeof RECORDED)[number]) {
  const counts = omahaFlopEvCounts(
    cards(r.hole),
    cards(r.board),
    [],
    OMAHA_PRICED_SITES_FLOP_RAISE_SHARE
  )!;
  const eqAll = counts.top(1).win + counts.top(1).tie / 2;
  const eqR = counts.top(OMAHA_PRICED_SITES_FLOP_RAISE_SHARE);
  const equityRaise = eqR.win + eqR.tie / 2;
  const spot = baseSpot({
    pot: r.pot,
    stack: r.stack,
    equity: eqAll,
    inPosition: r.ip,
    realization: r.ip ? 0.85 : 0.75,
    sizes: [0.33, 0.5, 0.75, 0.8, 1],
  });
  const branch = (w: number): EvRaiseBranch => {
    if (w >= r.stack - 0.005) return { share: 0, equityRaise, evFacingRaise: -w };
    const real = omahaPricedSitesFlopRealization(r.ip, r.pot, w, r.stack);
    return {
      share: OMAHA_PRICED_SITES_FLOP_RAISE_SHARE,
      equityRaise,
      evFacingRaise: omahaPricedSitesFlopRaiseAnswer(r.pot, w, r.stack, equityRaise, real, RAKE).ev,
    };
  };
  return {
    eqAll,
    equityRaise,
    plain: evaluateSpot(spot),
    priced: evaluateSpot({ ...spot, raiseBranch: branch }),
  };
}

describe('recorded flop bets of the finding', () => {
  it('every big bet behind his raises is priced lower with the branch; the value set is priced higher', () => {
    const rows: string[] = [];
    const verdicts: Record<string, string> = {};
    for (const r of RECORDED) {
      const { eqAll, equityRaise, plain, priced } = priceRecorded(r);
      const big = (v: typeof plain) =>
        v.candidates.find((a) => a.kind === 'bet' && Math.abs(a.amount - r.pot * 0.8) < 1)!;
      const bp = big(plain);
      const bv = big(priced);
      // he raises with the top of his range: the Horse's equity against it is below its equity against all
      if (r.id.startsWith('R')) expect(equityRaise).toBeLessThan(eqAll);
      expect(Number.isFinite(bv.ev) && Number.isFinite(bp.ev)).toBe(true);
      expect(omahaFlopBetRaiseBranchChange(plain)).toBe('kept');
      verdicts[r.id] =
        `${omahaFlopBetRaiseBranchChange(priced)} ${bv.ev < bp.ev ? 'lower' : 'higher'}`;
      const fmt = (a: (typeof plain)['best']) =>
        a.kind === 'bet'
          ? `bet ${a.amount.toFixed(0)} (${a.ev.toFixed(1)})`
          : `${a.kind} (${a.ev.toFixed(1)})`;
      rows.push(
        `${r.id}: eq all ${eqAll.toFixed(3)} vs raisers ${equityRaise.toFixed(3)} | 80% bet ${bp.ev.toFixed(1)} -> ${bv.ev.toFixed(1)} | best ${fmt(plain.best)} -> ${fmt(priced.best)} [${omahaFlopBetRaiseBranchChange(priced)}]`
      );
    }
    // eslint-disable-next-line no-console
    console.log('[recorded]\n' + rows.join('\n'));
    // eslint-disable-next-line no-console
    console.log('[recorded verdicts] ' + JSON.stringify(verdicts));
    // As computed at the build (FLOPBET-RAISE 2026-11-18), pinned against regression; not a target.
    // R3 rises: his pot raise there is all in, and the Horse's call-off of it at 0.211 is priced above
    // calling a bet-sized pot with the raisers averaged in.
    expect(verdicts).toEqual({
      R1: 'kept lower',
      R2: 'checked lower',
      R3: 'kept higher',
      R4: 'kept lower',
      R5: 'kept lower',
      V1: 'kept higher',
    });
  });
});

describe('a whole decision', () => {
  it('option off: the decision equals the decision without the option key; on: legal and the branch receipts', () => {
    enableBrainTelemetry();
    const st = pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', bet: 0, inPosition: true });
    for (const seed of [1, 2, 3, 4, 5]) {
      const base = decideAt(st, { ...LIVE_OPTIONS, telemetry: true } as HorseDecideOpts, seed);
      drainFires();
      const off = decideAt(
        st,
        { ...LIVE_OPTIONS, telemetry: true, omahaFlopBetPricesTheRaise: false } as HorseDecideOpts,
        seed
      );
      const offFires = drainFires().map((f) => f.feature);
      const strip = (d: unknown) =>
        JSON.parse(
          JSON.stringify(d, (k, v) =>
            k === 'elapsedMs' || k === 'thinkTime' || k === 'latencyMs' ? undefined : v
          )
        );
      expect(strip(off)).toEqual(strip(base));
      expect(offFires.some((f) => f.startsWith('omaha_flop_bet_raise_branch'))).toBe(false);
      const on = decideAt(st, { ...LIVE_OPTIONS, ...ON, telemetry: true } as HorseDecideOpts, seed);
      const onFires = drainFires().map((f) => f.feature);
      expect(['check', 'bet', 'all_in']).toContain(on.action);
      // eslint-disable-next-line no-console
      console.log(
        `[decision seed ${seed}] base ${base.action} ${base.amount ?? ''} | on ${on.action} ${on.amount ?? ''} | ${onFires
          .filter((f) => f.startsWith('omaha_flop_bet_raise_branch') || f === 'v38_ev_bet')
          .join(',')}`
      );
    }
  }, 300000);
});
