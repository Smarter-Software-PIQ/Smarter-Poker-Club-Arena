/**
 * AN IN-LIFE ORPHANED RESERVED PERMIT RECOVERS WITHOUT A WATCHDOG KILL
 * (2026-11-12, issue #10564, Dan: "GET TO THE ROOT CAUSE OF ANY AND ALL BUGS").
 *
 * Production, 2026-11-12 02:20Z, Nightly 20K: four tables held a `reserved`
 * F06 permit of their own live generation (its in-memory owner lost across the
 * synchronized break + table-balancing moves) that they never reconciled. The
 * allocator was refused `hand_permit_unresolved` on every deal for ~70s;
 * resolveUnstartedF06Permit could not help (no live permit object was held),
 * and the abandoned-generation door only fires once the generation is dead, so
 * the ONLY recovery was a watchdog kill + rebuild — a 70s freeze and a reseat
 * per table (permit rows 58702055 / 58702058 / 58702051 / 58702059, all
 * resolved by the NEXT generation's shared disposition cdc5047d).
 *
 * The fix: the dealing loop resolves its own current-generation unstarted
 * reserved row in place, once per refusal, through the evidence-guarded cancel
 * door — gated to this dealer's own generation. These tests drive the real
 * engine hook against a fake SQL that keeps the one-reserved-permit-per-table
 * rule and the cancel door's evidence refusal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: () => {
      throw new Error('Unexpected database write');
    },
    rpc: () => {
      throw new Error('Unexpected database RPC');
    },
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('../services/engineAlerts.js', () => ({
  raiseEngineAlert: vi.fn(async () => true),
  resolveEngineAlert: vi.fn(async () => true),
  firingFingerprints: vi.fn(() => []),
}));
import { raiseEngineAlert } from '../services/engineAlerts.js';
import { ServerTableEngine } from './ServerTableEngine.js';

const ids = {
  tournament_id: 'aaaaaaaa-0000-4000-8000-0000000000e1',
  lease_generation: 'bbbbbbbb-0000-4000-8000-0000000000e1',
  table_id: 'cccccccc-0000-4000-8000-0000000000e1',
  custody_id: 'eeeeeeee-0000-4000-8000-0000000000e1',
  lifecycle: '2114097',
};
const OTHER_GENERATION = 'dddddddd-0000-4000-8000-0000000000e1';

type Row = {
  permit_id: string;
  generation: string;
  hand_number: string;
  state: 'reserved' | 'never_started' | 'accepted';
  evidence_id: string | null;
  hasStartEvidence: boolean;
};

const engines: any[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.cancelHorseDecisionWork?.();
    engine.running = false;
    (ServerTableEngine as any).releaseCurrentEngine(engine.tableId, engine);
    engine.preciseTimer.dispose();
    engine.engineTelemetry.dispose();
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Build an engine with the allocator + the own-reserved reconciler installed,
 *  over a fake SQL `db` the test seeds. The reconciler closure mirrors the
 *  TournamentManager's: own-generation gate + evidence-guarded cancel door. */
