/**
 * The Reliability Controller runs recovery runbooks (owner order 2026-11-19 17:26 Chicago).
 * Four incident classes that escalated as "No automatic recovery exists for this
 * class yet" now have bounded, audited runbooks. Each acts only through its
 * domain's own authority, never silences a class's escalation, and never
 * replaces the root fix. Native proof: scripts/ci/test-reliability-runbooks.py.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const dir = 'supabase/migrations';
const file = fs
  .readdirSync(dir)
  .find((f) => f.endsWith('_the_controller_runs_recovery_runbooks.sql'));
const sql = file ? fs.readFileSync(`${dir}/${file}`, 'utf8') : '';
const body = (name: string) => {
  const start = sql.indexOf(`FUNCTION smarter_private.${name}(`);
  const end = sql.indexOf('$function$;', start);
  return start < 0 ? '' : sql.slice(start, end);
};

describe('the controller runs recovery runbooks', () => {
  it('exists, is proven natively and declares its schedule as product work', () => {
    expect(file).toBeTruthy();
    expect(sql).toMatch(/^-- periodic-work: /m);
    expect(sql).toContain("cron.schedule('reliability-controller-runbooks', '*/2 * * * *'");
    expect(fs.existsSync('scripts/ci/test-reliability-runbooks.py')).toBe(true);
  });

  it('never silences a class: no runbook row may name eligibility.incident_class', () => {
    expect(sql).toContain("CHECK (NOT (eligibility ? 'incident_class'))");
    const seeds = sql.slice(
      sql.indexOf('INSERT INTO smarter_private.reliability_runbooks'),
      sql.indexOf('ON CONFLICT (key, version)')
    );
    expect(seeds).not.toContain('"incident_class"');
    expect(seeds.match(/'enabled', (true|false),/g)?.length).toBe(4);
  });

  it('every attempt is fenced, budgeted and appended to the incident events', () => {
    const run = body('reliability_runbooks_run');
    expect(run).toContain('command_key');
    expect(run).toContain("'runbook_attempt'");
    expect(run).toContain("'runbook_exhausted'");
    expect(run).toContain('min_interval_seconds');
    expect(run).toContain('max_attempts_per_24h');
    expect(run).toContain('EXCEPTION WHEN query_canceled OR OTHERS');
    expect(run).toContain('s.mutation_paused');
    expect(run).toContain('>= 55');
    // A runbook never moves an incident to verifying or recovered itself.
    expect(run).not.toMatch(/reliability_transition\([^)]*'(verifying|recovered|closed)'/);
  });

  it("the spin fill seats only through the seat door, never a person's board, and creates no board", () => {
    const spin = body('reliability_runbook_spin_seat_first_fill');
    expect(spin).toContain('public.fn_seat_horse_in_seat_first_game(b.id, h.id)');
    expect(spin).toContain('public.fn_horses_at_tournament_reservation_budget()');
    expect(spin).toContain("'skipped_human_present'");
    expect(spin).toContain('public.union_clubs uc WHERE uc.union_id = b.union_id');
    expect(spin.match(/reliability_horse_active_now\(p\.id, v_hour\)/g)?.length).toBe(2);
    // The same arithmetic as the engine's horseHash / isActiveNow.
    const behavior = fs.readFileSync('server/src/services/HorseBehavior.ts', 'utf8');
    expect(behavior).toContain('h = (h * 31 + id.charCodeAt(i)) >>> 0;');
    expect(behavior).toContain('const len = 10 + ((h >>> 5) % 8);');
    expect(sql).toContain('h := (h * 31 + ascii(substr(v_text, i, 1))) % 4294967296;');
    expect(sql).toContain('RETURN ((p_hour_utc - (h % 24) + 24) % 24) < 10 + ((h >> 5) % 8);');
    expect(spin).not.toMatch(/INSERT INTO public\.(tournaments|table_seats|tournament_players)/);
    expect(sql).not.toMatch(/INSERT INTO public\.tournaments/);
  });

  it('the cron proof run is allowlisted, needs fix evidence and runs only in the closed window', () => {
    const cron = body('reliability_runbook_cron_proof_run');
    expect(sql).toContain('"allow_functions": ["fn_ca_alarm_drill"]');
    expect(sql).toContain('"window_from": "04:05", "window_to": "05:55"');
    expect(cron).toContain(
      "v_md5 := md5(pg_get_functiondef(to_regprocedure('public.' || v_fn || '()')));"
    );
    expect(cron).toContain("IF v_fn = 'fn_ca_alarm_drill' THEN");
    // The only dynamic statement reads Supabase's migration history.
    expect(cron.match(/EXECUTE\s/g)?.length).toBe(1);
    expect(cron).toContain(
      "EXECUTE 'SELECT max(m.version) FROM supabase_migrations.schema_migrations m'"
    );
  });

  it('the cutover runbook only reads: no engine swap, no dispatch', () => {
    const cut = body('reliability_runbook_cutover_diagnosis');
    expect(cut).not.toMatch(/dispatches|repository_dispatch|POST/);
    expect(cut).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(cut).toContain(
      "'certification_request', 'none: no safe dispatch route for the controller'"
    );
  });

  it('the hand gap runbook resolves only its own source, only when every slow hand is intended', () => {
    const gap = body('reliability_runbook_hand_gap_classification');
    expect(gap).toContain(
      "WHERE fa.id = a.id AND fa.source = 'fn_ca_hand_gap_watch' AND NOT fa.resolved"
    );
    expect(gap).toContain('IF v_total > 0 AND v_intended = v_total AND NOT p_dry_run THEN');
    expect(gap).toContain(
      "key IN ('hand_for_hand', 'tournament_break', 'maintenance_break', 'rebuy')"
    );
  });

  it('the escalation names the runbook instead of claiming none exists', () => {
    expect(sql).toContain('coalesce(smarter_private.reliability_runbook_line(i.id)');
    expect(sql).toMatch(/@live-proof: .*reliability_runbook_line\(i\.id\)/);
  });
});
