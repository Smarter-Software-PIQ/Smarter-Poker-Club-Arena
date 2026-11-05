import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BULK_CLOSURE_POLICY,
  BulkClosureRefusedError,
  bulkClosureQuietHours,
  bulkClosureRefusal,
} from './bulkClosureGuard.js';

const idle = { maintenanceActive: false, resuming: false };
const root = path.resolve(__dirname, '../../..');
const MIGRATION = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261105181406_bulk_closure_stays_out_of_live_play.sql'),
  'utf8'
);

describe('a bulk closure stays out of live play', () => {
  it('refuses from :53 through :07 UTC and admits :08 to :52', () => {
    for (const m of [53, 55, 58, 59, 0, 3, 5, 7])
      expect(
        bulkClosureRefusal(new Date(`2026-11-05T10:${String(m).padStart(2, '0')}:00Z`), {
          ...idle,
          entrants: 1,
        })
      ).toBe('break_window');
    for (const m of [8, 20, 52])
      expect(
        bulkClosureRefusal(new Date(`2026-11-05T10:${String(m).padStart(2, '0')}:59Z`), {
          ...idle,
          entrants: 1,
        })
      ).toBeNull();
    // The two incidents: 04:05 (resume) and 05:09 (large event) UTC.
    expect(bulkClosureRefusal(new Date('2026-11-05T04:05:00Z'), { ...idle, entrants: 3 })).toBe(
      'break_window'
    );
  });

  it('refuses while maintenance is active or the resume waves are still running', () => {
    const at = new Date('2026-11-05T10:20:00Z');
    expect(bulkClosureRefusal(at, { maintenanceActive: true, resuming: false, entrants: 1 })).toBe(
      'maintenance_active'
    );
    expect(bulkClosureRefusal(at, { maintenanceActive: false, resuming: true, entrants: 1 })).toBe(
      'resume_settling'
    );
  });

  it('refuses a large event outside the 04:00-06:00 Chicago quiet window', () => {
    // 05:09 UTC = 23:09 Chicago (CST): the Nightly 10K removal that froze 46 tables.
    expect(bulkClosureRefusal(new Date('2026-11-05T05:09:00Z'), { ...idle, entrants: 243 })).toBe(
      'large_outside_quiet_hours'
    );
    expect(bulkClosureRefusal(new Date('2026-11-05T05:09:00Z'), { ...idle, entrants: 50 })).toBe(
      null
    );
    // 10:35 UTC = 04:35 Chicago: inside the quiet window, admitted.
    expect(
      bulkClosureRefusal(new Date('2026-11-05T10:35:00Z'), { ...idle, entrants: 319 })
    ).toBeNull();
    // DST: 09:30 UTC in July is 04:30 CDT.
    expect(bulkClosureQuietHours(new Date('2026-07-01T09:30:00Z'))).toBe(true);
    expect(bulkClosureQuietHours(new Date('2026-11-05T12:00:00Z'))).toBe(false);
  });

  it('refuses when the event size cannot be read', () => {
    expect(bulkClosureRefusal(new Date('2026-11-05T10:20:00Z'), { ...idle, entrants: null })).toBe(
      'size_unknown'
    );
  });

  it('names the reason in the refusal error', () => {
    expect(new BulkClosureRefusedError('break_window').message).toBe('bulk_closure_break_window');
  });

  it('agrees with the database guard on every constant', () => {
    expect(MIGRATION).toContain(
      `c_break_opens_minute CONSTANT integer := ${BULK_CLOSURE_POLICY.breakOpensMinute};`
    );
    expect(MIGRATION).toContain(
      `c_break_closes_minute CONSTANT integer := ${BULK_CLOSURE_POLICY.breakClosesMinute};`
    );
    expect(MIGRATION).toContain(
      `c_large_entrants CONSTANT bigint := ${BULK_CLOSURE_POLICY.largeEntrants};`
    );
    // The database reads the quiet window from daily_window_policy, whose
    // defaults dailyWindow.test.ts already pins to DAILY_WINDOW.
    expect(BULK_CLOSURE_POLICY.quietStart).toBe('04:00');
    expect(BULK_CLOSURE_POLICY.quietEnd).toBe('06:00');
    expect(MIGRATION).toContain('v_local >= p.window_start AND v_local < p.window_end');
  });

  it('wires the admission into every operator bulk closure door', () => {
    for (const [sig, kind] of [
      ['public.fn_ca_settle_tournament_abort(uuid,uuid,text)', 'settle_refund'],
      ['public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)', 'settle_equal_share'],
      ['public.fn_ca_owner_retire_tournament(uuid,uuid,text)', 'owner_retire'],
      ['public.fn_ca_operator_cancel_tournament(uuid,uuid,text,uuid,text)', 'operator_cancel'],
      ['public.fn_ca_request_tournament_abort(uuid,uuid[],text)', 'request_abort'],
    ]) {
      expect(MIGRATION).toContain(`('${sig}',`);
      expect(MIGRATION).toContain(`bulk_closure_admission(''${kind}''`);
    }
  });

  it('the engine refuses before the manager touches any table', () => {
    const src = fs.readFileSync(path.join(root, 'server/src/GameServer.ts'), 'utf8');
    const guard = src.indexOf('await this.assertBulkClosureAdmitted(tournamentId);');
    const method = src.indexOf('  async acknowledgeTournamentAbortBoundary(');
    const end = src.indexOf('\n  }\n', guard);
    const body = src.slice(method, end);
    expect(guard).toBeGreaterThan(method);
    // Every physical step of the method comes after the guard: the manager's
    // park/fence/retire and the closure-hold handoff that stops the manager.
    for (const physical of [
      'manager.acknowledgeTournamentAbortBoundary({ ...data, closureMode })',
      "'GameServer.operator_closure_handoff_stop_failed'",
    ]) {
      const first = body.indexOf(physical);
      expect(first, physical).toBeGreaterThan(body.indexOf('await this.assertBulkClosureAdmitted'));
    }
    // Only two stops come before the guard, and neither closes anything: a
    // settled event's final runtime retirement (no money, no lane), and a
    // withdrawn closure returning its held event to ordinary play.
    const beforeGuard = body.slice(0, body.indexOf('await this.assertBulkClosureAdmitted'));
    expect(beforeGuard.match(/stopTournamentManagerIfOwned\(/g)?.length ?? 0).toBe(2);
    expect(beforeGuard).toContain("'GameServer.tournament_abort_final_stop_failed'");
    expect(beforeGuard).toContain("'GameServer.operator_closure_hold_withdrawn_stop_failed'");
  });
});
