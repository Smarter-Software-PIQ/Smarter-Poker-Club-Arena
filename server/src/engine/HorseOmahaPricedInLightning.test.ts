/**
 * omahaPricedInLightning (PLO Strategy lane 2026-11-18, default OFF).
 *
 * HORSE SWITCH lane finding 2026-11-18T20:08:21Z: every priced PLO4/PLO5 option
 * is gated out of Lightning by omahaPricedInScope, so a priced option that is
 * switched on changes nothing in the Lightning pools. This scope option opens
 * the priced scope to Lightning for the priced options whose own switch is on.
 *
 * Proved here, on recorded PLO4/PLO5 cash decisions (horseComplaints fixtures)
 * moved into a Lightning pool:
 *  - OFF (unset or false): in Lightning the gated priced options change no
 *    decision (each decision equals the one with those options off), so the
 *    option off is the code before it;
 *  - ON outside Lightning: no decision changes (the option touches Lightning only);
 *  - ON in Lightning: the priced verdict reaches the Lightning decision path
 *    (its receipts fire, decisions change), and only with a priced option on;
 *  - the receipt validator admits the priced raise -> call in Lightning only
 *    under the decision's own option.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { omahaPricedAdmitsRaiseToCall, omahaPricedInScope } from './HorseOmahaPricedWiring.js';
import { omahaRaiseNeedsNutsScope } from './HorseOmahaTurnRiverRaiseNeedsNuts.js';
import {
  horseDecisionReceiptRefusal,
  horseDecisionReceiptRefusalForGates,
  omahaPricedInLightningGateCandidates,
} from './horseDecision/responseValidation.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';

/** The priced options whose scope is omahaPricedInScope (the ones this option opens to Lightning). */
const GATED_PRICED = [
  'omahaTurnRiverRaiseIsPriced',
  'omahaDrawRaiseIsPriced',
  'omahaOopTurnBarrelIsPriced',
  'omahaPairedBoardBetIsPriced',
  'omahaPressureIsPriced',
  'omahaBigBetCallsArePriced',
  'omahaUnderpairMultiwayIsPriced',
  'omahaMadeHandBetIsPriced',
  'omahaTurnSetSizeIsPriced',
  'omahaBlockerBluffIsPriced',
  'omahaFlopBetIsPriced',
] as const;
const on = Object.fromEntries(GATED_PRICED.map((k) => [k, true])) as HorseDecideOpts;
const off = Object.fromEntries(GATED_PRICED.map((k) => [k, false])) as HorseDecideOpts;
/** The categorical rules the priced options replace, on (the live switch rows of 2026-11-18). */
const LIVE_CATEGORICAL: HorseDecideOpts = {
  omahaFacingBetEv: true,
  omahaCardImpact: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaBareOverpairOopFlopCheck: true,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaBluffCatcherFoldVsValueLeader: true,
  omahaNoDrawRaiseOutOfPosition: true,
  omahaOopTurnCheckAfterFlopCall: true,
  omahaPressureNeedsPostflopAggression: true,
  omahaUnderpairNoMultiwayFlopContinue: true,
  omahaSmallBetIsPriced: true,
};

const DIR = resolve(process.cwd(), 'src/engine/horseComplaints');
const FIXTURES: ComplaintFixture[] = readdirSync(DIR)
  .filter((f) => /^plo[45]-.*\.fixture\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as ComplaintFixture)
  .filter((fx) => fx.fmt === 'cash');

const LIVE = replayProfiles('cash').find((p) => p.live)!;

interface Node {
  name: string;
  build: (lightning: boolean) => ReturnType<typeof stateAt>;
}
function lightningOf(gs: HorseGameStateV2): void {
  (gs as unknown as { publicMemoryDomain: object }).publicMemoryDomain = {
    version: 1,
    speed: 'lightning',
    ante: 'bb',
  };
}
const NODES: Node[] = FIXTURES.flatMap((fx) =>
  fx.actions
    .filter((a) => a.publicNode && fx.hole[String(a.publicNode.actorSeat ?? a.seat)]?.length)
    .map((a) => ({
      name: `${fx.slug}#${a.ord}`,
      build: (lightning: boolean) => {
        const st = stateAt(JSON.parse(JSON.stringify(fx)) as ComplaintFixture, a);
        if (lightning) lightningOf(st.gs);
        return st;
      },
    }))
);

