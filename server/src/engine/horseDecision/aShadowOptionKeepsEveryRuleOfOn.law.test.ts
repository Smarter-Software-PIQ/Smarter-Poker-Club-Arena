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
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPTION_SWITCH_SHADOW_NAMES } from '../HorseOptionSwitch.js';
import {
  OPTION_SWITCH_MIGRATIONS_DIR,
  OPTION_SWITCH_STYLE_BY_NAME_MIGRATION_SUFFIX,
  newestOptionSwitchListMigration,
} from '../HorseOptionSwitchMigrationLists.js';

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
      expect(file.endsWith(OPTION_SWITCH_STYLE_BY_NAME_MIGRATION_SUFFIX), `${fn} (${file})`).toBe(
        true
      );
    }
    // the evidence rule is still in the write: 'on' needs the own citation and the recorded sha256
    const set = newest('fn_ca_horse_option_switch_set').body;
    expect(set).toMatch(
      /IF p_state = 'on' AND NOT \('canary' = ANY \(v_states\)\)\s*AND NOT \(p_note IS NOT NULL/
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
