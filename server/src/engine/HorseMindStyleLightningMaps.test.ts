/**
 * L-016 (2026-11-15): the style learner's Lightning-only maps. A hand whose speed is 'lightning' is filed into the
 * pooled maps exactly as before AND into three Lightning-only maps with the same keys; each Lightning map has its own
 * cap (STYLE_LIGHTNING_MAX_ROWS), so filling it never evicts a pooled row and the pooled eviction order is unchanged.
 * The imports fill the Lightning maps only when asked to ('lightning'); the default target is the pooled map.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { emptyStreetAggression, type StreetAggression } from './HorseOpponentStyle.js';

afterEach(() => HorseMind.reset());

const HORSE = 'eeeeeeee-0000-4000-8000-00000000000e';
const uid = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const map = (name: string) => (HorseMind as any)[name] as Map<string, unknown>;
const keys = (name: string) => [...map(name).keys()];

/** A hand in which `player` bets the river into a Horse that calls (aggression and a river size bucket). */
function hand(player: string, t: number) {
  return [
    {
      stage: 'preflop',
      userId: HORSE,
      action: 'raise',
      amount: 6,
      isFullRaise: true,
      origin: 'horse_policy',
      timestamp: t + 1,
    },
    {
      stage: 'preflop',
      userId: player,
      action: 'call',
      amount: 6,
      origin: 'player',
      timestamp: t + 2,
    },
    {
      stage: 'flop',
      userId: player,
      action: 'check',
      amount: 0,
      origin: 'player',
      timestamp: t + 3,
    },
    {
      stage: 'flop',
      userId: HORSE,
      action: 'check',
      amount: 0,
      origin: 'horse_policy',
      timestamp: t + 4,
    },
    {
      stage: 'turn',
      userId: player,
      action: 'bet',
      amount: 8,
      isFullRaise: true,
      origin: 'player',
      timestamp: t + 5,
    },
    {
      stage: 'turn',
      userId: HORSE,
      action: 'call',
      amount: 8,
      origin: 'horse_policy',
      timestamp: t + 6,
    },
    {
      stage: 'river',
      userId: player,
      action: 'bet',
      amount: 20,
      isFullRaise: true,
      origin: 'player',
      timestamp: t + 7,
    },
    {
      stage: 'river',
      userId: HORSE,
      action: 'call',
      amount: 20,
      origin: 'horse_policy',
      timestamp: t + 8,
    },
  ];
}
function learn(player: string, n: number, speed?: 'table' | 'lightning'): void {
  HorseMind.observeHandComplete(
    `t:${n}`,
    hand(player, n * 100),
    2,
    [{ user_id: player, mucked: false, hand_name: 'Flush' }],
    'holdem:hu',
    false,
    { variant: 'nlh', boardCount: 1 } as never,
    undefined,
    'cash',
    true,
    speed
  );
}