const SEEDS = [11, 23, 37];
function decideAt(node: Node, lightning: boolean, opts: HorseDecideOpts, seed: number) {
  const st = node.build(lightning);
  seedFastRandom(seed);
  HorseMind.reset();
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    mind: false,
    ...LIVE_CATEGORICAL,
    ...opts,
  });
  return JSON.stringify({ action: d.action, amount: d.amount ?? null });
}
function firesAt(node: Node, lightning: boolean, opts: HorseDecideOpts, seed: number): string[] {
  enableBrainTelemetry();
  drainFires();
  decideAt(node, lightning, { ...opts, telemetry: true }, seed);
  return drainFires().map((f) => f.feature);
}

describe('omahaPricedInLightning: the priced scope in the Lightning pools', () => {
  it('the corpus is real PLO4/PLO5 cash decisions', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(8);
    expect(NODES.length).toBeGreaterThanOrEqual(20);
  });

  it('the scope: Lightning is outside unless the option is on; a table is inside either way', () => {
    let lightningNodes = 0;
    for (const n of NODES) {
      const table = n.build(false);
      const pool = n.build(true);
      const inTable = omahaPricedInScope(table.hero, table.gs);
      expect(omahaPricedInScope(table.hero, table.gs, { omahaPricedInLightning: true })).toBe(
        inTable
      );
      expect(omahaPricedInScope(pool.hero, pool.gs)).toBe(false);
      expect(omahaPricedInScope(pool.hero, pool.gs, { omahaPricedInLightning: false })).toBe(false);
      expect(omahaPricedInScope(pool.hero, pool.gs, { omahaPricedInLightning: true })).toBe(
        inTable
      );
      // the raise owners' spot: the categorical rule's own reading never opens
      const spot = omahaRaiseNeedsNutsScope(table.hero, table.gs);
      expect(omahaRaiseNeedsNutsScope(pool.hero, pool.gs)).toBeNull();
      expect(omahaRaiseNeedsNutsScope(pool.hero, pool.gs, true)).toEqual(spot);
      if (inTable) lightningNodes++;
    }
    expect(lightningNodes).toBeGreaterThanOrEqual(20);
  });

  it('OFF: in Lightning the gated priced options change no decision (unset and false alike)', () => {
    for (const n of NODES)
      for (const seed of SEEDS) {
        const base = decideAt(n, true, off, seed);
        expect(decideAt(n, true, on, seed), n.name).toBe(base);
        expect(decideAt(n, true, { ...on, omahaPricedInLightning: false }, seed), n.name).toBe(
          base
        );
      }
  });

  it('ON outside Lightning: every decision is the one without it', () => {
    for (const n of NODES)
      for (const seed of SEEDS)
        expect(decideAt(n, false, { ...on, omahaPricedInLightning: true }, seed), n.name).toBe(
          decideAt(n, false, on, seed)
        );
  });

  it('ON with no priced option on: nothing changes in Lightning', () => {
    for (const n of NODES)
      for (const seed of SEEDS)
        expect(decideAt(n, true, { ...off, omahaPricedInLightning: true }, seed), n.name).toBe(
          decideAt(n, true, off, seed)
        );
  });

  it('ON in Lightning: the priced verdicts reach the Lightning decision path', () => {
    let pricedFires = 0;
    let changed = 0;
    let sameAsTable = 0;
    let pricedNodes = 0;
    for (const n of NODES) {
      const seed = SEEDS[0];
      const offFires = firesAt(n, true, on, seed);
      const onFires = firesAt(n, true, { ...on, omahaPricedInLightning: true }, seed);
      // off: no priced receipt and no scope receipt in Lightning
      expect(
        offFires.filter((f) => f.startsWith('omaha_priced_')),
        n.name
      ).toEqual([]);
      const priced = onFires.filter(
        (f) => f.startsWith('omaha_priced_') && f !== 'omaha_priced_in_lightning_scope_seen'
      );
      if (priced.length > 0) {
        pricedNodes++;
        pricedFires += priced.length;
        expect(onFires, n.name).toContain('omaha_priced_in_lightning_scope_seen');
        // the same priced receipts as the same decision at a table
        const tableFires = firesAt(n, false, on, seed).filter(
          (f) => f.startsWith('omaha_priced_') && f !== 'omaha_priced_in_lightning_scope_seen'
        );
        expect(priced.sort(), n.name).toEqual(tableFires.sort());
      }
      const dOff = decideAt(n, true, on, seed);
      const dOn = decideAt(n, true, { ...on, omahaPricedInLightning: true }, seed);
      if (dOn !== dOff) changed++;
      if (dOn === decideAt(n, false, on, seed)) sameAsTable++;
    }
    expect(pricedNodes).toBeGreaterThan(0);
    expect(pricedFires).toBeGreaterThan(0);
    expect(changed).toBeGreaterThan(0);
    expect(sameAsTable).toBeGreaterThan(0);
  });
});

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));

