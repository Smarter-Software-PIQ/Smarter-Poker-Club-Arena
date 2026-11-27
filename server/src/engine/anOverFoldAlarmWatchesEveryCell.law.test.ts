/**
 * LAW: THE OVER-FOLD ALARM WATCHES EVERY CELL, AND ITS OWNER MAP NAMES ONLY REAL OPTIONS
 * (2026-11-27, PLO-OWNER + Hold'em owner lead-8, lane ALARM).
 *
 * The Horses' over-folding was "fixed" and came back several times. The first daily alarm (2026-11-26) watched
 * only PLO heads-up turn and river; the over-folds measured that week on the heads-up flop, multiway and in
 * Hold'em were watched by nothing, so they could come back unseen. This law keeps the alarm whole:
 *
 *  1. scripts/ops/horse-overfold-owner-map.json names, for a cell's fix, only an option that is registered
 *     (OPTION_SWITCH_NAMES) or that it lists under awaitingRegistration with the pull request that registers it;
 *     an awaiting entry names an option some owner entry uses; games, streets, players and sizes are the alarm's
 *     own vocabulary. (A typo here would report a regression as "fix OFF" for ever.)
 *  2. the alarm's cells are every game group x flop / turn / river x heads-up / multiway x three sizes and the
 *     all-sizes row, and the daily audit still runs it (the constants are read from the script's source: this
 *     test imports no script). Heads-up cells gate on the people-measured ceiling; multiway gates on the
 *     fold-through of a person's first bet into Horses (3-way, 4-way+) against the pure-bluff break-even, and a
 *     multiway decision cell (a people fold rate) is information only and never gates.
 *  3. the alarm only reads: its SQL goes through the read-only runner, and it reads no HUD row.
 * Cheap: it reads four files and the option registry.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPTION_SWITCH_NAMES } from './HorseOptionSwitch.js';

const REPO = join(__dirname, '..', '..', '..');
const OPS = join(REPO, 'scripts', 'ops');
const read = (f: string): string => readFileSync(join(OPS, f), 'utf8');

interface OwnerEntry {
  option: string;
  games: string[];
  streets: string[];
  fields: string[];
  sizes: string[];
}
interface OwnerMap {
  owners: OwnerEntry[];
  awaitingRegistration?: Record<string, string>;
}

const GAMES = ['plo4', 'plo5', 'nlh', 'nlh-mtt'];
const STREETS = ['flop', 'turn', 'river'];
const FIELDS = ['hu', 'mw'];
const SIZES = ['small', 'mid', 'large'];

/** What is wrong with an owner map against the registered option names (empty = it obeys the law). */
export function ownerMapProblems(map: OwnerMap, registered: readonly string[]): string[] {
  const out: string[] = [];
  const awaiting = map.awaitingRegistration ?? {};
  const used = new Set<string>();
  if (!Array.isArray(map.owners) || !map.owners.length) return ['the owner map has no owners'];
  for (const o of map.owners) {
    used.add(o.option);
    if (!registered.includes(o.option) && !Object.hasOwn(awaiting, o.option))
      out.push(
        `${o.option}: not a registered option, and not listed under awaitingRegistration with its pull request`
      );
    const bad = (name: string, got: unknown, allowed: string[]): void => {
      if (!Array.isArray(got) || !got.length || got.some((x) => !allowed.includes(String(x))))
        out.push(`${o.option}: ${name} must be a non-empty list of ${allowed.join(' / ')}`);
    };
    bad('games', o.games, GAMES);
    bad('streets', o.streets, STREETS);
    bad('fields', o.fields, FIELDS);
    bad('sizes', o.sizes, SIZES);
  }
  for (const [name, why] of Object.entries(awaiting)) {
    if (!used.has(name)) out.push(`awaitingRegistration ${name}: no owner entry uses it`);
    if (!/^PR #\d+$/.test(String(why)))
      out.push(`awaitingRegistration ${name}: must say the pull request ("PR #<number>")`);
  }
  // two options owning the same cell would make "is the fix ON" ambiguous
  const seen = new Map<string, string>();
  for (const o of map.owners)
    for (const g of o.games ?? [])
      for (const s of o.streets ?? [])
        for (const f of o.fields ?? [])
          for (const z of o.sizes ?? []) {
            const key = `${g}|${s}|${f}|${z}`;
            const prev = seen.get(key);
            if (prev && prev !== o.option)
              out.push(`${key}: owned by both ${prev} and ${o.option}`);
            seen.set(key, o.option);
          }
  return out;
}

describe('the over-fold alarm watches every cell and its owner map names only real options', () => {
  const map = JSON.parse(read('horse-overfold-owner-map.json')) as OwnerMap;
  const lib = read('horse-plo-overfold-gate-lib.mjs');
  const tool = read('horse-plo-overfold-gate.mjs');

  it('the committed owner map obeys the law', () => {
    expect(ownerMapProblems(map, OPTION_SWITCH_NAMES)).toEqual([]);
    // the three fixes the owner named on 2026-11-26 each own their cells
    const of = (g: string, s: string, f: string, z: string): string | null =>
      map.owners.find(
        (o) =>
          o.games.includes(g) &&
          o.streets.includes(s) &&
          o.fields.includes(f) &&
          o.sizes.includes(z)
      )?.option ?? null;
    for (const g of ['plo4', 'plo5']) {
      expect(of(g, 'turn', 'hu', 'large')).toBe('omahaFacingBetPriorIsPeopleMeasured');
      expect(of(g, 'river', 'hu', 'small')).toBe('omahaFacingBetPriorIsPeopleMeasured');
      expect(of(g, 'flop', 'hu', 'large')).toBe('omahaFlopPressureCapIsPriced');
      expect(of(g, 'turn', 'mw', 'mid')).toBe('omahaMultiwayFieldIsPeopleMeasured');
      expect(of(g, 'river', 'mw', 'mid')).toBe('omahaMultiwayFieldIsPeopleMeasured');
      expect(of(g, 'flop', 'mw', 'mid')).toBeNull();
    }
    expect(of('nlh', 'river', 'hu', 'large')).toBeNull();
    // the option the first alarm was built for is registered, not merely awaited
    expect(OPTION_SWITCH_NAMES).toContain('omahaFacingBetPriorIsPeopleMeasured');
  });

  it('the law bites: an unknown option, a stale awaiting entry, a bad vocabulary and a double owner are each named', () => {
    const ok: OwnerEntry = {
      option: 'aRealOption',
      games: ['plo5'],
      streets: ['turn'],
      fields: ['hu'],
      sizes: ['large'],
    };
    expect(ownerMapProblems({ owners: [ok] }, ['aRealOption'])).toEqual([]);
    expect(ownerMapProblems({ owners: [ok] }, [])[0]).toMatch(/not a registered option/);
    expect(
      ownerMapProblems({ owners: [ok], awaitingRegistration: { aRealOption: 'PR #1' } }, [])
    ).toEqual([]);
    expect(
      ownerMapProblems({ owners: [ok], awaitingRegistration: { aRealOption: 'soon' } }, [])[0]
    ).toMatch(/must say the pull request/);
    expect(
      ownerMapProblems({ owners: [ok], awaitingRegistration: { other: 'PR #2' } }, [
        'aRealOption',
      ])[0]
    ).toMatch(/no owner entry uses it/);
    expect(
      ownerMapProblems({ owners: [{ ...ok, streets: ['preflop'] }] }, ['aRealOption'])[0]
    ).toMatch(/streets must be/);
    expect(
      ownerMapProblems({ owners: [ok, { ...ok, option: 'another' }] }, [
        'aRealOption',
        'another',
      ])[0]
    ).toMatch(/owned by both aRealOption and another/);
    expect(ownerMapProblems({ owners: [] }, [])).toEqual(['the owner map has no owners']);
  });

  it('the alarm has every cell and the daily audit runs it', () => {
    for (const key of [
      "key: 'plo5'",
      "key: 'plo4'",
      "key: 'plo'",
      "key: 'nlh-cash'",
      "key: 'nlh-mtt'",
    ])
      expect(lib).toContain(key);
    expect(lib).toMatch(/export const STREETS = Object\.freeze\(\['flop', 'turn', 'river'\]\)/);
    expect(lib).toMatch(/\{ key: 'hu', label: 'heads-up' \}/);
    expect(lib).toMatch(/\{ key: 'mw', label: 'multiway' \}/);
    for (const key of ["key: 'small'", "key: 'mid'", "key: 'large'", "key: 'all'"])
      expect(lib).toContain(key);
    // the three ceilings, in order, each with its name in the row
    const iPrior = lib.indexOf("tier: 'people-prior'");
    const iPeople = lib.indexOf("tier: 'people-14d'");
    const iAnchor = lib.indexOf("tier: 'minimum-defence'");
    expect(iPrior).toBeGreaterThan(0);
    expect(iPeople).toBeGreaterThan(iPrior);
    expect(iAnchor).toBeGreaterThan(iPeople);
    // multiway gates on the fold-through of a person's bet against the pure-bluff break-even, never on a people
    // fold rate (people over-call multiway): the multiway decision cells are information only
    expect(lib).toMatch(/infoOnly: f\.key !== 'hu'/);
    expect(lib).toMatch(/tested: f\.key === 'hu' && /);
    for (const key of ["key: '3way'", "key: '4way+'", 'foldthru|', 'breakEvenFold(x.s)'])
      expect(lib).toContain(key);
    expect(lib).toMatch(/tested: pl\.field === 'mw' && w\.n >= FT_MIN_N/);
    expect(read('horse-daily-audit-lib.mjs')).toContain("script: 'horse-plo-overfold-gate.mjs'");
  });

  it('the alarm only reads, through the read-only runner, people from profiles and never a HUD row', () => {
    const code = `${lib}\n${tool}`
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(tool).toContain("import { queryReadOnly } from './horse-hand-audit-omaha.mjs'");
    expect(read('horse-hand-audit-omaha.mjs')).toMatch(/READ_ONLY_SESSION_PREFIX/);
    expect(code).not.toMatch(
      /\b(insert into|update\s+\w+\s+set|delete from|drop table|alter table|truncate)\b/i
    );
    expect(code).not.toMatch(/spawn|execFile|execSync|fetch\(|createClient/);
    expect(code).not.toMatch(/'\*'|"\*"/);
    expect(code).not.toMatch(/hud|ca_hand_player_stat/i);
    expect(tool).toContain('pr2.is_horse = false');
  });
});
