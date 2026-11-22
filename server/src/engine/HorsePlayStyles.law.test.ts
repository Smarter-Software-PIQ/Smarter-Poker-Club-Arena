/**
 * LAW: horsePlayStyles strict default-OFF gate, deterministic assignment, and safety fallbacks.
 *
 * Pins the four core invariants of the shared Horse playing style option
 * (`HorsePlayStyle.ts`, `HorseOmahaPlayStyle.ts`, `HorseLogic.ts`; default OFF):
 *  1. `HorseLogic.ts` reads `opts.horsePlayStyles` in exactly one place, as a
 *     strict boolean gate (`opts.horsePlayStyles !== true` returns `'current'`).
 *  2. Default OFF: unset, explicit `false`, and truthy non-boolean values decide
 *     byte-identically to baseline (even with `horsePlayStyleForce` set) and emit
 *     zero `horse_play_style_*` telemetry receipts.
 *  3. Deterministic per-seat assignment: `HORSE_PLAY_STYLE_SALT` stays pinned to
 *     `'horse_play_style_v1'`, 15,000 synthetic IDs split into uniform thirds,
 *     canonical seat IDs keep their pinned styles, and only valid authored
 *     `playStyle` strings override the hash.
 *  4. Safety-boundary and unmapped-game fallbacks: `tight` and `pressure` fall
 *     back to `'current'` with exact receipts on unmapped games (NLH, PLO6, hi-lo,
 *     heads-up, bomb pots, All-In-Or-Fold), tournaments, Lightning, stacks <= 50bb,
 *     and `tight` (and only `tight`) on VPIP floors above `tightExpectedVpipPct`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OMAHA_TIGHT_EXPECTED_VPIP_PCT, omahaPlayStyleMapped } from './HorseOmahaPlayStyle.js';
import { personaFromValue } from './HorsePersona.js';
import {
  HORSE_PLAY_STYLES,
  HORSE_PLAY_STYLE_MIN_EFFECTIVE_BB,
  HORSE_PLAY_STYLE_SALT,
  horsePlayStyleAtTable,
  horsePlayStyleFallback,
  horsePlayStyleFor,
  horsePlayStyleReceipt,
  isHorsePlayStyle,
  type HorsePlayStyle,
  type HorsePlayStyleTable,
} from './HorsePlayStyle.js';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import RECORDED from './HorseOmahaUnderpair.fixture.json';

const FX = RECORDED as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const FIXED_TIME_MS = Date.UTC(2026, 10, 21, 12, 0, 0);

function syntheticUuid(i: number): string {
  const h = (n: number, w: number) => (n >>> 0).toString(16).padStart(w, '0').slice(-w);
  return `${h(i * 2654435761, 8)}-${h(i * 40503, 4)}-4${h(i * 97, 3)}-a${h(i * 31, 3)}-${h(i * 7919, 8)}${h(i, 4)}`;
}

function plo5DeepButtonFirstIn(
  overGs?: (gs: HorseGameStateV2) => void,
  overSeats?: (pn: ComplaintPublicNode) => void,
  hole = 'KhQhJsTs9c'
) {
  const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  const pn = JSON.parse(
    JSON.stringify(fx.actions.find((a) => a.ord === 7)!.publicNode)
  ) as ComplaintPublicNode;
  const acts = fx.actions.slice(0, 3);
  const add = (seat: number, action: string, amount: number) =>
    acts.push({
      ord: acts.length + 1,
      seat,
      stage: 'preflop',
      action,
      amount,
      origin: 'horse_policy',
      isFullRaise: false,
      dead: false,
    });
  for (const s of [1, 2, 3]) add(s, 'fold', 0);
  pn.seats = [
    [1, 1426.9, 0, 0, 0, 0, 1],
    [2, 1172.95, 0, 0, 0, 0, 1],
    [3, 400, 0, 0, 0, 0, 1],
    [4, 400.4, 0, 0, 0, 0, 0],
    [5, 379.65, 1, 1, 0, 0, 0],
    [6, 795.5, 2, 4, 2, 0, 0],
  ];
  Object.assign(pn, {
    pot: 5,
    toCall: 2,
    currentBet: 2,
    minRaiseTo: 4,
    maxRaiseTo: 9,
    actorSeat: 4,
  });
  overSeats?.(pn);
  add(4, 'call', 2);
  const node = acts[acts.length - 1];
  node.publicNode = pn;
  fx.actions = acts;
  fx.hole['4'] = cards(hole);
  const st = stateAt(fx, node);
  (st.gs as unknown as { vpipFloor?: number }).vpipFloor = 0;
  overGs?.(st.gs);
  return st;
}

function decideWithFires(
  st: ReturnType<typeof plo5DeepButtonFirstIn>,
  opts: HorseDecideOpts,
  seed = 7101
) {
  return withFrozenDecisionClock(() => {
    enableBrainTelemetry();
    drainFires();
    seedFastRandom(seed);
    const decision = HorseLogic.decide(
      st.hero,
      st.gs,
      LIVE.style,
      { ...LIVE.mods },
      { decisionTimeMs: FIXED_TIME_MS, observeMind: false, mind: false, telemetry: true, ...opts }
    );
    const fires = new Map(drainFires().map((f) => [f.feature, f.fires]));
    return { decision, fires };
  });
}

afterEach(() => {
  drainFires();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('LAW: horsePlayStyles invariant 1 - single strict boolean read in HorseLogic.ts', () => {
  it('reads opts.horsePlayStyles in exactly one place, as a strict !== true gate', () => {
    const src = readFileSync(fileURLToPath(new URL('./HorseLogic.ts', import.meta.url)), 'utf8');
    const reads = src.match(/opts\.horsePlayStyles\b[^\n]*/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("opts.horsePlayStyles !== true) return 'current'");
  });
});

