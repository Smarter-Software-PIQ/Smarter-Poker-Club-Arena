/**
 * Writes the migration that registers Horse options in the database whitelist of the option switch, from the engine
 * registry (HorseOptionSwitch.ts, which is derived from HORSE_DATA_LEDGER).
 *
 * The whitelist is the rows of public.ca_horse_option_whitelist (HorseOptionSwitchMigrationLists.ts). A pull request
 * that adds an option to the ledger, or moves one to OPTION_SWITCH_OFF_ONLY, ships ONE small migration holding one
 * fn_ca_horse_option_register call per option. Such migrations commute: nothing is regenerated when another pull
 * request merges first.
 *
 * From the repository root, reserve the version (never pick one by hand):
 *   node scripts/new-migration.mjs "horse option register <what>"
 * then, from server/:
 *   npx tsx scripts/gen-horse-option-switch-sql.ts --register <the file it printed, or its name> [option ...]
 *       write into that file the register calls the registry needs and the whitelist lacks (all of them, or only
 *       the named options). Refuses a file that main holds, a file holding any SQL statement that is not a register
 *       migration of its own, and a registry that needs none.
 *   npx tsx scripts/gen-horse-option-switch-sql.ts --register <the file> --allow-shadow [option ...]
 *       also write the fn_ca_horse_option_allow_shadow calls for options whose registry shadow level is WIDER than
 *       the whitelist's, and print the lines to add by hand to OPTION_SWITCH_APPROVED_UNLOCKS (the law fails without
 *       them). Without the flag a wider level is reported and nothing is written for it.
 *   npx tsx scripts/gen-horse-option-switch-sql.ts --check
 *       exit 1 when the whitelist of the migrations on disk differs from the registry; writes nothing
 *
 * A registration only adds a name, adds an off-only hold or narrows a shadow level (none < on_shadow < shadow).
 * It never writes an un-lock or a removal: those are explicit calls in their own migration, listed by hand in
 * OPTION_SWITCH_APPROVED_UNLOCKS. everyUpgradeHasALiveSwitch.law.test.ts makes the same comparison as --check.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPTION_SWITCH_MIGRATIONS_DIR,
  type OptionSwitchMigrationFile,
  optionSwitchAllowShadowCallsNeeded,
  optionSwitchRegisterCallsNeeded,
  optionSwitchRegisterMigrationRefusal,
  optionSwitchRegisterNameRefusal,
  optionSwitchRegisterSql,
  optionSwitchWhitelistDrift,
  optionSwitchWhitelistFromMigrations,
} from '../src/engine/HorseOptionSwitchMigrationLists.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** Every migration of this checkout that can bear on the whitelist (a list marker or a whitelist name). */
export function optionSwitchMigrationsOnDisk(repo: string = REPO): OptionSwitchMigrationFile[] {
  const dir = join(repo, OPTION_SWITCH_MIGRATIONS_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
    .filter(
      (f) => f.text.includes('registry:plain-options') || f.text.includes('ca_horse_option_')
    );
}

/** True when origin/main holds `path`. Fails closed: if git cannot answer, the file is treated as on main. */
function onMain(path: string): boolean {
  try {
    const out = execFileSync(
      'git',
      ['-C', REPO, 'ls-tree', '--name-only', 'origin/main', '--', path],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return out.trim() !== '';
  } catch {
    return true;
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args[0] === '--check' && args.length === 1) {
    const { whitelist } = optionSwitchWhitelistFromMigrations(optionSwitchMigrationsOnDisk());
    const drift = optionSwitchWhitelistDrift(whitelist);
    if (drift) fail(drift);
    console.log(
      `the option switch whitelist of the migrations equals the registry (${whitelist.size} options)`
    );
  } else if (args[0] === '--register' && args[1]) {
    const name = basename(args[1]).replace(/\.sql$/, '');
    const allowShadow = args.slice(2).includes('--allow-shadow');
    const only = new Set(args.slice(2).filter((arg) => arg !== '--allow-shadow'));
    const refusal = optionSwitchRegisterNameRefusal(name);
    if (refusal) fail(refusal);
    const target = `${OPTION_SWITCH_MIGRATIONS_DIR}/${name}.sql`;
    if (onMain(target))
      fail(`${target} is on main (installed or about to be): reserve a new migration`);
    const path = join(REPO, target);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
    // what the file may hold: nothing, the scripts/new-migration.mjs template, or this tool's earlier output
    const statements = before
      .replace(/--[^\n]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const own =
      optionSwitchRegisterMigrationRefusal({ name: `${name}.sql`, text: before }) === null;
    if (
      statements !== '' &&
      statements !== 'BEGIN; COMMIT;' &&
      !(own && /fn_ca_horse_option_(?:register|allow_shadow)/.test(statements))
    )
      fail(`${target} holds SQL that is not a register migration: register into a file of its own`);
    // the whitelist WITHOUT this file, so a second run rewrites the same calls
    const others = optionSwitchMigrationsOnDisk().filter((f) => f.name !== `${name}.sql`);
    const { whitelist } = optionSwitchWhitelistFromMigrations(others);
    const needed = [
      ...optionSwitchRegisterCallsNeeded(whitelist, name),
      ...(allowShadow ? optionSwitchAllowShadowCallsNeeded(whitelist, name) : []),
    ];
    for (const option of only)
      if (!needed.some((call) => call.option === option))
        fail(
          `${option} needs no register call: it is not in the registry, or the whitelist holds it already`
        );
    const calls = only.size ? needed.filter((call) => only.has(call.option)) : needed;
    if (calls.length === 0)
      fail('the whitelist of the migrations already equals the registry: nothing to register');
    const after = optionSwitchRegisterSql(name, calls);
    if (after !== before) writeFileSync(path, after);
    console.log(
      `${after === before ? 'unchanged' : 'wrote'} ${target}: ${calls.length} register call(s)`
    );
    const widened = calls.filter((call) => call.fn === 'allow_shadow');
    if (widened.length)
      console.log(
        `add to OPTION_SWITCH_APPROVED_UNLOCKS (HorseOptionSwitchMigrationLists.ts):\n` +
          widened.map((call) => `  '${name}:allow_shadow:${call.option}',`).join('\n')
      );
    const drift = optionSwitchWhitelistDrift(
      optionSwitchWhitelistFromMigrations(optionSwitchMigrationsOnDisk()).whitelist
    );
    if (drift) fail(`still differs after this file: ${drift}`);
  } else {
    fail(
      'usage: gen-horse-option-switch-sql.ts --check | --register <YYYYMMDDHHMMSS>_<snake_name> [--allow-shadow] [option ...]\n' +
        '(--follow-up is gone: the whitelist is rows now, a pull request registers only its own options)'
    );
  }
}
