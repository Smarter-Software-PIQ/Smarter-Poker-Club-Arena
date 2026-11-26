/**
 * A HORSE OPTION REGISTERS ITSELF (2026-11-19).
 *
 * The database whitelist of the option switch is rows (public.ca_horse_option_whitelist). A pull request that adds
 * an option, or holds one off-only, ships one fn_ca_horse_option_register call per option, and these tests pin what
 * makes that safe when several lanes do it at once:
 *   (a) a registry option the whitelist lacks fails with the command that registers it, and only it;
 *   (b) the generated migration holds its own calls and nothing else;
 *   (c) two register migrations give the same whitelist in either order, and a stale one lifts no hold;
 *   (d) a hold is lifted only by an un-lock naming every holder, never proposed by the generator;
 *   (e) a new full-list follow-up, a hand-written whitelist write and a call in another migration's name are refused;
 *   (f) the shadow level (none, on_shadow, shadow; 2026-11-20) only narrows by registering, in either order, and a
 *       wider one is an explicit allow_shadow call.
 * The same folds run in PostgreSQL in scripts/ci/test-horse-option-switch-evidence-postgres.sh.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_ON_SHADOW_NAMES,
  OPTION_SWITCH_PLAIN_NAMES,
  OPTION_SWITCH_SHADOW_NAMES,
} from './HorseOptionSwitch.js';
import {
  OPTION_SWITCH_LAST_LIST_MIGRATION,
  OPTION_SWITCH_LIST_MARKER,
  OPTION_SWITCH_LIST_MIGRATION_COUNT,
  OPTION_SWITCH_MIGRATIONS_DIR,
  OPTION_SWITCH_REGISTER_COMMAND,
  OPTION_SWITCH_WHITELIST_MIGRATION,
  type OptionSwitchMigrationFile,
  type OptionSwitchShadowLevel,
  type OptionSwitchWhitelistCall,
  type OptionSwitchWhitelistRow,
  applyOptionSwitchWhitelistCall,
  optionSwitchAllowShadowCallsNeeded,
  optionSwitchListMigrationsRefusal,
  optionSwitchListsOf,
  optionSwitchRegisterCallsNeeded,
  optionSwitchRegisterMigrationRefusal,
  optionSwitchRegisterNameRefusal,
  optionSwitchRegisterSql,
  optionSwitchRowStates,
  optionSwitchWhitelistCalls,
  optionSwitchWhitelistDrift,
  optionSwitchWhitelistFromMigrations,
} from './HorseOptionSwitchMigrationLists.js';
import { STYLE_SWITCH_OPTIONS } from './HorseStyleSwitch.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const DISK: OptionSwitchMigrationFile[] = readdirSync(join(REPO, OPTION_SWITCH_MIGRATIONS_DIR))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => ({
    name,
    text: readFileSync(join(REPO, OPTION_SWITCH_MIGRATIONS_DIR, name), 'utf8'),
  }))
  .filter((f) => f.text.includes(OPTION_SWITCH_LIST_MARKER) || f.text.includes('ca_horse_option_'));
const A = '20990101000001_horse_option_register_a';
const B = '20990101000002_horse_option_register_b';
const SEED = OPTION_SWITCH_WHITELIST_MIGRATION.replace(/\.sql$/, '');
const register = (
  option: string,
  offOnly: boolean,
  migration: string,
  kind: 'plain' | 'style' = 'plain',
  shadow: OptionSwitchShadowLevel = 'none'
): OptionSwitchWhitelistCall => ({ fn: 'register', option, kind, offOnly, shadow, migration });
/** The shadow level the registry gives a plain option that is not off-only. */
const levelOf = (name: string): OptionSwitchShadowLevel =>
  OPTION_SWITCH_SHADOW_NAMES.includes(name)
    ? 'shadow'
    : OPTION_SWITCH_ON_SHADOW_NAMES.includes(name)
      ? 'on_shadow'
      : 'none';
const file = (
  name: string,
  calls: readonly OptionSwitchWhitelistCall[]
): OptionSwitchMigrationFile => ({
  name: `${name}.sql`,
  text: optionSwitchRegisterSql(name, calls),
});
const rows = (whitelist: ReadonlyMap<string, OptionSwitchWhitelistRow>) =>
  [...whitelist].sort(([a], [b]) => (a < b ? -1 : 1));
