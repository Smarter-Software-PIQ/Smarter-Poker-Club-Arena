/**
 * HEADS-UP REMATCH COPIES FOLLOW THEIR SOURCES (2026-11-25)
 *
 * 20261109021122 copies eight buy-in layers for a named payer and pins the md5
 * of each source; the rematch core refuses every rematch while a pin does not
 * match. On 2026-11-19 two migrations replaced two of those sources from a
 * list, in place, and re-derived nothing. From 2026-11-20 every accepted
 * heads-up "Play Again" ended "unavailable" (5 of 5, after 23 matched), for
 * six days, and nothing but a player could see it.
 *
 * 20261126000707 keeps the derivation as one procedure,
 * smarter_private.heads_up_rematch_rederive(), runs it, and this law makes
 * every later migration that can replace a pinned source run it too.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((file) => /^\d{14}_.*\.sql$/.test(file));
const read = (file: string) => readFileSync(join(DIR, file), 'utf8');
const code = (sql: string) => sql.replace(/^\s*--[^\n]*$/gm, '');
const one = (suffix: string) => {
  const found = files.filter((file) => file.endsWith(suffix));
  if (found.length !== 1) throw new Error(`Expected one migration ending ${suffix}`);
  return found[0];
};

const ORIGINAL = one('_heads_up_rematch_atomic_buy_in.sql');
const REDERIVE = one('_heads_up_rematch_copies_follow_their_changed_sources.sql');
const REDERIVE_CALL = 'smarter_private.heads_up_rematch_rederive()';

/** The eight pinned sources of public.ca_heads_up_rematch_sources. */
const PINNED_SOURCES = [
  'fn_register_for_tournament_before_atomic_capacity_20260907',
  'fn_register_for_tournament_before_atomic_lifecycle_gate',
  'fn_register_for_tournament_before_maintenance_announcement_gate',
  'fn_register_for_tournament_before_terminal_seat_gate',
  'fn_register_for_tournament',
  'fn_take_seat_and_buy_in_before_maintenance_announcement_gate',
  'fn_take_seat_and_buy_in_before_terminal_seat_gate',
  'fn_take_seat_and_buy_in',
];

/**
 * Migrations that already named a pinned source in a file that can rewrite a
 * function when this law landed. The two of 2026-11-19 are the ones that broke
 * the rematch; all six were followed by 20261126000707, which re-derived every
 * copy from the installed sources and proved no pin was left drifted. This
 * list may only shrink.
 */
const RE_DERIVED_BY_20261126000707 = [
  '20261119052513_a_late_registration_never_pauses_the_tournament.sql',
  '20261119185300_remaining_tournament_row_locks_never_block_hands.sql',
  '20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id.sql',
  '20261123013126_a_private_game_holds_its_seats_for_invited_friends.sql',
  '20261123071654_a_sit_and_go_holds_seats_for_invited_friends.sql',
  '20261123191738_player_created_private_heads_up_and_spin_matches.sql',
];

/** The pinned sources a migration can replace: by a direct definition, or by name in a file that EXECUTEs. */
function pinnedSourcesAMigrationCanReplace(sql: string): string[] {
  const body = code(sql);
  const dynamic = /\bEXECUTE\b/.test(body);
  return PINNED_SOURCES.filter((name) => {
    if (new RegExp(`FUNCTION\\s+public\\.${name}\\s*\\(`).test(body)) return true;
    return dynamic && new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(body);
  });
}