describe('LAW: horsePlayStyles invariant 2 - default-OFF zero effect and zero receipts', () => {
  it('unset, explicit false, and truthy non-boolean values match baseline and emit zero horse_play_style_* receipts', () => {
    const offVariants: readonly HorseDecideOpts[] = [
      { horsePlayStyles: false },
      { horsePlayStyles: false, horsePlayStyleForce: 'tight' },
      { horsePlayStyles: false, horsePlayStyleForce: 'pressure' },
      { horsePlayStyleForce: 'tight' },
      { horsePlayStyles: 'yes' as unknown as boolean, horsePlayStyleForce: 'tight' },
      { horsePlayStyles: 1 as unknown as boolean, horsePlayStyleForce: 'pressure' },
    ];

    for (const seed of [7101, 7102, 7103]) {
      const base = decideWithFires(plo5DeepButtonFirstIn(), {}, seed);
      const baseStyleFires = [...base.fires.keys()].filter((k) =>
        k.startsWith('horse_play_style_')
      );
      expect(baseStyleFires).toEqual([]);

      for (const opts of offVariants) {
        const res = decideWithFires(plo5DeepButtonFirstIn(), opts, seed);
        expect(res.decision).toEqual(base.decision);
        const styleFires = [...res.fires.keys()].filter((k) => k.startsWith('horse_play_style_'));
        expect(styleFires).toEqual([]);
      }
    }

    // Sanity check: turning horsePlayStyles on DOES emit its per-style receipt on the same spot.
    const onTight = decideWithFires(
      plo5DeepButtonFirstIn(),
      { horsePlayStyles: true, horsePlayStyleForce: 'tight' },
      7101
    );
    expect(onTight.fires.get('horse_play_style_tight')).toBe(1);
  });
});

describe('LAW: horsePlayStyles invariant 3 - deterministic salt pin, uniform thirds, and authored override', () => {
  it('pins HORSE_PLAY_STYLE_SALT, canonical assignments, uniform thirds, and authored override', () => {
    expect(HORSE_PLAY_STYLE_SALT).toBe('horse_play_style_v1');
    expect(HORSE_PLAY_STYLES).toEqual(['tight', 'current', 'pressure']);

    expect(
      ['league-1', 'league-2', 'league-3', 'league-4', 'league-5', 'league-6'].map((id) =>
        horsePlayStyleFor(id)
      )
    ).toEqual(['pressure', 'tight', 'current', 'tight', 'current', 'tight']);

    const counts: Record<HorsePlayStyle, number> = { tight: 0, current: 0, pressure: 0 };
    for (let i = 1; i <= 15_000; i++) {
      const id = syntheticUuid(i);
      const style = horsePlayStyleFor(id);
      if (i <= 500) expect(horsePlayStyleFor(id)).toBe(style);
      counts[style]++;
    }
    for (const style of HORSE_PLAY_STYLES) {
      expect(Math.abs(counts[style] - 5_000)).toBeLessThan(250);
    }

    const sampleId = syntheticUuid(42);
    for (const style of HORSE_PLAY_STYLES) {
      expect(horsePlayStyleFor(sampleId, style)).toBe(style);
      expect(personaFromValue({ playStyle: style }, sampleId).playStyle).toBe(style);
    }
    for (const invalid of [undefined, null, '', 'TIGHT', 'lag', 'hybrid', 1, true, {}, ['tight']]) {
      expect(horsePlayStyleFor(sampleId, invalid)).toBe(horsePlayStyleFor(sampleId));
      expect(isHorsePlayStyle(invalid)).toBe(false);
    }
    expect('playStyle' in personaFromValue({ playStyle: 'loose' }, sampleId)).toBe(false);
  });
});