const disk = () => optionSwitchWhitelistFromMigrations(DISK).whitelist;
/** A plain registry option that is offered on, and one that is off-only. */
const OPEN = OPTION_SWITCH_PLAIN_NAMES.find(
  (name) => !OPTION_SWITCH_OFF_ONLY_NAMES.includes(name)
)!;
const HELD = OPTION_SWITCH_OFF_ONLY_NAMES[0]!;

describe('a Horse option registers itself in the database whitelist', () => {
  it('the whitelist of the migrations on disk equals the registry, and the frozen lists are the pinned file', () => {
    expect(optionSwitchListMigrationsRefusal(DISK)).toBeNull();
    expect(DISK.filter((f) => f.text.includes(OPTION_SWITCH_LIST_MARKER))).toHaveLength(
      OPTION_SWITCH_LIST_MIGRATION_COUNT
    );
    expect(optionSwitchWhitelistDrift(disk())).toBeNull();
    expect(optionSwitchRegisterCallsNeeded(disk(), A)).toEqual([]);
    // the seed holds every off-only option of the frozen lists in the whitelist migration's own name
    const lists = optionSwitchListsOf(
      DISK.find((f) => f.name === OPTION_SWITCH_LAST_LIST_MIGRATION)!.text
    );
    expect([...lists.style].sort()).toEqual([...STYLE_SWITCH_OPTIONS].sort());
    for (const name of lists.offOnly)
      expect(disk().get(name), name).toEqual({ kind: 'plain', lockedBy: [SEED], shadow: 'none' });
    // and every other plain option at the shadow level its frozen lists give it (every shadow option takes on_shadow)
    expect(lists.shadow.length).toBeGreaterThan(0);
    expect(lists.onShadow.length).toBeGreaterThan(lists.shadow.length);
    for (const name of lists.shadow) {
      expect(lists.onShadow, name).toContain(name);
      expect(disk().get(name), name).toEqual({ kind: 'plain', lockedBy: [], shadow: 'shadow' });
    }
    for (const name of lists.onShadow)
      if (!lists.shadow.includes(name))
        expect(disk().get(name), name).toEqual({
          kind: 'plain',
          lockedBy: [],
          shadow: 'on_shadow',
        });
    for (const [name, row] of disk())
      if (row.kind === 'style') expect(row.shadow, name).toBe('none');
  });

  it('(a) a registry option the whitelist lacks fails with the register command, and the generator writes that option alone', () => {
    const lacking = new Map(disk());
    lacking.delete(OPEN);
    lacking.set(HELD, { kind: 'plain', lockedBy: [], shadow: 'none' });
    const drift = optionSwitchWhitelistDrift(lacking)!;
    expect(drift).toContain(`not registered in the database: ${OPEN}`);
    expect(drift).toContain(`off-only in the registry and not held in the database: ${HELD}`);
    expect(drift).toContain(OPTION_SWITCH_REGISTER_COMMAND);
    expect(OPTION_SWITCH_REGISTER_COMMAND).toContain('node scripts/new-migration.mjs');
    const calls = optionSwitchRegisterCallsNeeded(lacking, A);
    expect([...calls].sort((x, y) => (x.option < y.option ? -1 : 1))).toEqual(
      [register(OPEN, false, A, 'plain', levelOf(OPEN)), register(HELD, true, A)].sort((x, y) =>
        x.option < y.option ? -1 : 1
      )
    );
    // installed, the whitelist equals the registry again
    for (const call of calls) applyOptionSwitchWhitelistCall(lacking, call);
    expect(optionSwitchWhitelistDrift(lacking)).toBeNull();
  });

  it('(b) a register migration is one transaction holding its own calls and nothing else', () => {
    const calls = [register('newOptionOne', false, A), register('newOptionTwo', true, A)];
    const sql = optionSwitchRegisterSql(A, calls);
    const code = sql
      .replace(/--[^\n]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    expect(code).toBe(
      "BEGIN; SET LOCAL lock_timeout = '3s'; " +
        `SELECT public.fn_ca_horse_option_register('newOptionOne', 'plain', false, 'none', '${A}'); ` +
        `SELECT public.fn_ca_horse_option_register('newOptionTwo', 'plain', true, 'none', '${A}'); COMMIT;`
    );
    expect(sql.split('\n').length).toBeLessThan(40);
    expect(optionSwitchWhitelistCalls({ name: `${A}.sql`, text: sql })).toEqual(calls);
    expect(optionSwitchRegisterMigrationRefusal({ name: `${A}.sql`, text: sql })).toBeNull();
    // it carries no list, so it is not one of the frozen full-list migrations
    expect(sql).not.toContain(OPTION_SWITCH_LIST_MARKER);
    expect(() => optionSwitchRegisterSql(A, [])).toThrow(/at least one option/);
    expect(() => optionSwitchRegisterSql(A, [register('x', false, B)])).toThrow(/of its own only/);
    expect(optionSwitchRegisterNameRefusal(A)).toBeNull();
    expect(optionSwitchRegisterNameRefusal('horse_option_register')).toMatch(/new-migration\.mjs/);
    expect(optionSwitchRegisterNameRefusal(SEED)).toMatch(/whitelist migration itself/);
  });

  it('(c) two register migrations give the same whitelist in either install order, and a stale one lifts no hold', () => {
    // A holds OPEN off-only and registers a shared name held. B was written before A merged: it still believes
    // OPEN and the shared name are offered on (OPEN at its shadow level), and registers a name of its own.
    const a = [
      register('laneAOption', false, A),
      register('sharedOption', true, A),
      register(OPEN, true, A),
    ];
    const b = [
      register('laneBOption', true, B),
      register('sharedOption', false, B),
      register(OPEN, false, B, 'plain', levelOf(OPEN)),
      register('laneBStyle', false, B, 'style'),
    ];
    const install = (order: readonly OptionSwitchWhitelistCall[][]) => {
      const whitelist = new Map(disk());
      for (const calls of order)
        for (const call of calls) applyOptionSwitchWhitelistCall(whitelist, call);
      return whitelist;
    };
    const ab = install([a, b]);
    const ba = install([b, a]);
    expect(rows(ab)).toEqual(rows(ba));
    // installing either a second time changes nothing
    expect(rows(install([a, b, a, b]))).toEqual(rows(ab));
    expect(ab.get(OPEN)).toEqual({ kind: 'plain', lockedBy: [A], shadow: 'none' });
    expect(optionSwitchRowStates(ab.get(OPEN)!)).toEqual(['off']);
    expect(ab.get('sharedOption')).toEqual({ kind: 'plain', lockedBy: [A], shadow: 'none' });
    expect(ab.get('laneBOption')).toEqual({ kind: 'plain', lockedBy: [B], shadow: 'none' });
    expect(ab.get('laneAOption')).toEqual({ kind: 'plain', lockedBy: [], shadow: 'none' });
    expect(ab.get('laneBStyle')).toEqual({ kind: 'style', lockedBy: [], shadow: 'none' });
    // every other row is untouched: neither migration names an option it does not register
    for (const [name, row] of disk()) if (name !== OPEN) expect(ab.get(name), name).toEqual(row);
    // the same through the files, whichever version each lane reserved
    const viaFiles = (first: string, second: string) =>
      rows(
        optionSwitchWhitelistFromMigrations([
          ...DISK,
          file(
            first,
            a.map((c) => ({ ...c, migration: first }))
          ),
          file(
            second,
            b.map((c) => ({ ...c, migration: second }))
          ),
        ]).whitelist
      ).map(([name, row]) => [name, row.kind, row.lockedBy.length > 0, row.shadow]);
    expect(viaFiles(A, B)).toEqual(viaFiles(B, A));
    // two holds from two migrations are both kept
    const twice = install([a, [register(OPEN, true, B)]]);
    expect(twice.get(OPEN)).toEqual({ kind: 'plain', lockedBy: [A, B], shadow: 'none' });
    // a kind never changes, and a style option is never held
    expect(() => install([[register(OPEN, false, A, 'style')]])).toThrow(
      /cannot be registered as style/
    );
    expect(() => install([[register('laneStyle', true, A, 'style')]])).toThrow(
      /cannot be off-only/
    );
  });

  it('(d) a hold is lifted only by an un-lock that names every holder; the generator never proposes one', () => {
    // the registry of a stale branch offers HELD on while the database holds it: no register call can settle that
    const whitelist = new Map(disk());
    whitelist.set(OPEN, { kind: 'plain', lockedBy: [A], shadow: levelOf(OPEN) });
    const drift = optionSwitchWhitelistDrift(whitelist)!;
    expect(drift).toContain(
      `HELD OFF-ONLY in the database and offered on by the registry: ${OPEN}`
    );
    expect(drift).toContain('fn_ca_horse_option_unlock');
    expect(drift).toContain('OPTION_SWITCH_APPROVED_UNLOCKS');
    expect(optionSwitchRegisterCallsNeeded(whitelist, B)).toEqual([]);
    // an un-lock written without knowing another migration's hold raises instead of lifting it
    whitelist.set(OPEN, { kind: 'plain', lockedBy: [A, B], shadow: levelOf(OPEN) });
    const unlock = (lifts: string[]): OptionSwitchWhitelistCall => ({
      fn: 'unlock',
      option: OPEN,
      lifts,
      migration: B,
    });
    expect(() => applyOptionSwitchWhitelistCall(whitelist, unlock([A]))).toThrow(
      /every hold is lifted by name or none is/
    );
    expect(whitelist.get(OPEN)!.lockedBy).toEqual([A, B]);
    applyOptionSwitchWhitelistCall(whitelist, unlock([A, B]));
    expect(whitelist.get(OPEN)).toEqual({ kind: 'plain', lockedBy: [], shadow: levelOf(OPEN) });
    expect(() => applyOptionSwitchWhitelistCall(whitelist, unlock([A, B]))).toThrow(
      /no hold to lift/
    );
    // a held option is not removed; an open one is, explicitly
    expect(() =>
      applyOptionSwitchWhitelistCall(whitelist, { fn: 'unregister', option: HELD, migration: B })
    ).toThrow(/lift the hold by name/);
    applyOptionSwitchWhitelistCall(whitelist, { fn: 'unregister', option: OPEN, migration: B });
    expect(whitelist.has(OPEN)).toBe(false);
    // through the files, an un-lock and a removal are reported for the law to hold against the approved list
    const explicit = optionSwitchWhitelistFromMigrations([
      ...DISK,
      {
        name: `${B}.sql`,
        text:
          `BEGIN;\nSET LOCAL lock_timeout = '3s';\n` +
          `SELECT public.fn_ca_horse_option_unlock('${HELD}', ARRAY['${SEED}'], '${B}');\n` +
          `SELECT public.fn_ca_horse_option_unregister('${HELD}', '${B}');\nCOMMIT;\n`,
      },
    ]);
    expect(explicit.explicit).toEqual([`${B}:unlock:${HELD}`, `${B}:unregister:${HELD}`]);
    expect(optionSwitchWhitelistDrift(explicit.whitelist)).toContain(
      `not registered in the database: ${HELD}`
    );
  });

  it('(e) a new full-list follow-up, a hand-written whitelist write and a call in another name are refused', () => {
    const followUp = {
      name: '20991231000000_horse_option_switch_old_style.sql',
      text: DISK.find((f) => f.name === OPTION_SWITCH_LAST_LIST_MIGRATION)!.text,
    };
    const refusal = optionSwitchListMigrationsRefusal([...DISK, followUp])!;
    expect(refusal).toContain('20991231000000_horse_option_switch_old_style.sql');
    expect(refusal).toContain('would overwrite the whitelist rows');
    expect(refusal).toContain(OPTION_SWITCH_REGISTER_COMMAND);
    expect(() => optionSwitchWhitelistFromMigrations([...DISK, followUp])).toThrow(/frozen/);
    // one with an older version than the last (reserved early, merged late) is caught by the count
    expect(
      optionSwitchListMigrationsRefusal([
        ...DISK,
        { ...followUp, name: '20261115000000_horse_option_switch_late.sql' },
      ])
    ).toContain(`holds ${OPTION_SWITCH_LIST_MIGRATION_COUNT + 1}`);
    const body = (statements: string) => ({
      name: `${A}.sql`,
      text: `BEGIN;\nSET LOCAL lock_timeout = '3s';\n${statements}\nCOMMIT;\n`,
    });
    const own = `SELECT public.fn_ca_horse_option_register('laneOption', 'plain', false, 'none', '${A}');`;
    expect(optionSwitchRegisterMigrationRefusal(body(own))).toBeNull();
    for (const bad of [
      // a hold lifted by hand
      `UPDATE public.ca_horse_option_whitelist SET locked_by = '{}' WHERE option = 'v7';`,
      `DELETE FROM public.ca_horse_option_whitelist WHERE option = 'v7';`,
      `INSERT INTO public.ca_horse_option_whitelist (option, kind, registered_by) VALUES ('x', 'plain', 'me');`,
      // a call that is not a plain literal call
      `SELECT public.fn_ca_horse_option_register(o, 'plain', false, 'none', '${A}') FROM unnest(ARRAY['a', 'b']) o;`,
      // the call as it was spelled before the shadow level (four arguments), and a level that does not exist
      `SELECT public.fn_ca_horse_option_register('laneOption', 'plain', false, '${A}');`,
      `SELECT public.fn_ca_horse_option_register('laneOption', 'plain', false, 'canary', '${A}');`,
      `UPDATE public.ca_horse_option_whitelist SET shadow = 'shadow' WHERE option = 'v7';`,
      `DO $do$ BEGIN PERFORM public.fn_ca_horse_option_unlock('v7', ARRAY['${SEED}'], '${A}'); END $do$;`,
      // in another migration's name
      `SELECT public.fn_ca_horse_option_register('laneOption', 'plain', false, 'none', '${B}');`,
      // with something else beside it
      `${own}\nALTER TABLE public.ca_horse_style_switch DISABLE TRIGGER ca_horse_style_switch_row_fits;`,
      `${own}\nCREATE OR REPLACE FUNCTION public.fn_x() RETURNS int LANGUAGE sql AS 'SELECT 1';`,
    ])
      expect(optionSwitchRegisterMigrationRefusal(body(bad)), bad).not.toBeNull();
    // without the lock timeout, or outside one transaction
    expect(
      optionSwitchRegisterMigrationRefusal({ name: `${A}.sql`, text: `BEGIN;\n${own}\nCOMMIT;\n` })
    ).not.toBeNull();
    expect(
      optionSwitchRegisterMigrationRefusal({ name: `${A}.sql`, text: `${own}\n` })
    ).not.toBeNull();
    // a migration that names none of it is not this law's business
    expect(
      optionSwitchRegisterMigrationRefusal({
        name: `${A}.sql`,
        text: 'BEGIN;\nSELECT 1;\nCOMMIT;\n',
      })
    ).toBeNull();
  });

  it('(f) the shadow level only narrows by registering, in either order; a wider one is an explicit allow_shadow', () => {
    const install = (order: readonly OptionSwitchWhitelistCall[][]) => {
      const whitelist = new Map(disk());
      for (const calls of order)
        for (const call of calls) applyOptionSwitchWhitelistCall(whitelist, call);
      return whitelist;
    };
    // A registers a shared name at on_shadow; B, written before A, says shadow: the lower level stands either way
    const a = [register('levelShared', false, A, 'plain', 'on_shadow')];
    const b = [
      register('levelShared', false, B, 'plain', 'shadow'),
      register('levelB', false, B, 'plain', 'shadow'),
    ];
    const ab = install([a, b]);
    expect(rows(ab)).toEqual(rows(install([b, a])));
    expect(rows(install([a, b, b, a]))).toEqual(rows(ab));
    expect(ab.get('levelShared')).toEqual({ kind: 'plain', lockedBy: [], shadow: 'on_shadow' });
    expect(optionSwitchRowStates(ab.get('levelShared')!)).toEqual(['off', 'on_shadow', 'on']);
    expect(optionSwitchRowStates(ab.get('levelB')!)).toEqual(['off', 'shadow', 'on_shadow', 'on']);
    expect(optionSwitchRowStates({ kind: 'plain', lockedBy: [], shadow: 'none' })).toEqual([
      'off',
      'on',
    ]);
    expect(optionSwitchRowStates({ kind: 'style', lockedBy: [], shadow: 'none' })).toEqual([
      'off',
      'shadow',
      'canary',
      'on',
    ]);
    // every row of the disk whitelist answers the states the registry lists for it
    for (const [name, row] of disk()) {
      const want =
        row.kind === 'style'
          ? ['off', 'shadow', 'canary', 'on']
          : OPTION_SWITCH_OFF_ONLY_NAMES.includes(name)
            ? ['off']
            : levelOf(name) === 'shadow'
              ? ['off', 'shadow', 'on_shadow', 'on']
              : levelOf(name) === 'on_shadow'
                ? ['off', 'on_shadow', 'on']
                : ['off', 'on'];
      expect(optionSwitchRowStates(row), name).toEqual(want);
    }
    // the database NARROWER than the registry: registering never widens; allow_shadow does, by name
    const SH = OPTION_SWITCH_SHADOW_NAMES[0]!;
    const narrower = new Map(disk());
    narrower.set(SH, { ...narrower.get(SH)!, shadow: 'none' });
    const drift = optionSwitchWhitelistDrift(narrower)!;
    expect(drift).toContain(
      `NARROWER shadow level in the database than in the registry: ${SH} (none -> shadow)`
    );
    expect(drift).toContain('fn_ca_horse_option_allow_shadow');
    expect(drift).toContain('OPTION_SWITCH_APPROVED_UNLOCKS');
    expect(optionSwitchRegisterCallsNeeded(narrower, A)).toEqual([]);
    applyOptionSwitchWhitelistCall(narrower, register(SH, false, A, 'plain', 'shadow'));
    expect(narrower.get(SH)!.shadow).toBe('none');
    const widen = optionSwitchAllowShadowCallsNeeded(narrower, A);
    expect(widen).toEqual([{ fn: 'allow_shadow', option: SH, shadow: 'shadow', migration: A }]);
    applyOptionSwitchWhitelistCall(narrower, widen[0]!);
    expect(optionSwitchWhitelistDrift(narrower)).toBeNull();
    // the database WIDER than the registry: a register call narrows it
    const NONE = OPTION_SWITCH_PLAIN_NAMES.find(
      (name) => !OPTION_SWITCH_OFF_ONLY_NAMES.includes(name) && levelOf(name) === 'none'
    )!;
    const wider = new Map(disk());
    wider.set(NONE, { ...wider.get(NONE)!, shadow: 'shadow' });
    expect(optionSwitchWhitelistDrift(wider)).toContain(
      `wider shadow level in the database than in the registry: ${NONE} (shadow -> none)`
    );
    expect(optionSwitchAllowShadowCallsNeeded(wider, A)).toEqual([]);
    const narrow = optionSwitchRegisterCallsNeeded(wider, A);
    expect(narrow).toEqual([register(NONE, false, A, 'plain', 'none')]);
    applyOptionSwitchWhitelistCall(wider, narrow[0]!);
    expect(optionSwitchWhitelistDrift(wider)).toBeNull();
    // what is refused
    expect(() => install([[register('laneStyle', false, A, 'style', 'shadow')]])).toThrow(
      /own shadow arm/
    );
    expect(() => install([[register('laneHeld', true, A, 'plain', 'on_shadow')]])).toThrow(
      /takes off alone/
    );
    const allow = (option: string, shadow: OptionSwitchShadowLevel): OptionSwitchWhitelistCall => ({
      fn: 'allow_shadow',
      option,
      shadow,
      migration: B,
    });
    expect(() => install([[allow(HELD, 'on_shadow')]])).toThrow(/lift the hold by name/);
    expect(() => install([[allow(SH, 'on_shadow')]])).toThrow(/narrower level is a register call/);
    expect(() => install([[allow(STYLE_SWITCH_OPTIONS[0]!, 'shadow')]])).toThrow(/own shadow arm/);
    expect(() => install([[allow('notRegistered', 'shadow')]])).toThrow(/is not registered/);
    // through the files, a wider level is reported for the law to hold against the approved list
    const text =
      `BEGIN;\nSET LOCAL lock_timeout = '3s';\n` +
      `SELECT public.fn_ca_horse_option_allow_shadow('${NONE}', 'on_shadow', '${B}');\nCOMMIT;\n`;
    expect(optionSwitchRegisterMigrationRefusal({ name: `${B}.sql`, text })).toBeNull();
    const widened = optionSwitchWhitelistFromMigrations([...DISK, { name: `${B}.sql`, text }]);
    expect(widened.explicit).toEqual([`${B}:allow_shadow:${NONE}`]);
    expect(optionSwitchWhitelistDrift(widened.whitelist)).toContain(
      `wider shadow level in the database than in the registry: ${NONE} (on_shadow -> none)`
    );
    // the generator's file may hold register and allow_shadow calls of its own
    const both = optionSwitchRegisterSql(A, [
      register('laneOption', false, A),
      { fn: 'allow_shadow', option: NONE, shadow: 'shadow', migration: A },
    ]);
    expect(optionSwitchRegisterMigrationRefusal({ name: `${A}.sql`, text: both })).toBeNull();
  });
});