describe('heads-up rematch copies follow their sources', () => {
  const original = read(ORIGINAL);
  const rederive = read(REDERIVE);
  const body = code(rederive);

  it('the kept derivation is the reviewed one, byte for byte', () => {
    const start = 'DO $derive$\nDECLARE d text;\nBEGIN\n';
    const from = original.indexOf(start);
    const to = original.indexOf('END\n$derive$;');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    let reads = 0;
    const expected = original
      .slice(from + start.length, to)
      .replace(
        /pg_temp\.ca_rematch_source\('([^']+)',\n\s+pg_get_functiondef\('([^']+)'::regprocedure\)\)/g,
        (_all, pinned: string, readFrom: string) => {
          expect(readFrom).toBe(pinned);
          reads += 1;
          return `pg_get_functiondef('${pinned}'::regprocedure)`;
        }
      )
      .replaceAll('pg_temp.ca_rematch_swap(', 'smarter_private.heads_up_rematch_swap(')
      .replaceAll('pg_temp.ca_rematch_install(', 'smarter_private.heads_up_rematch_install(');
    expect(reads).toBe(8);
    expect(expected).not.toContain('pg_temp');
    expect(rederive).toContain(expected);
    for (const name of PINNED_SOURCES) expect(expected).toContain(`'public.${name}(`);
  });

  it('is one transaction that refuses any source change nobody reviewed', () => {
    expect(body.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(body.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(body).toContain('heads_up_rematch_rederive: unreviewed source change in %');
    expect(body).toContain("'public.fn_register_for_tournament(uuid,boolean)',");
    expect(body).toContain(
      "'public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)');"
    );
  });

  it('refuses a moved anchor, a copy that reads the caller, and a copy a browser can run', () => {
    expect(body).toContain("'heads_up_rematch_anchor_%: found % times, expected %'");
    expect(body).toContain("'heads_up_rematch_copy_reads_auth_uid: %'");
    expect(body).toContain("'heads_up_rematch_copy_reads_the_caller_session: %'");
    expect(body).toContain(
      "EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', p_signature);"
    );
    expect(body).toContain(
      "'heads_up_rematch_rederive: % is executable by a browser or service role'"
    );
  });

  it('re-pins every source, proves none is left drifted, and is safe to run twice', () => {
    expect(body).toContain('SET source_md5 = md5(pg_get_functiondef(r.source::regprocedure))');
    expect(body).toContain("'heads_up_rematch_rederive: still drifted after the derivation: %'");
    expect(body).toContain("'heads_up_rematch_rederive: a second run re-pinned something'");
    expect(body).toContain(`PERFORM ${REDERIVE_CALL};`);
  });

  it('no browser and no service role can run the derivation or its helpers', () => {
    for (const signature of [
      'smarter_private.heads_up_rematch_swap(text, text, text, integer, text)',
      'smarter_private.heads_up_rematch_install(text, text)',
      REDERIVE_CALL,
    ]) {
      expect(body).toContain(
        `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role;`
      );
    }
    expect(body).not.toMatch(/GRANT\s+EXECUTE/);
    // Each copy's grants are said out loud in the file, not only inside the installer.
    expect(
      body.match(
        /^REVOKE ALL ON FUNCTION public\.fn_ca_rematch_[a-z_]+_for_payer\(uuid,(boolean|integer),uuid\) FROM PUBLIC, anon, authenticated, service_role;$/gm
      )
    ).toHaveLength(8);
  });

  it('runs the two changed copies once before COMMIT', () => {
    for (const copy of [
      'fn_ca_rematch_register_for_payer',
      'fn_ca_rematch_register_core_for_payer',
    ]) {
      expect(rederive).toContain(`-- @probe-for: public.${copy}\n`);
      expect(body).toContain(
        `PERFORM public.${copy}(gen_random_uuid(), false, gen_random_uuid());`
      );
    }
    expect(body.match(/RAISE EXCEPTION 'probe-unwind';/g)).toHaveLength(2);
  });

  it('the scan sees a direct replacement and a list-driven one, and not a longer name', () => {
    expect(
      pinnedSourcesAMigrationCanReplace(
        'CREATE OR REPLACE FUNCTION public.fn_take_seat_and_buy_in(p_table_id uuid) RETURNS jsonb'
      )
    ).toEqual(['fn_take_seat_and_buy_in']);
    expect(
      pinnedSourcesAMigrationCanReplace(
        "FOR r IN SELECT * FROM (VALUES ('public.fn_register_for_tournament(uuid,boolean)')) LOOP EXECUTE x; END LOOP;"
      )
    ).toEqual(['fn_register_for_tournament']);
    expect(
      pinnedSourcesAMigrationCanReplace(
        "PERFORM public.fn_register_for_tournament_with_ticket(a, b); EXECUTE 'x';"
      )
    ).toEqual([]);
    expect(
      pinnedSourcesAMigrationCanReplace('-- public.fn_take_seat_and_buy_in\nEXECUTE x;')
    ).toEqual([]);
    expect(
      pinnedSourcesAMigrationCanReplace('PERFORM public.fn_take_seat_and_buy_in(a, 1);')
    ).toEqual([]);
  });

  it('the two migrations that broke the rematch are exactly what the scan would have caught', () => {
    for (const file of RE_DERIVED_BY_20261126000707.slice(0, 2)) {
      expect(pinnedSourcesAMigrationCanReplace(read(file)).length).toBeGreaterThan(0);
      expect(read(file)).not.toContain(REDERIVE_CALL);
    }
  });

  it('every migration that can replace a pinned source re-derives the copies', () => {
    for (const file of RE_DERIVED_BY_20261126000707) expect(files).toContain(file);
    const missing = files
      .filter((file) => file > ORIGINAL && !RE_DERIVED_BY_20261126000707.includes(file))
      .map((file) => ({ file, sql: read(file) }))
      .filter(({ sql }) => pinnedSourcesAMigrationCanReplace(sql).length > 0)
      .filter(({ sql }) => !code(sql).includes(REDERIVE_CALL))
      .map(({ file, sql }) => `${file}: ${pinnedSourcesAMigrationCanReplace(sql).join(', ')}`);
    expect(
      missing,
      'These migrations can replace a buy-in layer the heads-up rematch copies. End each with ' +
        `"DO $$ BEGIN PERFORM ${REDERIVE_CALL}; END $$;" inside its transaction, or every ` +
        'accepted rematch is refused as unavailable (2026-11-20 to 2026-11-25).'
    ).toEqual([]);
  });
});
