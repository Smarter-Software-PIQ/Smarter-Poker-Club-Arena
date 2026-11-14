/**
 * A DEFAULT-OFF HORSE FLAG HAS A LEAGUE CARD (2026-11-12, heads-up lane,
 * HU-AUDIT-002 Phase 2; tightened 2026-11-13, HU-EVAL-010).
 *
 * A decision flag shipped default OFF is promoted only when the nightly
 * league confirms it. `commitUnderPot` shipped OFF on 2026-11-07 and no card
 * dealt it, so nothing could ever confirm it: the flag existed, the gate
 * existed, and the two could never meet. #10688 gave it cards. This law stops
 * the next one: every ledger flag whose note says it is default off must be
 * SWITCHED ON in exactly one arm of some card in LEAGUE_MATCHUPS while the
 * other arm leaves it unset or false, or be the one-arm question of a refused
 * matchup (UNMEASURABLE_MATCHUPS, which writes its reason every night), or be
 * named below. A new default-off flag gets a card in the same PR.
 *
 * What the first version let through (HU-EVAL-010):
 *   - an arm that only set the flag FALSE counted as a card. v55OmahaRiverTripsFlat
 *     passed that way: full_vs_v2_legacy turns it off in its legacy arm and no
 *     card turns it on. It is now covered by what it really has, the refused
 *     matchup that states why self-play cannot reach it.
 *   - the note had to say "default OFF" with a space. Four flags noted
 *     "default-off" were never seen. They are listed apart from the original
 *     fifteen, for their owners.
 *   - the list was a literal in this file, so it could grow. Both lists are
 *     now held inside a frozen snapshot whose contents are hash-pinned: a name
 *     can leave a list, none can join one.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HORSE_DATA_LEDGER } from '../engine/HorseDataLedger.js';
import { LEAGUE_MATCHUPS, UNMEASURABLE_MATCHUPS } from './HorseLeague.js';

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

/** Noted "default-off" (hyphen), unseen until 2026-11-13 (main 1c009e34), and
 *  undealt. Owned by other lanes; listed, not fixed, here. */
const UNDEALT_WHEN_WIDENED = new Set([
  'barrelContinuationOutlook',
  'smallPotNearNutRiverValue',
  'multiwayRiverBluffCheckRaise',
  'v53PloTourneyIcm',
]);

const SNAPSHOT_PATH = resolve(
  process.cwd(),
  'src/benchmark/fixtures/default-off-flags-undealt.snapshot.json'
);
/** sha256 of the snapshot's two lists, each sorted. Changing the snapshot
 *  changes this; neither is edited to add a name. */
const SNAPSHOT_SHA256 = 'b788355487eb6f674f181f52ad9ddc8d1cdb2a73195bfa1d36f077900553e408';

const snapshot = (): { undealtWhenWritten: string[]; undealtWhenWidened: string[] } =>
  JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

const defaultOff = () =>
  HORSE_DATA_LEDGER.filter((e) => e.kind === 'flag' && /default[- ]off/i.test(e.note)).map(
    (e) => e.key
  );

type Arms = { a?: object; b?: object };
const on = (v: unknown) => v !== undefined && v !== null && v !== false && v !== 0 && v !== 'off';
const offOrUnset = (v: unknown) => v === undefined || v === false;

/** The flags a set of matchups switches on in exactly one arm, the other arm
 *  leaving the flag unset or false: the only shape that measures the flag. */
const switchedOnInOneArm = (matchups: readonly Arms[]): Set<string> => {
  const keys = new Set<string>();
  for (const m of matchups) {
    const a = (m.a ?? {}) as Record<string, unknown>;
    const b = (m.b ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if ((on(a[k]) && offOrUnset(b[k])) || (on(b[k]) && offOrUnset(a[k]))) keys.add(k);
    }
  }
  return keys;
};

const dealt = () => switchedOnInOneArm(LEAGUE_MATCHUPS);
const refused = () => switchedOnInOneArm(UNMEASURABLE_MATCHUPS);
const listed = (k: string) => UNDEALT_WHEN_WRITTEN.has(k) || UNDEALT_WHEN_WIDENED.has(k);