function fixture() {
  const engine = new ServerTableEngine(ids.table_id, {
    scope: 'tournament',
    verified: true,
    tournamentId: ids.tournament_id,
    generation: ids.lease_generation,
    proofDeadlineMonotonicMs: performance.now() + 30_000,
  }) as any;
  engines.push(engine);
  expect(engine.claimProcessOwnership()).toBe(true);

  const db = new Map<string, Row>();
  const reservedOf = (gen: string) =>
    [...db.values()].find((r) => r.state === 'reserved' && r.generation === gen);
  const anyReserved = () => [...db.values()].find((r) => r.state === 'reserved');

  const state = () => {
    const r = anyReserved();
    if (r) {
      return {
        ok: true,
        table_id: ids.table_id,
        lifecycle: ids.lifecycle,
        can_reserve: false,
        blocked_reason: 'hand_permit_unresolved',
        used_hand_number_max: '58702000',
        next_hand_number_candidate: null,
        unresolved_permit: {
          permit_id: r.permit_id,
          generation: r.generation,
          table_id: ids.table_id,
          tournament_id: ids.tournament_id,
          lifecycle: ids.lifecycle,
          hand_number: r.hand_number,
          custody_id: ids.custody_id,
          state: 'reserved',
          evidence_id: r.evidence_id,
        },
      };
    }
    return {
      ok: true,
      table_id: ids.table_id,
      lifecycle: ids.lifecycle,
      can_reserve: true,
      blocked_reason: null,
      used_hand_number_max: '58702000',
      next_hand_number_candidate: '58702001',
      unresolved_permit: null,
    };
  };

  let cancelCalls = 0;
  const rpc = vi.fn(async (name: string, input: Record<string, unknown>) => {
    if (name === 'fn_f06_hand_number_state') return { data: state(), error: null };
    if (name === 'fn_f06_allocate_hand_number') {
      const s = state();
      if (!s.can_reserve) return { data: { ok: false, reason: s.blocked_reason }, error: null };
      return {
        data: {
          ok: true,
          table_id: ids.table_id,
          lifecycle: ids.lifecycle,
          hand_number: '58702001',
          hand_number_high_water: '58702000',
        },
        error: null,
      };
    }
    if (name === 'fn_f06_cancel_prepared_hand') {
      cancelCalls += 1;
      const permitId = String(input.p_permit_id);
      const row = db.get(permitId);
      if (!row || row.state !== 'reserved')
        return { data: null, error: new Error('F06_PREPARED_NOT_RESERVED') };
      // The evidence-guarded door refuses any permit carrying start evidence.
      if (row.hasStartEvidence)
        return { data: null, error: new Error('F06_PREPARED_START_EVIDENCE') };
      row.state = 'never_started';
      row.evidence_id = permitId;
      return {
        data: {
          ok: true,
          state: 'never_started',
          evidence_id: permitId,
          permit_id: permitId,
          generation: row.generation,
          table_id: ids.table_id,
          tournament_id: ids.tournament_id,
          lifecycle: ids.lifecycle,
          hand_number: row.hand_number,
          custody_id: ids.custody_id,
        },
        error: null,
      };
    }
    throw new Error('unexpected rpc ' + name);
  });

  const current = () => true;
  engine.running = false;
  engine.installF06Allocator(ids.custody_id, async () => 58702001, current, ids.lifecycle);
  // The reconciler closure = the TournamentManager's own-generation gate + the
  // evidence-guarded cancel door, over the same fake SQL.
  engine.installF06OwnReservedPermitReconciler(async () => {
    if (!current()) return 'skipped';
    const probe = await rpc('fn_f06_hand_number_state', {});
    const st = probe.data as any;
    if (
      !st ||
      st.ok !== true ||
      st.can_reserve !== false ||
      st.blocked_reason !== 'hand_permit_unresolved'
    )
      return 'none';
    const p = st.unresolved_permit;
    if (
      !p ||
      p.state !== 'reserved' ||
      p.evidence_id !== null ||
      p.generation !== ids.lease_generation ||
      p.table_id !== ids.table_id ||
      p.tournament_id !== ids.tournament_id ||
      p.lifecycle !== ids.lifecycle
    )
      return 'foreign';
    const cancelled = await rpc('fn_f06_cancel_prepared_hand', { p_permit_id: p.permit_id });
    if (cancelled.error) return 'evidence';
    const done = cancelled.data as any;
    if (
      !done ||
      done.ok !== true ||
      done.state !== 'never_started' ||
      done.permit_id !== p.permit_id
    )
      return 'none';
    return 'resolved';
  });
  engine.running = true;

  const seedReserved = (gen: string, hasStartEvidence = false): Row => {
    const row: Row = {
      permit_id: randomUUID(),
      generation: gen,
      hand_number: '58702055',
      state: 'reserved',
      evidence_id: null,
      hasStartEvidence,
    };
    db.set(row.permit_id, row);
    return row;
  };

  return { engine, db, rpc, reservedOf, anyReserved, seedReserved, cancelCalls: () => cancelCalls };
}

