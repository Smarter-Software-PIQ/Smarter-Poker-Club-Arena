/**
 * A SHADOW OPTION KEEPS EVERY RULE OF `on` (2026-11-18, Horse Switch lane).
 *
 * Four switch functions once told a style option from any other by its `shadow` state. Once a non-style option takes
 * shadow (OPTION_SWITCH_SHADOW_NAMES), that test would let its `on` skip the own-citation and recorded-evidence rules,
 * put its row into the STYLE read (every style option then fails safe to off) and drop it from the wide read. This
 * law holds, over every migration in the repository:
 *  - the NEWEST definition of each of the four functions tells the style options by canary, never by shadow, and the
 *    set function still consults the evidence record;
 *  - that migration installs BEFORE the newest list migration that names shadow options (version order);
 *  - the list migration refuses to install while any of them still tells the style options by shadow.
 *
 * ON_SHADOW KEEPS EVERY RULE OF `on` TOO (2026-11-19). `on_shadow` ACTS as on (the acted decision gets true), so:
 *  - the newest set function (*_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql) holds on_shadow to the
 *    own-citation and recorded-evidence rules of on, still tells the style options by canary, and still consults the
 *    serving registry with the state (the reset-trap guard), before any row is written; its read-back refuses to
 *    commit without the guard call and the canary test;
 *  - the newest registry publish accepts on_shadow (or the serving engine could not publish and the guard would be off);
 *  - the table's own state check accepts on_shadow, and the list migration's table CHECK makes on_shadow cite the
 *    option's own authority from any writer, gives it to exactly the on_shadow options (never a style or off-only
 *    option), and refuses to install before that file;
 *  - in the engine registry every on_shadow option supports on, never canary, and every shadow option takes on_shadow.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_ON_SHADOW_NAMES,
  OPTION_SWITCH_REGISTRY,
  OPTION_SWITCH_SHADOW_NAMES,
} from '../HorseOptionSwitch.js';
import {
  OPTION_SWITCH_MIGRATIONS_DIR,
  OPTION_SWITCH_ON_SHADOW_RULES_MIGRATION_SUFFIX,
  OPTION_SWITCH_STYLE_BY_NAME_MIGRATION_SUFFIX,
  newestOptionSwitchListMigration,
} from '../HorseOptionSwitchMigrationLists.js';
import { STYLE_SWITCH_OPTIONS } from '../HorseStyleSwitch.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const FILES = readdirSync(join(REPO, OPTION_SWITCH_MIGRATIONS_DIR))
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    text: readFileSync(join(REPO, OPTION_SWITCH_MIGRATIONS_DIR, name), 'utf8'),
  }));
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

/** The body of the newest CREATE [OR REPLACE] FUNCTION public.<fn>, and its file. */
function newest(fn: string): { file: string; body: string } {
  const re = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\([^)]*\\)[\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`,
    'g'
  );
  let found: { file: string; body: string } | null = null;
  for (const f of FILES)
    for (const m of code(f.text).matchAll(re)) found = { file: f.name, body: m[1]! };
  if (!found) throw new Error(`no migration defines ${fn}`);
  return found;
}

const FUNCTIONS = [
  'fn_ca_horse_option_switch_set',
  'fn_ca_horse_option_switch_record_evidence',
  'fn_ca_horse_style_switch_effective',
  'fn_ca_horse_option_switch_effective',
];

describe('a shadow option keeps every rule of on', () => {
  it('the newest definition of each switch function tells the style options by canary, never by shadow', () => {
    for (const fn of FUNCTIONS) {
      const { file, body } = newest(fn);
      expect(body, `${fn} (${file})`).not.toMatch(/'shadow' = ANY|ARRAY\['shadow'\]/);
      expect(body, `${fn} (${file})`).toMatch(/'canary' = ANY|ARRAY\['canary'\]/);
      // the set function is replaced once more by the on_shadow file (2026-11-19), which keeps the canary test
      const home =
        fn === 'fn_ca_horse_option_switch_set'
          ? OPTION_SWITCH_ON_SHADOW_RULES_MIGRATION_SUFFIX
          : OPTION_SWITCH_STYLE_BY_NAME_MIGRATION_SUFFIX;
      expect(file.endsWith(home), `${fn} (${file})`).toBe(true);
    }
    // the evidence rule is still in the write: 'on' (and on_shadow) needs the own citation and the recorded sha256
    const set = newest('fn_ca_horse_option_switch_set').body;
    expect(set).toMatch(
      /IF p_state IN \('on', 'on_shadow'\) AND NOT \('canary' = ANY \(v_states\)\)\s*AND NOT \(p_note IS NOT NULL/
    );
    expect(set).toMatch(/FROM public\.ca_horse_option_switch_evidence e/);
    expect(
      set.search(/IF p_state IS NULL OR NOT \(p_state = ANY \(v_states\)\) THEN/)
    ).toBeGreaterThan(0);
  });

  it('the by-canary migration installs before the list migration that names shadow options, which refuses without it', () => {
    expect(OPTION_SWITCH_SHADOW_NAMES.length).toBeGreaterThan(0);
    const list = newestOptionSwitchListMigration(FILES).split('/').pop()!;
    const byName = FILES.filter((f) =>
      f.name.endsWith(OPTION_SWITCH_STYLE_BY_NAME_MIGRATION_SUFFIX)
    );
    expect(byName).toHaveLength(1);
    expect(byName[0]!.name < list).toBe(true);
    const listSql = code(FILES.find((f) => f.name === list)!.text);
    expect(FILES.find((f) => f.name === list)!.text).toContain('-- registry:shadow-options:begin');
    const guard = listSql.indexOf(
      "position('''shadow'' = ANY' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set"
    );
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(listSql.indexOf('ALTER TABLE'));
    // the by-canary migration changes no table, column or row, in one transaction
    // (function bodies write the switch tables as they always did; the file itself writes nothing)
    const m = code(byName[0]!.text).replace(/AS \$function\$[\s\S]*?\$function\$;/g, 'AS <body>;');
    expect(m.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    expect(m).not.toMatch(
      /CREATE\s+TABLE|ALTER\s+TABLE|ADD\s+COLUMN|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+TRIGGER|INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM/i
    );
  });
});

describe('an on_shadow option keeps every rule of on', () => {
  const rules = FILES.filter((f) =>
    f.name.endsWith(OPTION_SWITCH_ON_SHADOW_RULES_MIGRATION_SUFFIX)
  );
  const set = newest('fn_ca_horse_option_switch_set');
  const publish = newest('fn_ca_horse_option_registry_publish');

  it('the newest set function holds on_shadow to the own citation and the recorded evidence, and consults the serving registry with the state', () => {
    expect(rules).toHaveLength(1);
    expect(set.file).toBe(rules[0]!.name);
    const b = set.body;
    // both rules of on name on_shadow, each after the states check, before any row
    const both = [
      ...b.matchAll(/IF p_state IN \('on', 'on_shadow'\) AND NOT \('canary' = ANY \(v_states\)\)/g),
    ];
    expect(both).toHaveLength(2);
    expect(b).not.toMatch(/IF p_state = 'on' AND/);
    const states = b.search(/IF p_state IS NULL OR NOT \(p_state = ANY \(v_states\)\) THEN/);
    const insert = b.search(/INSERT INTO/);
    expect(states).toBeGreaterThan(0);
    for (const m of both) {
      expect(m.index!).toBeGreaterThan(states);
      expect(m.index!).toBeLessThan(insert);
    }
    expect(b.slice(both[0]!.index!)).toMatch(/cites its own authority/);
    expect(b.slice(both[1]!.index!)).toMatch(/FROM public\.ca_horse_option_switch_evidence e/);
    // the reset-trap guard of 20261119053236, with the state, after the own checks and before any row
    const guard = b.indexOf('public.fn_ca_horse_option_registry_refusal(p_option, p_state)');
    expect(guard).toBeGreaterThan(b.indexOf("RAISE EXCEPTION 'an actor is required'"));
    expect(guard).toBeLessThan(insert);
    expect(b.slice(guard)).toMatch(
      /IF v_refusal IS NOT NULL THEN\s*RAISE EXCEPTION '%', v_refusal;/
    );
    // the style options are still told by canary, never by shadow
    expect(b).toMatch(/NOT \('canary' = ANY \(v_states\)\)/);
    expect(b).not.toMatch(/'shadow' = ANY/);
  });

  it('the file reads back the guard, the canary test, both rules, the publish and the table before it commits', () => {
    const raw = rules[0]!.text;
    const sql = code(raw);
    expect(sql.trim()).toMatch(/^BEGIN;\s*SET LOCAL lock_timeout = '3s';[\s\S]*COMMIT;$/);
    const readback = sql.slice(sql.indexOf('DO $readback$'));
    expect(readback).toContain(
      "position('fn_ca_horse_option_registry_refusal(p_option, p_state)' IN v_set) = 0"
    );
    expect(readback).toContain("position('NOT (''canary'' = ANY (v_states))' IN v_set) = 0");
    expect(readback).toContain(
      "p_state IN (''on'', ''on_shadow'') AND NOT (''canary'' = ANY (v_states))"
    );
    expect(readback).toContain("position('''on_shadow''' IN v_publish) = 0");
    expect(readback).toContain("conname = 'ca_horse_style_switch_state_is_known'");
    expect(readback.indexOf('DO $readback$')).toBeLessThan(readback.indexOf('COMMIT;'));
    // the table's own state check accepts on_shadow; nothing else is created; no switch row is written by the file
    expect(sql).toMatch(
      /ADD CONSTRAINT ca_horse_style_switch_state_is_known\s*CHECK \(state IN \('off', 'shadow', 'on_shadow', 'canary', 'on'\)\);/
    );
    const files = sql.replace(/AS \$function\$[\s\S]*?\$function\$;/g, 'AS <body>;');
    expect(files).not.toMatch(
      /CREATE\s+TABLE|ADD\s+COLUMN|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+TRIGGER|INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM/i
    );
  });

  it('the newest registry publish accepts on_shadow, so the serving engine that registers it can publish', () => {
    expect(publish.file).toBe(rules[0]!.name);
    expect(publish.body).toMatch(/NOT IN \('off', 'shadow', 'on_shadow', 'canary', 'on'\)/);
    expect(publish.body).toMatch(
      /encode\(sha256\(convert_to\(v_canonical, 'UTF8'\)\), 'hex'\) <> p_digest/
    );
  });

  it('the list migration that names on_shadow options installs after that file, refuses without it, and holds on_shadow to on at the table', () => {
    expect(OPTION_SWITCH_ON_SHADOW_NAMES.length).toBeGreaterThan(0);
    const list = newestOptionSwitchListMigration(FILES).split('/').pop()!;
    expect(rules[0]!.name < list).toBe(true);
    const text = FILES.find((f) => f.name === list)!.text;
    expect(text).toContain('-- registry:on-shadow-options:begin');
    const listSql = code(text);
    const guard = listSql.indexOf(
      "position('''on_shadow''' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set"
    );
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(listSql.indexOf('ALTER TABLE'));
    expect(listSql).toMatch(
      /ADD CONSTRAINT ca_horse_style_switch_on_cites_authority CHECK \(\s*state NOT IN \('on', 'on_shadow'\)/
    );
    expect(listSql).toMatch(/OR \(state <> 'on_shadow' AND option IN \(/);
  });

  it('in the engine registry every on_shadow option supports on and never canary; every shadow option takes on_shadow', () => {
    for (const name of OPTION_SWITCH_ON_SHADOW_NAMES) {
      const entry = OPTION_SWITCH_REGISTRY.find((e) => e.name === name)!;
      expect(entry.states, name).toContain('on');
      expect(entry.states, name).not.toContain('canary');
      expect(entry.states.indexOf('on_shadow'), name).toBe(entry.states.indexOf('on') - 1);
      expect(OPTION_SWITCH_OFF_ONLY_NAMES, name).not.toContain(name);
      expect(STYLE_SWITCH_OPTIONS as readonly string[], name).not.toContain(name);
    }
    for (const name of OPTION_SWITCH_SHADOW_NAMES)
      expect(OPTION_SWITCH_ON_SHADOW_NAMES, name).toContain(name);
  });
});
