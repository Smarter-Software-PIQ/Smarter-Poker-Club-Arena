/**
 * Rewrites the option name lists of migration 20261114072215 from the engine registry (HorseOptionSwitch.ts), which
 * is derived from HORSE_DATA_LEDGER. Every list sits between a pair of marker comments:
 *   -- registry:style-options:begin / -- registry:style-options:end   the seven style options
 *   -- registry:plain-options:begin / -- registry:plain-options:end   every other registered option
 *
 * Run from server/ after the ledger gains or loses an option, while the migration is not installed anywhere:
 *   npx tsx scripts/gen-horse-option-switch-sql.ts            rewrite the lists
 *   npx tsx scripts/gen-horse-option-switch-sql.ts --check    exit 1 when the lists differ, write nothing
 *
 * everyUpgradeHasALiveSwitch.law.test.ts fails when the migration and the registry differ, and names this script.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OPTION_SWITCH_PLAIN_NAMES } from '../src/engine/HorseOptionSwitch.js';
import { STYLE_SWITCH_OPTIONS } from '../src/engine/HorseStyleSwitch.js';

export const OPTION_SWITCH_MIGRATION =
  'supabase/migrations/20261114072215_every_horse_upgrade_has_a_live_switch.sql';

/** The names as SQL string literals, comma separated, wrapped under 100 columns with a four space indent. */
export function sqlNameList(names: readonly string[]): string {
  const lines: string[] = [];
  let line = '   ';
  for (const [i, name] of names.entries()) {
    const item = ` '${name}'${i < names.length - 1 ? ',' : ''}`;
    if (line.length + item.length > 100 && line.trim() !== '') {
      lines.push(line);
      line = '   ';
    }
    line += item;
  }
  if (line.trim() !== '') lines.push(line);
  return lines.join('\n');
}

/** The migration text with every marked list replaced by the registry's names. */
export function withRegistryLists(sql: string): string {
  let out = sql;
  for (const [marker, names] of [
    ['style-options', STYLE_SWITCH_OPTIONS as readonly string[]],
    ['plain-options', OPTION_SWITCH_PLAIN_NAMES],
  ] as const) {
    const block = new RegExp(
      `(-- registry:${marker}:begin\\n)[\\s\\S]*?(\\n[ \\t]*-- registry:${marker}:end)`,
      'g'
    );
    if (!block.test(out)) throw new Error(`the migration has no registry:${marker} markers`);
    out = out.replace(
      block,
      (_all, begin: string, end: string) => begin + sqlNameList(names) + end
    );
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = fileURLToPath(new URL(`../../${OPTION_SWITCH_MIGRATION}`, import.meta.url));
  const before = readFileSync(path, 'utf8');
  const after = withRegistryLists(before);
  if (process.argv.includes('--check')) {
    if (after !== before) {
      console.error(
        'the option switch migration lists differ from the registry: run npx tsx scripts/gen-horse-option-switch-sql.ts in server/'
      );
      process.exit(1);
    }
    console.log('the option switch migration lists equal the registry');
  } else {
    if (after !== before) writeFileSync(path, after);
    console.log(
      after === before ? 'unchanged' : `rewrote ${OPTION_SWITCH_MIGRATION}`,
      `(${STYLE_SWITCH_OPTIONS.length} style, ${OPTION_SWITCH_PLAIN_NAMES.length} other options)`
    );
  }
}
