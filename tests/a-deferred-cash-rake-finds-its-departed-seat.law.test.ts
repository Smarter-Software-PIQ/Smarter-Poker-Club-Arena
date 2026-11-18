/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - A DEFERRED CASH RAKE FINDS ITS DEPARTED SEAT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * #11256 (2026-11-18) moved cash rake out of the hand's own commit into a
 * stored obligation that a later continuation banks. fn_cash_earning_club read
 * the earning club only from a LIVE table_seats row covering the hand's start,
 * which was always present while rake banked inside the commit. Now a
 * participant can leave and have their chair reseated before the rake banks:
 * hand 59989058's horse left two seconds after the hand, the must-move balancer
 * reseated its chair two seconds later, and the obligation failed 23514
 * cash_earning_seat_provenance_missing_or_ambiguous on every following hand
 * (675 attempts in 14 minutes) until fn_post_commit_stranded_watchdog paged.
 *
 * The law: when no live chair row covers the start, the earning club is the
 * club of the participant's FIRST exit at that table at or after the start
 * (ca_seat_stack_exits, immutable). A live chair row still wins, the union
 * branch still refuses a missing or foreign club, and no later migration may
 * redefine fn_cash_earning_club without this fallback.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_deferred_cash_rake_finds_its_departed_seat.sql'))
  .at(-1);
if (!NAME) throw new Error('the departed-seat provenance migration is missing');
const MIG = migrationText(NAME);
const VERSION = NAME.slice(0, 14);
const SIG = 'public.fn_cash_earning_club(uuid,uuid,uuid,uuid,uuid)';

const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`window ${a} .. ${b} not found`);
  return s.slice(i, j);
};

describe('a deferred cash rake finds its departed seat', () => {
  it('pins the reader by preimage and postimage', () => {
    expect(MIG).toContain(
      `'${SIG}',\n  '2ba3a2891019b46e06b46b4c642e566a', '625ef5361cf04730ba87d4531700a029'`
    );
  });

  for (const [tag, branch] of [
    ['n1', 'private'],
    ['n2', 'shared union'],
  ] as const) {
    it(`the ${branch} branch falls back to the first exit after the start, only when no live chair answers`, () => {
      const n = between(MIG, `$${tag}$`, `$${tag}$`);
      const live = n.indexOf(
        'AND s.joined_at<=started AND (s.left_at IS NULL OR s.left_at>started);'
      );
      const guard = n.indexOf('IF clubs IS NULL THEN');
      expect(live).toBeGreaterThanOrEqual(0);
      expect(guard).toBeGreaterThan(live);
      expect(n).toContain('FROM public.ca_seat_stack_exits e');
      expect(n).toContain(
        'e.user_id=p_player_id AND e.table_id=p_table_id AND e.occurred_at>=started'
      );
      expect(n).toContain('ORDER BY e.occurred_at, e.id LIMIT 1');
    });
  }

  it('keeps the union validation and its refusal after the fallback', () => {
    const n2 = between(MIG, '$n2$', '$n2$');
    expect(n2.trimEnd().endsWith('IF cardinality(clubs) IS DISTINCT FROM 1')).toBe(true);
    expect(n2).toContain('AND e.club_id IS NOT NULL');
  });

  it('no later migration redefines the reader without the departed-seat fallback', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      const touches =
        /FUNCTION\s+public\.fn_cash_earning_club\s*\(/i.test(m.sql) ||
        m.sql.includes("pg_get_functiondef('public.fn_cash_earning_club(");
      if (!touches) continue;
      expect(m.sql, m.name).toContain('THE CHAIR CAN BE GONE BY THE TIME THE RAKE BANKS');
      expect(m.sql, m.name).toContain('public.ca_seat_stack_exits');
    }
  });
});