describe('omahaPricedInLightning: the receipt validator', () => {
  // Hand 59416584 turn decision 19 (HorseOmahaPricedReceiptGate.test.ts): 212 owed; the request validated holds a
  // non-nut combo draw.
  const fx = FIXTURES.find((f) => f.slug.includes('top-two-pair-jams-over-a-turn-bet'))!;
  const build = (lightning: boolean, hole: string | null = '4h5h2d6cJs') => {
    const copy = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
    const node = copy.actions.find((a) => a.ord === 19)!;
    if (hole) copy.hole[String(node.seat)] = cards(hole);
    const st = stateAt(copy, node);
    if (lightning) lightningOf(st.gs);
    return st;
  };
  const table = build(false);
  seedFastRandom(7);
  HorseMind.reset();
  // the recorded top two pair: its raise became the call (the decision whose receipt is validated)
  const real = build(false, null);
  const d = structuredClone(
    HorseLogic.decide(real.hero, real.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: false,
      omahaBeatenMadeHandDefense: true,
    })
  ) as HorseDecision;

  it("a priced raise -> call in Lightning is admitted only under the decision's own option", () => {
    expect({ action: d.action, amount: d.amount }).toEqual({ action: 'call', amount: 212 });
    const pool = build(true);
    expect(omahaNutClassNow(pool.hero, pool.gs)).toBe(false);
    // at a table: as before
    expect(omahaPricedAdmitsRaiseToCall(table.hero, table.gs, 212)).toBe(true);
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        player: table.hero,
        gameState: table.gs,
        omahaPricedRaise: true,
      })
    ).toBeNull();
    // in Lightning: refused without the option, admitted with it
    expect(omahaPricedAdmitsRaiseToCall(pool.hero, pool.gs, 212)).toBe(false);
    expect(omahaPricedAdmitsRaiseToCall(pool.hero, pool.gs, 212, true)).toBe(true);
    const ctx = { player: pool.hero, gameState: pool.gs };
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', { ...ctx, omahaPricedRaise: true })
    ).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        ...ctx,
        omahaPricedRaise: true,
        omahaPricedInLightning: true,
      })
    ).toBeNull();
    // the option alone admits nothing: the priced-raise gate is still needed
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        ...ctx,
        omahaPricedInLightning: true,
      })
    ).toBe('policy_graph');
  });

  it('under the candidate gates: unchanged without the new argument, admitted when it may have been on', () => {
    const ctx = { player: build(true).hero, gameState: build(true).gs };
    expect(
      horseDecisionReceiptRefusalForGates(structuredClone(d), 'plo5', ctx, [false], [true])
    ).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusalForGates(structuredClone(d), 'plo5', ctx, [false], [true], [false])
    ).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusalForGates(structuredClone(d), 'plo5', ctx, [false], [true], [])
    ).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusalForGates(
        structuredClone(d),
        'plo5',
        ctx,
        [false],
        [true],
        [false, true]
      )
    ).toBeNull();
  });

  it('the candidates: the request alone, a bad configuration, a truthy non-boolean', () => {
    expect(omahaPricedInLightningGateCandidates(undefined, null)).toEqual([false]);
    expect(omahaPricedInLightningGateCandidates({ omahaPricedInLightning: true }, null)).toEqual([
      true,
    ]);
    expect(omahaPricedInLightningGateCandidates({ omahaPricedInLightning: 1 }, null)).toEqual([
      false,
    ]);
    expect(omahaPricedInLightningGateCandidates({}, { nonsense: true })).toEqual([false]);
  });
});
