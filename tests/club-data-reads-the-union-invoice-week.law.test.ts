/**
 * ===========================================================================
 *  LAW - CLUB DATA READS THE UNION INVOICE WEEK FROM THE INVOICE
 * ===========================================================================
 *
 * Owner, 2026-11-14: "The data page display data starts and stops at the same
 * 2AM time that the invoices are appearing as; the data on this page should
 * match the invoices 1:1."
 *
 * Measured that day for the week 2026-11-02 08:00Z to 2026-11-09 08:00Z: the
 * KINGS CLUB invoice said rake 25,854.24 and player net loss 37,160.83 while
 * Club Data, asked for Nov 2 to Nov 9, said fee 1,568.03 and winnings
 * -5,502.27. The page counted eight midnight days, moved horses to their
 * current club at display time and used its own definitions.
 *
 * The fix is not a second calculation that is compared with the invoice
 * afterwards. An invoice week on Club Data IS the issued invoice
 * (ca_club_data_union_weeks reads settlement_invoices), on the invoice's own
 * boundary (fn_ca_accounting_day_start = fn_union_week_start on a Monday).
 * Every pin below fails silently if it regresses: the page keeps rendering
 * and a week quietly becomes eight days or somebody's recomputation again.
 *
 * Qualified on real Postgres, to the cent, with the production week as the
 * fixture, by scripts/ci/test-club-data-union-invoice-week.py.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { functionBody, latestDeclaring } from './helpers/migrations';
import { accountingDay } from '../src/lib/clubDataDay';

const squash = (s: string) => s.replace(/\s+/g, ' ');
function latest(fnName: string): string {
  return squash(
    functionBody(latestDeclaring(fnName).sql, fnName)
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
  );
}
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the accounting day is 02:00 to 02:00 Chicago, the invoice boundary', () => {
  it('takes the two hours off the Chicago wall clock, so daylight saving is the zone database', () => {
    expect(latest('fn_ca_accounting_day')).toContain(
      "SELECT ((p_at AT TIME ZONE 'America/Chicago') - interval '2 hours')::date;"
    );
    expect(latest('fn_ca_accounting_day_start')).toContain(
      "SELECT (p_day::timestamp + interval '2 hours') AT TIME ZONE 'America/Chicago';"
    );
  });

  it('the migration proves every Monday starts on fn_union_week_start before it commits', () => {
    const sql = squash(latestDeclaring('fn_ca_accounting_day_start').sql);
    expect(sql).toContain(
      'public.fn_ca_accounting_day_start(d) IS DISTINCT FROM public.fn_union_week_start(public.fn_ca_accounting_day_start(d))'
    );
    expect(sql).toContain(
      "generate_series(date '2025-01-06', date '2028-12-25', interval '7 days')"
    );
  });

  it('the client mirror agrees across both clock changes', () => {
    // Winter: the invoice week 2026-11-02 08:00Z to 2026-11-09 08:00Z.
    expect(accountingDay('2026-11-02T08:00:00Z')).toBe('2026-11-02');
    expect(accountingDay('2026-11-09T07:59:59Z')).toBe('2026-11-08');
    expect(accountingDay('2026-11-09T08:00:00Z')).toBe('2026-11-09');
    // Fall back, Sunday 2026-11-01: 01:30 happens twice, both are Oct 31.
    expect(accountingDay('2026-11-01T06:30:00Z')).toBe('2026-10-31');
    expect(accountingDay('2026-11-01T07:30:00Z')).toBe('2026-10-31');
    expect(accountingDay('2026-11-01T08:00:00Z')).toBe('2026-11-01');
    // Spring forward, Sunday 2026-03-08: 02:00 does not exist; 03:00 CDT starts the day.
    expect(accountingDay('2026-03-08T07:59:59Z')).toBe('2026-03-07');
    expect(accountingDay('2026-03-08T08:00:00Z')).toBe('2026-03-08');
    // Summer: 02:00 CDT is 07:00Z.
    expect(accountingDay('2026-07-15T06:59:59Z')).toBe('2026-07-14');
    expect(accountingDay('2026-07-15T07:00:00Z')).toBe('2026-07-15');
  });
});

describe('an invoice week on Club Data is the issued invoice', () => {
  const body = latest('ca_club_data_union_weeks');

  it('reads the issued document and nothing that recomputes or re-attributes it', () => {
    expect(body).toContain('FROM public.settlement_invoices si');
    expect(body).toContain("si.invoice_type = 'union_weekly_squareup'");
    expect(body).toContain("si.status <> 'cancelled'");
    expect(body).toContain("sum((si.breakdown->>'rake_generated')::numeric) AS fee");
    expect(body).toContain("sum(-(si.breakdown->>'players_won')::numeric) AS loss");
    // Time-of-play attribution is the document's. Never the current horse
    // assignment, never the Club Data facts, never a live recomputation.
    for (const banned of [
      'ca_horse_club_assignments',
      'ca_horse_fleet_register',
      'is_horse',
      'ca_club_data_fact',
      'ca_stats_club_data_fact_ct',
      'fn_ca_club_data_fact_window',
      'fn_union_club_invoice',
      'fn_union_eco_adjustment',
      'fn_union_pnl_evidence_report',
    ]) {
      expect(body).not.toContain(banned);
    }
  });

  it('the end date is the 02:00 boundary the window stops at, never a last day', () => {
    expect(body).toContain('v_from := public.fn_ca_accounting_day_start(p_start);');
    expect(body).toContain('v_to := public.fn_ca_accounting_day_start(p_end);');
    expect(body).toContain('p_end <= p_start');
    expect(body).toContain('sp.start_at >= v_from AND sp.end_at <= v_to');
    expect(body).not.toMatch(/p_end\s*\+\s*1/);
  });

  it('only whole issued weeks count, and coverage is stated, not implied', () => {
    expect(body).toContain(
      'IF r.start_at = v_cover THEN v_cover := r.end_at; ELSE v_gap := true; END IF;'
    );
    expect(body).toContain("'covers_window', (v_n > 0 AND NOT v_gap AND v_cover = v_to)");
    expect(body).toContain("(si.breakdown->>'period_start')::timestamptz = sp.start_at");
  });

  it('whole-club viewers only, and it writes nothing', () => {
    expect(body).toContain('IF NOT public.ca_can_view_whole_club_report(p_club_id) THEN');
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    const sql = squash(latestDeclaring('ca_club_data_union_weeks').sql);
    expect(sql).toContain('RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.ca_club_data_union_weeks(uuid, date, date) FROM PUBLIC, anon;'
    );
  });
});

describe('the page has one source of figures', () => {
  it('no second block competes with the tiles: the page has one source of figures', () => {
    // The owner rejected a summary block beside tiles that disagree with it
    // (2026-11-14). The tiles themselves move to the invoice's records
    // (ca_club_acct_fact, 20261115020010).
    const page = src('src/pages/club/ClubDataSimplePage.tsx');
    expect(page).not.toContain('ClubDataUnionWeeks');
    expect(existsSync(resolve(__dirname, '..', 'src/pages/club/ClubDataUnionWeeks.tsx'))).toBe(false);
  });
});

describe('a renamed club keeps its old slug', () => {
  it('the rename is recorded by the statement that makes it, and the live slug wins', () => {
    const trigger = squash(latestDeclaring('fn_club_slug_keeps_its_history').sql);
    expect(trigger).toContain('-- @install-window: daily-maintenance');
    expect(trigger).toContain('-- @locks: public.clubs');
    expect(trigger).toContain(
      'CREATE TRIGGER trg_club_slug_keeps_its_history AFTER UPDATE OF slug ON public.clubs FOR EACH ROW WHEN (OLD.slug IS DISTINCT FROM NEW.slug)'
    );
    expect(trigger).toContain(
      'CREATE TRIGGER trg_club_slug_refuses_another_clubs_former_slug BEFORE INSERT OR UPDATE OF slug ON public.clubs FOR EACH ROW EXECUTE FUNCTION public.fn_club_slug_refuses_another_clubs_former_slug();'
    );
    const refusal = latest('fn_club_slug_refuses_another_clubs_former_slug');
    expect(refusal).toContain(
      'WHERE h.former_slug = NEW.slug AND h.club_id IS DISTINCT FROM NEW.id;'
    );
    expect(refusal).toContain("USING ERRCODE = '23505'");
    const fn = latest('fn_club_slug_keeps_its_history');
    expect(fn).toContain('DELETE FROM public.club_slug_history h WHERE h.former_slug = NEW.slug;');
    expect(fn).toContain('VALUES (OLD.slug, NEW.id)');
    expect(latest('ca_club_id_for_slug')).toContain(
      '(SELECT c.id FROM public.clubs c WHERE c.slug = p_slug LIMIT 1)'
    );
  });

  it('the 2026-11-14 production rename is recorded, with no foreign key to clubs', () => {
    const sql = squash(latestDeclaring('ca_club_id_for_slug').sql);
    expect(sql).toContain("SELECT 'club-jaqk', c.id, timestamptz '2026-11-14 00:00:00+00'");
    expect(sql).toContain("AND c.slug = 'the-felt-society'");
    expect(sql).not.toMatch(/REFERENCES\s+public\.clubs/i);
  });

  it('the one client resolver reads the history when no club holds the slug, without an RPC', () => {
    const resolver = src('src/utils/clubIdResolver.ts');
    expect(resolver).toContain("if (!error && filter.column === 'slug') {");
    expect(resolver).toContain(".from('club_slug_history')");
    expect(resolver).toContain(".eq('former_slug', clubIdParam)");
    // The resolver fronts 100+ callers that sequence their own RPCs.
    expect(resolver).not.toContain('supabase.rpc(');
    const sql = squash(latestDeclaring('ca_club_id_for_slug').sql);
    expect(sql).toContain(
      'GRANT SELECT ON public.club_slug_history TO authenticated, service_role;'
    );
    // A real predicate (the club the row names is one the caller can read),
    // never a permissive USING (true) (tests/anon-is-not-a-public-table-reader).
    expect(sql).toContain(
      'FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_slug_history.club_id));'
    );
    expect(sql).not.toContain('USING (true)');
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*club_slug_history/i);
  });
});