describe('an in-life orphaned reserved permit recovers without a watchdog kill', () => {
  it("resolves this dealer's own current-generation never-started reserved row in place", async () => {
    const f = fixture();
    const orphan = f.seedReserved(ids.lease_generation);
    // Before: the allocator is wedged by the reserved row.
    const blocked = (await f.rpc('fn_f06_allocate_hand_number', {})).data as any;
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('hand_permit_unresolved');

    const outcome = await f.engine.reconcileOwnUnresolvedReservedPermit();

    expect(outcome).toBe('resolved');
    expect(f.db.get(orphan.permit_id)!.state).toBe('never_started');
    // After: allocation is unblocked.
    const ok = (await f.rpc('fn_f06_allocate_hand_number', {})).data as any;
    expect(ok.ok).toBe(true);
  });

  it("refuses to touch another generation's reserved permit (abandoned-generation door's job)", async () => {
    const f = fixture();
    const foreign = f.seedReserved(OTHER_GENERATION);
    const outcome = await f.engine.reconcileOwnUnresolvedReservedPermit();
    expect(outcome).toBe('foreign');
    expect(f.db.get(foreign.permit_id)!.state).toBe('reserved'); // untouched
    expect(f.cancelCalls()).toBe(0);
  });

  it('retains the protective refusal when the evidence-guarded door reports a started hand', async () => {
    const f = fixture();
    const started = f.seedReserved(ids.lease_generation, /* hasStartEvidence */ true);
    const outcome = await f.engine.reconcileOwnUnresolvedReservedPermit();
    expect(outcome).toBe('evidence');
    expect(f.db.get(started.permit_id)!.state).toBe('reserved'); // never cancelled
  });

  it("does nothing when this dealer still holds a live permit (that is resolveUnstartedF06Permit's job)", async () => {
    const f = fixture();
    f.seedReserved(ids.lease_generation);
    f.engine.f06CurrentPermit = { recoveryState: () => 'reserved' }; // holds a live permit
    const outcome = await f.engine.reconcileOwnUnresolvedReservedPermit();
    expect(outcome).toBe('skipped');
    expect(f.cancelCalls()).toBe(0);
  });

  it('returns none when there is no unresolved reserved permit', async () => {
    const f = fixture();
    const outcome = await f.engine.reconcileOwnUnresolvedReservedPermit();
    expect(outcome).toBe('none');
  });

  it('guards its install: not before the allocator, not twice, not while running', () => {
    const bare = new ServerTableEngine(ids.table_id, {
      scope: 'tournament',
      verified: true,
      tournamentId: ids.tournament_id,
      generation: ids.lease_generation,
      proofDeadlineMonotonicMs: performance.now() + 30_000,
    }) as any;
    engines.push(bare);
    expect(bare.claimProcessOwnership()).toBe(true);
    bare.running = false;
    // No allocator yet -> invalid.
    expect(() => bare.installF06OwnReservedPermitReconciler(async () => 'none')).toThrow(
      'f06_own_reserved_reconciler_install_invalid'
    );
    bare.installF06Allocator(
      ids.custody_id,
      async () => 1,
      () => true,
      ids.lifecycle
    );
    bare.installF06OwnReservedPermitReconciler(async () => 'none');
    // Twice -> invalid.
    expect(() => bare.installF06OwnReservedPermitReconciler(async () => 'none')).toThrow(
      'f06_own_reserved_reconciler_install_invalid'
    );
  });
});

describe('the in-place recovery is bounded so a re-orphaning table cannot spin silently (issue #10564, review)', () => {
  it('fast-recovers the first few consecutive resolves, then lets the stall surface', () => {
    const e = fixture().engine as any;
    // MAX_OWN_RESERVED_RESOLVES_WITHOUT_PROGRESS = 3: calls 1..3 fast-recover; the 4th does not.
    expect(e.noteOwnReservedResolveShouldFastRecover()).toBe(true);
    expect(e.noteOwnReservedResolveShouldFastRecover()).toBe(true);
    expect(e.noteOwnReservedResolveShouldFastRecover()).toBe(true);
    expect(raiseEngineAlert).not.toHaveBeenCalled();
    expect(e.noteOwnReservedResolveShouldFastRecover()).toBe(false);
    expect(e.noteOwnReservedResolveShouldFastRecover()).toBe(false);
    expect(raiseEngineAlert).toHaveBeenCalledTimes(1);
  });

  it('resets the moment a real hand deals, so normal one-shot recovery never trips the bound', () => {
    const e = fixture().engine as any;
    for (let i = 0; i < 4; i++) e.noteOwnReservedResolveShouldFastRecover();
    expect(e.noteOwnReservedResolveShouldFastRecover()).toBe(false); // still surfaced
    e.resetOwnReservedResolveProgress(); // a hand actually dealt
    expect(e.noteOwnReservedResolveShouldFastRecover()).toBe(true); // fast recovery again
  });
});
