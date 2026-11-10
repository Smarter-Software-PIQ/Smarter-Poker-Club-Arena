/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A CLOSED PERSON'S TOURNAMENT NAME IS NOT PUBLIC (2026-11-09, binding)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * tournament_players.username is the name a player held at registration. A
 * finished tournament's rows are immutable evidence, so closing an account left
 * that name in the column every client can read: results pages printed it and
 * the REST API returned it.
 *
 * THE LAW: ordinary readers get tournament players through
 * public.tournament_players_public, which answers a closed person's username
 * with the label the scrubbed profile carries. Stored rows never change, staff
 * still read the recorded name, and a retired horse (a house character, not a
 * person) keeps its name. The results functions that returned tp.username read
 * the same view.
 *
 * Registry: docs/laws.d/a-closed-persons-tournament-name-is-not-public.md
 */
import { describe, expect, it } from 'vitest';
import { migrationFiles, readMigration } from './helpers/migrations';

const INTRODUCED =
  '20261109235153_a_closed_persons_tournament_name_is_read_through_the_public_.sql';
const SQL = readMigration(INTRODUCED);
const VIEW = readMigration(
  '20261110004344_the_public_tournament_view_checks_staff_without_a_function_a.sql'
);
const OWNER_RIGHTS = readMigration(
  '20261110051146_the_public_tournament_views_read_with_their_owners_rights.sql'
);
const POLICY = readMigration(
  '20261110003726_a_closed_persons_tournament_rows_are_read_through_the_public.sql'
);
const LISTED = readMigration(
  '20261110152707_a_closed_persons_label_is_listed_only_where_results_name_the.sql'
);

describe('the closed-person label has one definition', () => {
  it('is a closed profile that is not a horse, labelled by its scrubbed profile', () => {
    expect(SQL).toMatch(
      /CREATE VIEW public\.ca_closed_player_labels AS\s+SELECT p\.id,\s+COALESCE\(NULLIF\(btrim\(p\.username\), ''\), 'Player'\) AS label\s+FROM public\.profiles p\s+WHERE p\.status = 'deleted' AND p\.is_horse IS NOT TRUE;/
    );
  });

  // Ordinary readers may select the label view (the read policy asks it as
  // them), so it lists only people a tournament result already names. It must
  // never become a directory of who closed an account.
  it('lists a closed person only where a tournament result names them', () => {
    expect(LISTED).toMatch(
      /CREATE OR REPLACE VIEW public\.ca_closed_player_labels\s+WITH \(security_invoker = false\) AS\s+SELECT p\.id,\s+COALESCE\(NULLIF\(btrim\(p\.username\), ''\), 'Player'\) AS label\s+FROM public\.profiles p\s+WHERE p\.status = 'deleted'\s+AND p\.is_horse IS NOT TRUE\s+AND EXISTS \(SELECT 1 FROM public\.tournament_players tp WHERE tp\.user_id = p\.id\);/
    );
    expect(LISTED).toContain(
      'GRANT SELECT ON public.ca_closed_player_labels TO anon, authenticated, service_role;'
    );
    for (const file of migrationFiles().filter((f) => f > '20261110152707')) {
      const sql = readMigration(file);
      if (!/CREATE (?:OR REPLACE )?VIEW\s+public\.ca_closed_player_labels\b/i.test(sql)) continue;
      expect(sql, file).toMatch(
        /EXISTS \(SELECT 1 FROM public\.tournament_players tp WHERE tp\.user_id = p\.id\)/
      );
    }
  });

  it('is served by an index with the same predicate', () => {
    expect(SQL).toContain(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_closed_person ON public.profiles USING btree (id) WHERE status = 'deleted' AND is_horse IS NOT TRUE;"
    );
  });
});