describe('a default-off Horse flag has a league card', () => {
  it('finds the default-off flags it is meant to guard, however the note spells it', () => {
    const off = defaultOff();
    expect(off).toContain('huBbDefendsToPrice');
    expect(off).toContain('commitUnderPot');
    expect(off).toContain('v55OmahaRiverTripsFlat');
    expect(off).toContain('v53PloTourneyIcm');
    expect(new Set(off).size).toBe(off.length);
  });

  it('only an arm that switches the flag on, against an arm that does not, is a card', () => {
    const only = (a: object, b: object) => [...switchedOnInOneArm([{ a, b }])];
    expect(only({ x: true }, {})).toEqual(['x']);
    expect(only({}, { x: true })).toEqual(['x']);
    expect(only({ x: true }, { x: false })).toEqual(['x']);
    // Turning it off in one arm measures nothing about turning it on.
    expect(only({ x: false }, {})).toEqual([]);
    expect(only({}, { x: false })).toEqual([]);
    expect(only({ x: false }, { x: false })).toEqual([]);
    // On in both arms is one configuration twice: no experiment.
    expect(only({ x: true }, { x: true })).toEqual([]);
    expect(only({ x: 'off' }, {})).toEqual([]);
  });

  it('every default-off flag is switched on by a card, refused with a reason, or listed', () => {
    const cards = dealt();
    const refusals = refused();
    const missing = defaultOff().filter((k) => !cards.has(k) && !refusals.has(k) && !listed(k));
    expect(missing).toEqual([]);
  });

  it('a flag a card only turns off is not counted as dealt', () => {
    // full_vs_v2_legacy sets it false in its legacy arm; nothing sets it true.
    const setFalseSomewhere = LEAGUE_MATCHUPS.some((m) =>
      [m.a, m.b].some((arm) => (arm as Record<string, unknown>)?.v55OmahaRiverTripsFlat === false)
    );
    expect(setFalseSomewhere).toBe(true);
    expect(dealt().has('v55OmahaRiverTripsFlat')).toBe(false);
    // What it has instead: a refused matchup that deals the question and says why not.
    expect(refused().has('v55OmahaRiverTripsFlat')).toBe(true);
    const refusal = UNMEASURABLE_MATCHUPS.find(
      (m) => (m.a as Record<string, unknown>).v55OmahaRiverTripsFlat === true
    );
    expect(refusal?.reason.trim().length ?? 0).toBeGreaterThan(40);
  });

  it('the frozen lists only shrink: a listed flag that gains a card leaves its list', () => {
    const cards = dealt();
    const off = new Set(defaultOff());
    const stale = [...UNDEALT_WHEN_WRITTEN, ...UNDEALT_WHEN_WIDENED].filter(
      (k) => cards.has(k) || !off.has(k)
    );
    expect(stale).toEqual([]);
  });

  it('the frozen lists cannot grow: each stays inside its hash-pinned snapshot', () => {
    const snap = snapshot();
    const digest = createHash('sha256')
      .update(
        JSON.stringify([[...snap.undealtWhenWritten].sort(), [...snap.undealtWhenWidened].sort()])
      )
      .digest('hex');
    expect(digest, 'the snapshot was edited; it is frozen, lists only shrink').toBe(
      SNAPSHOT_SHA256
    );
    expect(snap.undealtWhenWritten).toHaveLength(15);
    expect(snap.undealtWhenWidened).toHaveLength(4);
    const written = new Set(snap.undealtWhenWritten);
    const widened = new Set(snap.undealtWhenWidened);
    expect([...UNDEALT_WHEN_WRITTEN].filter((k) => !written.has(k))).toEqual([]);
    expect([...UNDEALT_WHEN_WIDENED].filter((k) => !widened.has(k))).toEqual([]);
    expect(UNDEALT_WHEN_WRITTEN.size).toBeLessThanOrEqual(15);
    expect(UNDEALT_WHEN_WIDENED.size).toBeLessThanOrEqual(4);
    // No name is on both lists, and the lists name default-off flags only.
    expect([...UNDEALT_WHEN_WIDENED].filter((k) => UNDEALT_WHEN_WRITTEN.has(k))).toEqual([]);
  });

  it('the heads-up flags this law was written for are switched on by a card', () => {
    const cards = dealt();
    expect(cards.has('huBbDefendsToPrice')).toBe(true);
    expect(cards.has('commitUnderPot')).toBe(true);
  });
});
