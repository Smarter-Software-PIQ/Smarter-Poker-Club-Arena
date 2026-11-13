/**
 * A DEFAULT-OFF HORSE FLAG HAS A LEAGUE CARD (2026-11-12, heads-up lane,
 * HU-AUDIT-002 Phase 2).
 *
 * A decision flag shipped default OFF is promoted only when the nightly
 * league confirms it. `commitUnderPot` shipped OFF on 2026-11-07 and no card
 * dealt it, so nothing could ever confirm it: the flag existed, the gate
 * existed, and the two could never meet. #10688 gave it cards. This law stops
 * the next one: every ledger flag whose note says "default OFF" must be set by
 * an arm of some card in LEAGUE_MATCHUPS, or be named below with the reason it
 * has none. The list is the set found undealt when this law was written; it
 * may only shrink. A new default-off flag gets a card in the same PR.
 */
import { describe, expect, it } from 'vitest';
import { HORSE_DATA_LEDGER } from '../engine/HorseDataLedger.js';
import { LEAGUE_MATCHUPS } from './HorseLeague.js';

/** Undealt on 2026-11-12 (main 08dcfa90). Owned by other lanes; listed, not fixed, here. */
const UNDEALT_WHEN_WRITTEN = new Set([
  'v16Ratio',
  'omahaPreflopCallWithActionBehind',
  'vpipFloorDeepStackOff',
  'styleValueBettorNotManiac',
  'styleBigBetHonesty',
  'styleRaiseRespect',
  'styleTightReRaiserRespect',
  'styleFoldRatePreRepair',
  'styleValueExtraction',
  'styleFoldBluff',
  'readScopedShrink',
  'nashPushFoldIcm',
  'comboDrawPressure',
  'riverBluffCheckRaise',
  'riverPositionDefense',
]);

const defaultOff = () =>
  HORSE_DATA_LEDGER.filter((e) => e.kind === 'flag' && /default OFF/i.test(e.note)).map(
    (e) => e.key
  );

const dealt = () => {
  const keys = new Set<string>();
  for (const m of LEAGUE_MATCHUPS)
    for (const arm of [m.a, m.b]) for (const k of Object.keys(arm ?? {})) keys.add(k);
  return keys;
};

describe('a default-off Horse flag has a league card', () => {
  it('finds the default-off flags it is meant to guard', () => {
    const off = defaultOff();
    expect(off).toContain('huBbDefendsToPrice');
    expect(off).toContain('commitUnderPot');
  });

  it('every default-off flag is dealt by a card or named in the frozen list', () => {
    const cards = dealt();
    const missing = defaultOff().filter((k) => !cards.has(k) && !UNDEALT_WHEN_WRITTEN.has(k));
    expect(missing).toEqual([]);
  });

  it('the frozen list only shrinks: a listed flag that gains a card leaves the list', () => {
    const cards = dealt();
    const off = new Set(defaultOff());
    const stale = [...UNDEALT_WHEN_WRITTEN].filter((k) => cards.has(k) || !off.has(k));
    expect(stale).toEqual([]);
  });

  it('the heads-up flags this law was written for are dealt', () => {
    const cards = dealt();
    expect(cards.has('huBbDefendsToPrice')).toBe(true);
    expect(cards.has('commitUnderPot')).toBe(true);
  });
});