describe('the style learner keeps Lightning-only maps beside the pooled ones', () => {
  it('a Lightning hand fills both; a table-speed or speedless hand fills the pooled maps only', () => {
    learn(uid(1), 1, 'table');
    learn(uid(2), 2);
    expect(map('styleAggressionLightning').size).toBe(0);
    expect(map('styleSizeShownLightning').size).toBe(0);
    expect(map('styleHorseReferenceLightning').size).toBe(0);
    learn(uid(3), 3, 'lightning');
    const k = `nlh|cash|hu|${uid(3)}`;
    const kh = `nlh|cash|hu|${HORSE}`;
    expect(keys('styleAggressionLightning')).toEqual([k, kh]);
    expect(keys('styleSizeShownLightning')).toEqual([k]);
    expect(map('styleAggressionLightning').get(k)).toEqual(map('styleAggression').get(k));
    expect((map('styleAggressionLightning').get(kh) as StreetAggression).river.passive).toBe(1);
    expect((map('styleAggression').get(kh) as StreetAggression).river.passive).toBe(3);
    expect(map('styleSizeShownLightning').get(k)).toEqual(map('styleSizeShown').get(k));
    // the Horse reference: three hands pooled, one in Lightning
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'hu')?.river.passive).toBe(3);
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'hu', 'lightning')?.river.passive).toBe(
      1
    );
    expect(keys('styleAggression').sort()).toEqual(
      [`nlh|cash|hu|${uid(1)}`, `nlh|cash|hu|${uid(2)}`, k, kh].sort()
    );
  });

  it('each Lightning map is capped on its own: filling it past the cap never evicts a pooled row', () => {
    const cap = HorseMind.STYLE_LIGHTNING_MAX_ROWS;
    expect(cap).toBe(4000);
    // pooled rows: table speed, oldest first
    const pooledRows = Array.from({ length: 10 }, (_, i) => ({
      user_id: uid(100_000 + i),
      variant: 'nlh',
      mode: 'cash' as const,
      size: 'full' as const,
      aggression: emptyStreetAggression(),
    }));
    HorseMind.importStyleAggression(pooledRows);
    HorseMind.importSizeBuckets(
      pooledRows.map((r) => ({ ...r, buckets: { big: { bets: 1, shown: 0, strong: 0 } } as never }))
    );
    const pooledBefore = JSON.stringify([
      ...map('styleAggression').entries(),
      ...map('styleSizeShown').entries(),
    ]);
    // Lightning rows: more than the cap; the oldest are evicted from the Lightning map only
    const lightningRows = Array.from({ length: cap + 25 }, (_, i) => ({
      user_id: uid(i),
      variant: 'nlh',
      mode: 'cash' as const,
      size: 'full' as const,
      aggression: emptyStreetAggression() as StreetAggression,
    }));
    expect(HorseMind.importStyleAggression(lightningRows, 'lightning')).toBe(cap + 25);
    HorseMind.importSizeBuckets(
      lightningRows.map((r) => ({
        ...r,
        buckets: { big: { bets: 1, shown: 0, strong: 0 } } as never,
      })),
      'lightning'
    );
    for (const n of ['styleAggressionLightning', 'styleSizeShownLightning']) {
      expect(map(n).size, n).toBe(cap);
      expect(map(n).has(`nlh|cash|full|${uid(0)}`), n).toBe(false);
      expect(map(n).has(`nlh|cash|full|${uid(24)}`), n).toBe(false);
      expect(map(n).has(`nlh|cash|full|${uid(25)}`), n).toBe(true);
    }
    expect(
      JSON.stringify([...map('styleAggression').entries(), ...map('styleSizeShown').entries()])
    ).toBe(pooledBefore);
    // the live learner honours the same cap
    learn(uid(999_999), 9, 'lightning');
    expect(map('styleAggressionLightning').size).toBe(cap);
    expect(map('styleAggressionLightning').has(`nlh|cash|hu|${uid(999_999)}`)).toBe(true);
    expect(map('styleAggressionLightning').has(`nlh|cash|full|${uid(25)}`)).toBe(false);
  });

  it('the imports fill the pooled map by default and the Lightning map only when asked', () => {
    const ref = [
      {
        variant: 'nlh',
        mode: 'cash' as const,
        size: 'full' as const,
        reference: emptyStreetAggression(),
      },
    ];
    HorseMind.importStyleHorseReference(ref);
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full')).not.toBeNull();
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full', 'lightning')).toBeNull();
    HorseMind.reset();
    HorseMind.importStyleHorseReference(ref, 'lightning');
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full')).toBeNull();
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full', 'lightning')).not.toBeNull();
  });

  it('reset and the harness clear empty the Lightning maps too', () => {
    learn(uid(1), 1, 'lightning');
    HorseMind.enableHarnessStyleLearning(true);
    try {
      HorseMind.clearHarnessStyleMemory();
    } finally {
      HorseMind.enableHarnessStyleLearning(false);
    }
    for (const n of [
      'styleAggressionLightning',
      'styleSizeShownLightning',
      'styleHorseReferenceLightning',
    ])
      expect(map(n).size, n).toBe(0);
    learn(uid(1), 2, 'lightning');
    HorseMind.reset();
    expect(map('styleAggressionLightning').size).toBe(0);
  });
});
