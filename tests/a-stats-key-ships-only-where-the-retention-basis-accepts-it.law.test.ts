/**
 * ===========================================================================
 *  LAW: THE ENGINE NEVER SENDS A STATS KEY THE INSTALLED RETENTION BASIS
 *  WOULD REJECT
 * ===========================================================================
 *
 * smarter_private.horse_compact_stats_basis (the hand_history retention and
 * compaction path) raises HORSE_STATS_BASIS_INVALID_SHAPE on any top-level
 * stats_facts key it does not know. On 2026-10-25 the engine started sending
 * horse_rollups before the basis knew it, and sp_prune_hand_history stopped
 * for eleven days (20261105174453). Review B1 (2026-11-19) found the same
 * shape again for horse_hole_cards. This law pins both sides of the key list:
 *
 *   1. The engine's keys (handFacts.ts STATS_FACTS_ALWAYS_KEYS and
 *      STATS_FACTS_GATED_KEYS) are exactly the DurableStatsFactPayload keys,
 *      and the only top-level keys any writer assigns.
 *   2. Every ALWAYS key is one the old basis already accepts; every GATED key
 *      is one the installed basis accepts after 20261120025753, and is one of
 *      the candidates public.horse_stats_basis_accepted_keys() tests.
 *   3. A GATED key the old basis does not know (horse_hole_cards) is attached
 *      only behind input.horseHoleCardsAccepted === true, and every writer of
 *      that flag takes it from HorseStatsBasisContract, which asks the
 *      database function by name; the database answer cannot widen the list.
 *
 * The native proof (the basis really accepts and drops the key, the old one
 * refuses it, the contract lists it, client roles cannot call it) is
 * scripts/ci/test-horse-dealt-hole-cards.py.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const ROLLUPS_BASIS =
  'supabase/migrations/20261105174453_horse_stats_basis_accepts_horse_rollups.sql';
const BASIS_KEY =
  'supabase/migrations/20261120025753_the_horse_stats_basis_drops_the_horse_hole_cards_key.sql';
const FACTS = 'server/src/services/supabase/handFacts.ts';
const CONTRACT = 'server/src/services/HorseStatsBasisContract.ts';
const WRITERS = [
  FACTS,
  'server/src/services/supabase/handHistory.ts',
  'server/src/lightning/LightningHandFacts.ts',
];

const sqlCode = (p: string) =>
  read(p)
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const quoted = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

/** The top-level keys the core basis accepts (its NOT IN list as 20261105174453 installs it). */
function oldBasisKeys(): string[] {
  const m = /k NOT IN\(''version'',''facts'',''transfers'',''horse_rollups''\)\)/.exec(
    sqlCode(ROLLUPS_BASIS)
  );
  expect(m, 'the rollups basis names its key list').not.toBeNull();
  return ['version', 'facts', 'transfers', 'horse_rollups'];
}

function engineList(name: string, facts: string): string[] {
  const m = new RegExp(`export const ${name} = Object\\.freeze\\(\\[([^\\]]*)\\]`).exec(facts);
  expect(m, name).not.toBeNull();
  const hole = /export const HORSE_HOLE_CARDS_STATS_KEY = '([a-z_]+)' as const;/.exec(facts);
  expect(hole).not.toBeNull();
  return m![1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === 'HORSE_HOLE_CARDS_STATS_KEY' ? hole![1] : s.replace(/^'|'$/g, '')));
}

describe('LAW: the engine never sends a stats key the installed retention basis would reject', () => {
  const facts = read(FACTS);
  const always = engineList('STATS_FACTS_ALWAYS_KEYS', facts);
  const gated = engineList('STATS_FACTS_GATED_KEYS', facts);
  const basis = sqlCode(BASIS_KEY);

  it('the engine key list is the payload type and every key a writer assigns', () => {
    const body = /export interface DurableStatsFactPayload \{([\s\S]*?)\n\}/.exec(facts)![1];
    const typed = [...body.matchAll(/^\s{2}([a-z_]+)\??:/gm)].map((m) => m[1]).sort();
    expect(typed).toEqual([...always, ...gated].sort());
    for (const file of WRITERS) {
      const assigned = [
        ...read(file).matchAll(/\b(?:payload|statsFacts)\.([a-z_]+)\s*=(?!=)/g),
      ].map((m) => m[1]);
      for (const key of assigned) expect(gated, `${file} assigns ${key}`).toContain(key);
    }
  });

  it('every key the engine may send is one the basis accepts; the gated ones are what the database tests', () => {
    const old = oldBasisKeys();
    for (const key of always) expect(old).toContain(key);
    // 20261120025753: the wrapper drops horse_hole_cards before the core looks, and nothing else
    expect(basis).toContain(
      "IF jsonb_typeof(p_stats) = 'object' AND p_stats ? 'horse_hole_cards' THEN"
    );
    expect(basis).toContain(
      "RETURN smarter_private.horse_compact_stats_basis_core(p_stats - 'horse_hole_cards');"
    );
    const accepted = [...old, 'horse_hole_cards'];
    for (const key of gated) expect(accepted).toContain(key);
    const candidates = /candidates jsonb := jsonb_build_object\(([\s\S]*?)\);/.exec(basis);
    expect(candidates).not.toBeNull();
    expect(quoted(candidates![1].replace(/'\{\}'::jsonb|'\[\]'::jsonb/g, '')).sort()).toEqual(
      [...gated].sort()
    );
    // and no md5 pin that could refuse
    expect(basis).not.toMatch(/md5\(/i);
  });

  it('a key the old basis does not know is attached only behind the database answer', () => {
    const old = oldBasisKeys();
    const unknownToOld = gated.filter((k) => !old.includes(k));
    expect(unknownToOld).toEqual(['horse_hole_cards']);
    expect(facts).toMatch(
      /if \(horseHoleCards\.length > 0 && input\.horseHoleCardsAccepted === true\)\s*\n\s*payload\.horse_hole_cards = horseHoleCards;/
    );
    // every writer of the flag takes it from the contract (the Lightning host through the hand)
    const writers = [
      ...read('server/src/services/supabase/handHistory.ts').matchAll(
        /horseHoleCardsAccepted: ([^,\n]+)/g
      ),
      ...read('server/src/lightning/LightningHandHost.ts').matchAll(
        /horseHoleCardsAccepted: ([^,\n]+)/g
      ),
      ...read('server/src/lightning/LightningHandFacts.ts').matchAll(
        /horseHoleCardsAccepted: ([^,\n]+)/g
      ),
    ].map((m) => m[1].trim());
    expect(writers.sort()).toEqual(
      [
        'await horseHoleCardsBasisContract()',
        'await horseHoleCardsBasisContract()',
        'hand.horseHoleCardsAccepted === true',
      ].sort()
    );
    const contract = read(CONTRACT);
    expect(contract).toContain("supabase.rpc('horse_stats_basis_accepted_keys')");
    expect(basis).toContain('CREATE OR REPLACE FUNCTION public.horse_stats_basis_accepted_keys()');
    // the answer is filtered to the engine's own list: the database cannot widen what is sent
    expect(contract).toContain(
      'list.filter((k) => (STATS_FACTS_GATED_KEYS as readonly string[]).includes(k))'
    );
    // unknown is off: every failure path returns the empty set
    expect(contract.match(/return NONE;/g)?.length).toBe(2);
  });
});
