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
import { readMigration } from './helpers/migrations';

const INTRODUCED =
  '20261109235153_a_closed_persons_tournament_name_is_read_through_the_public_.sql';
const SQL = readMigration(INTRODUCED);

describe('the closed-person label has one definition', () => {
  it('is a closed profile that is not a horse, labelled by its scrubbed profile', () => {
    expect(SQL).toMatch(
      /CREATE VIEW public\.ca_closed_player_labels AS\s+SELECT p\.id,\s+COALESCE\(NULLIF\(btrim\(p\.username\), ''\), 'Player'\) AS label\s+FROM public\.profiles p\s+WHERE p\.status = 'deleted' AND p\.is_horse IS NOT TRUE;/
    );
  });

  it('is served by an index with the same predicate', () => {
    expect(SQL).toContain(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_closed_person ON public.profiles USING btree (id) WHERE status = 'deleted' AND is_horse IS NOT TRUE;"
    );
  });
});

describe('tournament_players_public', () => {
  it('answers a closed person with the label, staff with the recorded name', () => {
    expect(SQL).toMatch(
      /CASE\s+WHEN closed\.id IS NULL THEN tp\.username\s+WHEN \(SELECT public\.fn_is_platform_admin\(\)\) THEN tp\.username\s+ELSE closed\.label\s+END AS username/
    );
    expect(SQL).toContain(
      'LEFT JOIN public.ca_closed_player_labels closed ON closed.id = tp.user_id;'
    );
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