describe('tournament_players_public', () => {
  it('answers a closed person with the label, staff with the recorded name', () => {
    expect(VIEW).toMatch(
      /CASE\s+WHEN closed\.id IS NULL THEN tp\.username\s+WHEN EXISTS \(\s+SELECT 1 FROM public\.profiles reader\s+WHERE reader\.id = \(SELECT auth\.uid\(\)\)\s+AND reader\.role IN \('admin', 'superadmin', 'god'\)\s+\) THEN tp\.username\s+ELSE closed\.label\s+END AS username/
    );
    expect(VIEW).toContain(
      'LEFT JOIN public.ca_closed_player_labels closed ON closed.id = tp.user_id;'
    );
  });

  it('names no function a signed-out reader cannot call', () => {
    // A function in a view runs with the reader's privileges. anon may not
    // execute fn_is_platform_admin, so naming it refused every signed-out
    // read of username.
    const body = VIEW.slice(
      VIEW.indexOf('CREATE OR REPLACE VIEW public.tournament_players_public')
    );
    expect(body).not.toContain('fn_is_platform_admin');
  });

  it('is read-only for players and refuses to install with a column missing', () => {
    expect(SQL).toContain(
      'REVOKE ALL ON public.tournament_players_public FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(SQL).toContain(
      'GRANT SELECT ON public.tournament_players_public TO anon, authenticated, service_role;'
    );
    expect(SQL).toMatch(/IF v_base <> v_view THEN\s+RAISE EXCEPTION/);
  });

  it('moves every results function that returned tp.username onto the view', () => {
    for (const fn of [
      'fn_mystery_bounty_awards(uuid,integer,integer)',
      'fn_mystery_bounty_leaderboard(uuid)',
      'fn_mystery_bounty_table_state(uuid)',
      'fn_spin_leaderboards(integer)',
    ]) {
      expect(SQL).toContain(`'public.${fn}'::regprocedure`);
    }
    expect(SQL).toContain(
      "replace(d, 'public.tournament_players ', 'public.tournament_players_public ')"
    );
    expect(SQL).toMatch(/RAISE EXCEPTION '% still reads the base table'/);
  });
});

describe('the table itself withholds a closed person from ordinary readers', () => {
  it('waits for the daily window, because a policy needs ACCESS EXCLUSIVE', () => {
    expect(POLICY.split('\n')[0]).toBe('-- @install-window: daily-maintenance');
  });

  it('is restrictive, for reads only, and exempts signed-in staff', () => {
    expect(POLICY).toMatch(
      /CREATE POLICY a_closed_persons_rows_are_read_through_the_public_view\s+ON public\.tournament_players\s+AS RESTRICTIVE\s+FOR SELECT\s+TO authenticated\s+USING \(\s+\(SELECT public\.fn_is_platform_admin\(\)\)\s+OR NOT EXISTS \(\s+SELECT 1 FROM public\.ca_closed_player_labels closed\s+WHERE closed\.id = tournament_players\.user_id\)\s+\);/
    );
  });

  it('gives anon its own policy, naming no function anon cannot call', () => {
    const anon = POLICY.slice(
      POLICY.indexOf('CREATE POLICY a_closed_persons_rows_are_read_through_the_public_view_anon')
    );
    expect(anon).toMatch(/AS RESTRICTIVE\s+FOR SELECT\s+TO anon\s+USING \(\s+NOT EXISTS \(/);
    expect(anon).not.toContain('fn_is_platform_admin');
  });
});

describe("both views read with their owner's rights, and say so", () => {
  // trg_new_view_respects_the_caller makes a new public view caller-rights
  // unless it declares otherwise. Caller rights cannot mask: the reader may not
  // read the columns that say who is closed, and the table's own policy would
  // hide the row the view exists to label.
  it('declares security_invoker = false on each, explicitly', () => {
    expect(OWNER_RIGHTS).toContain(
      'ALTER VIEW public.ca_closed_player_labels SET (security_invoker = false);'
    );
    expect(OWNER_RIGHTS).toContain(
      'ALTER VIEW public.tournament_players_public SET (security_invoker = false);'
    );
  });

  it('is never turned back into a caller-rights view', () => {
    for (const file of migrationFiles().filter((f) => f > '20261110051146')) {
      const sql = readMigration(file);
      if (!/tournament_players_public|ca_closed_player_labels/.test(sql)) continue;
      expect(sql, file).not.toMatch(
        /ALTER VIEW\s+public\.(?:tournament_players_public|ca_closed_player_labels)\s+SET\s+\(\s*security_invoker\s*=\s*true/i
      );
      // A re-created view is reset by the trigger unless it declares itself.
      for (const view of ['tournament_players_public', 'ca_closed_player_labels']) {
        if (new RegExp(`CREATE (?:OR REPLACE )?VIEW\\s+public\\.${view}\\b`, 'i').test(sql)) {
          expect(sql, `${file} re-creates ${view}`).toMatch(
            new RegExp(`public\\.${view}[\\s\\S]*security_invoker\\s*=\\s*false`, 'i')
          );
        }
      }
    }
  });
});