describe('LAW: horsePlayStyles invariant 4 - safety-boundary and unmapped-game fallbacks', () => {
  const baseTable = (over: Partial<HorsePlayStyleTable> = {}): HorsePlayStyleTable => ({
    vpipFloorPct: 0,
    tournament: false,
    lightning: false,
    effectiveStackBB: 100,
    tightExpectedVpipPct: OMAHA_TIGHT_EXPECTED_VPIP_PCT.plo5,
    ...over,
  });

  it('pins omahaPlayStyleMapped boundaries and pure fallback receipts', () => {
    expect(
      omahaPlayStyleMapped({ gameVariant: 'plo4', isOmaha: true, isHiLo: false, dealtSeats: 6 })
    ).toBe(true);
    expect(
      omahaPlayStyleMapped({ gameVariant: 'plo5', isOmaha: true, isHiLo: false, dealtSeats: 6 })
    ).toBe(true);
    expect(OMAHA_TIGHT_EXPECTED_VPIP_PCT).toEqual({ plo4: 23, plo5: 24 });

    const unmappedCases = [
      { gameVariant: 'nlh', isOmaha: false, isHiLo: false, dealtSeats: 6 },
      { gameVariant: 'plo6', isOmaha: true, isHiLo: false, dealtSeats: 6 },
      { gameVariant: 'plo8', isOmaha: true, isHiLo: true, dealtSeats: 6 },
      { gameVariant: 'plo5', isOmaha: true, isHiLo: false, dealtSeats: 2 },
      { gameVariant: 'plo5', isOmaha: true, isHiLo: false, dealtSeats: 6, bombPot: true },
      { gameVariant: 'plo5', isOmaha: true, isHiLo: false, dealtSeats: 6, allInOrFold: true },
    ];
    for (const c of unmappedCases) {
      expect(omahaPlayStyleMapped(c)).toBe(false);
    }

    const bothFallbackCases: readonly [Partial<HorsePlayStyleTable>, string][] = [
      [{ tightExpectedVpipPct: null }, 'horse_play_style_fallback_current_unmapped_seen'],
      [{ tournament: true }, 'horse_play_style_fallback_current_tournament_seen'],
      [{ lightning: true }, 'horse_play_style_fallback_current_lightning_seen'],
      [
        { effectiveStackBB: HORSE_PLAY_STYLE_MIN_EFFECTIVE_BB },
        'horse_play_style_fallback_current_short_stack_seen',
      ],
      [{ effectiveStackBB: Number.NaN }, 'horse_play_style_fallback_current_short_stack_seen'],
    ];
    for (const [over, receipt] of bothFallbackCases) {
      for (const s of ['tight', 'pressure'] as const) {
        const fb = horsePlayStyleFallback(s, baseTable(over));
        expect(fb).not.toBeNull();
        expect(horsePlayStyleAtTable(s, baseTable(over))).toBe('current');
        expect(horsePlayStyleReceipt(s, fb)).toBe(receipt);
      }
    }

    // VPIP floor above tightExpectedVpipPct forces only tight to current; pressure keeps playing.
    const floorFbTight = horsePlayStyleFallback('tight', baseTable({ vpipFloorPct: 50 }));
    expect(floorFbTight).toBe('vpip_floor');
    expect(horsePlayStyleAtTable('tight', baseTable({ vpipFloorPct: 50 }))).toBe('current');
    expect(horsePlayStyleReceipt('tight', floorFbTight)).toBe(
      'horse_play_style_fallback_current_floor_seen'
    );
    expect(horsePlayStyleFallback('pressure', baseTable({ vpipFloorPct: 50 }))).toBeNull();
    expect(horsePlayStyleAtTable('pressure', baseTable({ vpipFloorPct: 50 }))).toBe('pressure');
  });

  it('enforces safety-boundary and unmapped-game fallbacks end-to-end in HorseLogic.decide', () => {
    // 1. Tight on a 50% VPIP floored table falls back to current and emits floor fallback receipt.
    const floorCurrent = decideWithFires(
      plo5DeepButtonFirstIn((gs) => {
        (gs as unknown as { vpipFloor?: number }).vpipFloor = 50;
      }),
      { horsePlayStyles: true, horsePlayStyleForce: 'current' },
      7201
    );
    const floorTight = decideWithFires(
      plo5DeepButtonFirstIn((gs) => {
        (gs as unknown as { vpipFloor?: number }).vpipFloor = 50;
      }),
      { horsePlayStyles: true, horsePlayStyleForce: 'tight' },
      7201
    );
    expect(floorTight.decision).toEqual(floorCurrent.decision);
    expect(floorTight.fires.get('horse_play_style_fallback_current_floor_seen')).toBe(1);
    expect(floorTight.fires.get('horse_play_style_tight')).toBeUndefined();

    // 2. Short stack (<= 50bb) falls back to current.
    const shortMut = (pn: ComplaintPublicNode) => {
      pn.seats = pn.seats.map((row) => [row[0], 80, row[2], row[3], row[4], row[5], row[6]]);
    };
    const shortCurrent = decideWithFires(
      plo5DeepButtonFirstIn(undefined, shortMut),
      { horsePlayStyles: true, horsePlayStyleForce: 'current' },
      7202
    );
    const shortPressure = decideWithFires(
      plo5DeepButtonFirstIn(undefined, shortMut),
      { horsePlayStyles: true, horsePlayStyleForce: 'pressure' },
      7202
    );
    expect(shortPressure.decision).toEqual(shortCurrent.decision);
    expect(shortPressure.fires.get('horse_play_style_fallback_current_short_stack_seen')).toBe(1);
    expect(shortPressure.fires.get('horse_play_style_pressure')).toBeUndefined();

    // 3. Tournament falls back to current.
    const tourneyMut = (gs: HorseGameStateV2) => {
      (gs as unknown as { gameMode?: string; format?: string }).gameMode = 'tournament';
      (gs as unknown as { format?: string }).format = 'mtt';
    };
    const tourneyCurrent = decideWithFires(
      plo5DeepButtonFirstIn(tourneyMut),
      { horsePlayStyles: true, horsePlayStyleForce: 'current' },
      7203
    );
    const tourneyPressure = decideWithFires(
      plo5DeepButtonFirstIn(tourneyMut),
      { horsePlayStyles: true, horsePlayStyleForce: 'pressure' },
      7203
    );
    expect(tourneyPressure.decision).toEqual(tourneyCurrent.decision);
    expect(tourneyPressure.fires.get('horse_play_style_fallback_current_tournament_seen')).toBe(1);

    // 4. Lightning falls back to current.
    const lightningMut = (gs: HorseGameStateV2) => {
      (gs as unknown as { publicMemoryDomain?: { speed?: string } }).publicMemoryDomain = {
        speed: 'lightning',
      };
    };
    const lightCurrent = decideWithFires(
      plo5DeepButtonFirstIn(lightningMut),
      { horsePlayStyles: true, horsePlayStyleForce: 'current' },
      7204
    );
    const lightTight = decideWithFires(
      plo5DeepButtonFirstIn(lightningMut),
      { horsePlayStyles: true, horsePlayStyleForce: 'tight' },
      7204
    );
    expect(lightTight.decision).toEqual(lightCurrent.decision);
    expect(lightTight.fires.get('horse_play_style_fallback_current_lightning_seen')).toBe(1);

    // 5. Unmapped game (NLH) falls back to current.
    const nlhMut = (gs: HorseGameStateV2) => {
      gs.gameVariant = 'nlh';
      for (const p of gs.players) p.cards = p.cards.slice(0, 2);
    };
    const nlhCurrent = decideWithFires(
      plo5DeepButtonFirstIn(nlhMut, undefined, 'AsKd'),
      { horsePlayStyles: true, horsePlayStyleForce: 'current' },
      7205
    );
    const nlhPressure = decideWithFires(
      plo5DeepButtonFirstIn(nlhMut, undefined, 'AsKd'),
      { horsePlayStyles: true, horsePlayStyleForce: 'pressure' },
      7205
    );
    expect(nlhPressure.decision).toEqual(nlhCurrent.decision);
    expect(nlhPressure.fires.get('horse_play_style_fallback_current_unmapped_seen')).toBe(1);
    expect(nlhPressure.fires.get('horse_play_style_pressure')).toBeUndefined();
  });
});
