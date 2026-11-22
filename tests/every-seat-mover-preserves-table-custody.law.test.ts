/**
 * LAW: EVERY SEAT MOVER PRESERVES TABLE-KEYED CUSTODY (2026-11-21).
 *
 * Incident chain bb04ee5f / e542fbd7 / 887c0008 (table dbbc148e 6-hour outage)
 * happened because `fn_cash_seat_move_execute` moved chips (`table_seats`) and
 * Diamond custody (`fn_poker_diamond_move_custody`) across tables, but forgot
 * table-keyed promo positions (`kind = 'table_stack'`, `entity_id = tables.id`).
 * PR #11619 (`20261121143259_a_seat_move_carries_its_promo_positions.sql`)
 * fixed `fn_cash_seat_move_execute` by calling `fn_ca_promo_follow_seat_move`
 * for both the mover and swap partner.
 *
 * A single-function test on `fn_cash_seat_move_execute` alone would not catch
 * a SECOND cash seat-mover or table-transfer SQL function added later (or a
 * direct grant reopening the revoked `*_before_maintenance_gate` helpers).
 *
 * What this cross-function law discovers and pins across ALL migrations in
 * `supabase/migrations/`:
 *   1. Discovers every active (non-dropped) SQL function matching cash
 *      seat-move / swap / table-transfer patterns or writing `table_seats`
 *      with cross-table cash move coordinates (`from_table_id` + `to_table_id`).
 *   2. Every active cash cross-table seat-mover MUST either:
 *        - be `fn_cash_seat_move_execute` (carrying BOTH
 *          `fn_poker_diamond_move_custody` and `fn_ca_promo_follow_seat_move`
 *          for both mover and swap partner, plus chip conservation), OR
 *        - delegate directly to `fn_cash_seat_move_execute` (as
 *          `fn_cash_seat_swap_execute` does), OR
 *        - directly invoke BOTH `fn_ca_promo_follow_seat_move` AND
 *          `fn_poker_diamond_move_custody` in its own body/patches.
 *   3. The internal pre-gate cash move/swap helpers
 *      (`fn_cash_seat_move_execute_before_maintenance_gate` and
 *      `fn_cash_seat_swap_execute_before_maintenance_gate`) remain revoked
 *      from `PUBLIC, anon, authenticated, service_role` and preserve
 *      `time_bank_remaining`, `time_bank_uses_remaining`, `is_sitting_out`,
 *      `is_away`, `sit_out_at`, `club_id`, and `cash_player_session` table
 *      re-pointing.
 *   4. `fn_move_tournament_player` remains the sole active tournament
 *      cross-table seat-mover (retired `fn_ca_move_tournament_seat` and
 *      `fn_move_tournament_player_atomic` stay dropped) and preserves
 *      `time_bank_remaining`, `time_bank_uses_remaining`, `is_sitting_out`,
 *      `is_away`, `sit_out_at`, `f06_move_guard`, and `tournament_players`
 *      pointer synchronization.
 *   5. `smarter_private.fn_record_ended_seat_occupancy` settles unresolved
 *      `table_pending_addons` via `resolve_pending_addon` when a cash seat
 *      ends, so moving a cash seat never strands a pending add-on on the
 *      departed table.
 *   6. `fn_cash_cluster_commit_must_move` (Lightning -> must-move reversion)
 *      never mutates `table_seats` across tables (keeps its row-hash proof).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const MIG_DIR = resolve(ROOT, 'supabase/migrations');

interface FunctionRecord {
  name: string;
  latestCreateFile: string;
  latestCreateBody: string;
  droppedInFile: string | null;
  patchFiles: { file: string; text: string }[];
}

// Non-moving helper / metadata / receipt / home-game functions whose names
// contain seat-move/swap/transfer substrings but do not move `table_seats`
// chips across cash tables.
const NON_MOVING_CASH_HELPERS = new Set([
  'fn_bind_cash_seat_move_occupancy',
  'fn_ca_promo_follow_seat_move',
  'fn_cancel_cash_seat_moves_on_table_close',
  'fn_cash_seat_change_request',
  'fn_cash_seat_move_announce',
  'fn_cash_seat_move_arrivals',
  'fn_cash_seat_move_arrivals_for_players',
  'fn_cash_seat_move_refuses_classic',
  'fn_cash_seat_move_set_window',
  'fn_cash_seat_move_stamp_resolved',
  'fn_cash_seat_move_window',
  'fn_cash_seat_moves_pending',
  'fn_home_move_seat', // Commander live home-game seating chart (commander_home_seats), no chips/table_seats
]);

const INTERNAL_PRE_GATE_CASH_MOVERS = new Set([
  'fn_cash_seat_move_execute_before_maintenance_gate',
  'fn_cash_seat_swap_execute_before_maintenance_gate',
]);

// Tournament-scoped movers (promo/Diamond/bounty custody is keyed to tournament_id, not table_stack).
const TOURNAMENT_SCOPED_MOVERS = new Set([
  'fn_move_tournament_player',
  'fn_ca_move_tournament_seat',
  'fn_move_tournament_player_atomic',
  'fn_ca_tournament_seat_move_receipt',
  'fn_resolve_committed_tournament_seat_move',
  'fn_tournament_seat_move_receipts_append_only',
  'balance_tournament_tables',
]);

const CASH_MOVER_NAME_RE =
  /(?:seat_move|move_seat|seat_swap|swap_seat|table_transfer|transfer_seat|relocate_seat|move_cash_player|cash_.*move.*execute|cash_.*swap.*execute)/i;

const CREATE_FN_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:public|smarter_private)\.)?([a-zA-Z0-9_]+)\s*\([^)]*\)/gi;

const DROP_FN_RE =
  /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:(?:public|smarter_private)\.)?([a-zA-Z0-9_]+)\s*\(/gi;

const RENAME_FN_RE =
  /ALTER\s+FUNCTION\s+(?:(?:public|smarter_private)\.)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s+RENAME\s+TO\s+([a-zA-Z0-9_]+)/gi;

function scanMigrations() {
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const records = new Map<string, FunctionRecord>();
  const grantReopens: string[] = [];

  for (const file of files) {
    const text = readFileSync(resolve(MIG_DIR, file), 'utf8');

    // Fast skip for files that neither define/drop/rename/patch functions nor grant pre-gate movers.
    const hasFnDdl = /FUNCTION\s+/i.test(text) || text.includes('pg_get_functiondef');
    if (!hasFnDdl) continue;

    // Track renames (e.g. fn_cash_seat_move_execute -> fn_cash_seat_move_execute_before_maintenance_gate).
    RENAME_FN_RE.lastIndex = 0;
    let rm: RegExpExecArray | null;
    while ((rm = RENAME_FN_RE.exec(text)) !== null) {
      const from = rm[1].toLowerCase();
      const to = rm[2].toLowerCase();
      const prev = records.get(from);
      if (prev) {
        records.set(to, {
          ...prev,
          name: to,
          droppedInFile: null,
          patchFiles: [...prev.patchFiles],
        });
      }
    }

    // Track DROP FUNCTION.
    DROP_FN_RE.lastIndex = 0;
    let dm: RegExpExecArray | null;
    while ((dm = DROP_FN_RE.exec(text)) !== null) {
      const fn = dm[1].toLowerCase();
      const rec = records.get(fn);
      if (rec) rec.droppedInFile = file;
    }

    // Track CREATE [OR REPLACE] FUNCTION definitions.
    const starts: { name: string; index: number }[] = [];
    CREATE_FN_RE.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = CREATE_FN_RE.exec(text)) !== null) {
      starts.push({ name: cm[1].toLowerCase(), index: cm.index });
    }
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i].index;
      const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
      const fn = starts[i].name;
      const body = text.slice(start, end);
      const existing = records.get(fn);
      records.set(fn, {
        name: fn,
        latestCreateFile: file,
        latestCreateBody: body,
        droppedInFile: null,
        patchFiles: existing ? [] : [],
      });
    }

    // Track dynamic pg_get_functiondef patches (EXECUTE replace(...)).
    if (
      text.includes('pg_get_functiondef') &&
      (/EXECUTE\b/i.test(text) || text.includes('replace('))
    ) {
      const patchRefs = new Set<string>();
      for (const m of text.matchAll(
        /'(?:(?:public|smarter_private)\.)?([a-zA-Z0-9_]+)\([^)]*\)'/g
      )) {
        patchRefs.add(m[1].toLowerCase());
      }
      for (const m of text.matchAll(/proname\s*=\s*'([a-zA-Z0-9_]+)'/g)) {
        patchRefs.add(m[1].toLowerCase());
      }
      for (const fn of patchRefs) {
        const rec = records.get(fn);
        if (rec && !rec.droppedInFile && file >= rec.latestCreateFile) {
          rec.patchFiles.push({ file, text });
        }
      }
    }

    // Check for any GRANT EXECUTE on the revoked internal pre-gate cash movers.
    for (const helper of INTERNAL_PRE_GATE_CASH_MOVERS) {
      if (
        new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${helper}\\b`, 'i').test(
          text
        )
      ) {
        grantReopens.push(`${file}: ${helper}`);
      }
    }
  }

  return { records, grantReopens };
}

function combinedSource(rec: FunctionRecord): string {
  return [rec.latestCreateBody, ...rec.patchFiles.map((p) => p.text)].join('\n');
}

function isCashSeatMoverCandidate(rec: FunctionRecord): boolean {
  if (rec.droppedInFile) return false;
  if (NON_MOVING_CASH_HELPERS.has(rec.name)) return false;
  if (TOURNAMENT_SCOPED_MOVERS.has(rec.name)) return false;
  if (INTERNAL_PRE_GATE_CASH_MOVERS.has(rec.name)) return false;

  if (CASH_MOVER_NAME_RE.test(rec.name)) return true;

  // Check the function's own latest CREATE body (not unrelated functions in
  // multi-function patch files) for cross-table cash `table_seats` movement:
  // writing a destination seat (INSERT or UPDATE setting left_at = NULL / table_id =)
  // with both source and destination table coordinates in a non-tournament function.
  const body = rec.latestCreateBody;
  const opensDestinationSeat =
    /INSERT\s+INTO\s+(?:public\.)?table_seats\b/i.test(body) ||
    /UPDATE\s+(?:public\.)?table_seats\b[^;]*(?:\bleft_at\s*=\s*NULL\b|\btable_id\s*=)/i.test(body);
  const hasCashCrossTableCoords =
    /\bfrom_table_id\b/i.test(body) &&
    /\bto_table_id\b/i.test(body) &&
    !/\btournament_players\b/i.test(body);

  return opensDestinationSeat && hasCashCrossTableCoords;
}

function cashMoverSatisfiesCustodyLaw(rec: FunctionRecord): { ok: boolean; reason?: string } {
  const src = combinedSource(rec);
  if (rec.name === 'fn_cash_seat_move_execute') {
    const required = [
      'fn_poker_diamond_move_custody(source_row,destination,m.game_id)',
      'fn_poker_diamond_move_custody(partner_source,partner_destination,pm.game_id)',
      'fn_ca_promo_follow_seat_move(source_row.user_id,m.from_table_id,m.to_table_id)',
      'fn_ca_promo_follow_seat_move(partner_source.user_id,pm.from_table_id,pm.to_table_id)',
      'SEAT_MOVE_CONSERVATION_FAILED',
      'SEAT_SWAP_CONSERVATION_FAILED',
    ];
    const missing = required.filter((needle) => !src.includes(needle));
    return missing.length === 0
      ? { ok: true }
      : { ok: false, reason: `missing: ${missing.join(', ')}` };
  }
  const delegatesToCanonical = /fn_cash_seat_move_execute\s*\(/i.test(src);
  const carriesBothCustodiesDirectly =
    /fn_ca_promo_follow_seat_move\s*\(/i.test(src) &&
    /fn_poker_diamond_move_custody\s*\(/i.test(src);
  if (delegatesToCanonical || carriesBothCustodiesDirectly) return { ok: true };
  return {
    ok: false,
    reason:
      `Cash seat-mover "${rec.name}" (defined in ${rec.latestCreateFile}) moves seats/chips ` +
      `across tables without delegating to fn_cash_seat_move_execute or calling BOTH ` +
      `fn_ca_promo_follow_seat_move and fn_poker_diamond_move_custody.`,
  };
}

describe('every seat mover preserves table-keyed custody', () => {
  const { records, grantReopens } = scanMigrations();

  it('discovers all active cash cross-table seat movers and enforces promo + Diamond custody on every one', () => {
    const discoveredCashMovers = [...records.values()].filter(isCashSeatMoverCandidate);
    const discoveredNames = discoveredCashMovers.map((r) => r.name).sort();
    expect(discoveredNames).toContain('fn_cash_seat_move_execute');
    expect(discoveredNames).toContain('fn_cash_seat_swap_execute');

    for (const rec of discoveredCashMovers) {
      const check = cashMoverSatisfiesCustodyLaw(rec);
      expect(check.ok, check.reason).toBe(true);
    }
  });

  it('rejects any hypothetical new cash seat-mover that omits promo or Diamond custody', () => {
    const rogue: FunctionRecord = {
      name: 'fn_cash_table_transfer_player',
      latestCreateFile: '20261201000000_rogue_mover.sql',
      latestCreateBody:
        'CREATE OR REPLACE FUNCTION public.fn_cash_table_transfer_player(from_table_id uuid, to_table_id uuid) RETURNS void AS $$ BEGIN INSERT INTO public.table_seats(table_id) VALUES (to_table_id); END; $$;',
      droppedInFile: null,
      patchFiles: [],
    };
    expect(isCashSeatMoverCandidate(rogue)).toBe(true);
    expect(cashMoverSatisfiesCustodyLaw(rogue).ok).toBe(false);
  });

  it('keeps internal pre-gate cash move/swap helpers revoked and preserving seat state', () => {
    expect(
      grantReopens,
      'Internal pre-gate cash seat-move helpers must never be granted EXECUTE directly'
    ).toEqual([]);

    for (const helper of INTERNAL_PRE_GATE_CASH_MOVERS) {
      const rec = records.get(helper);
      expect(rec, `${helper} must exist in migration history`).toBeDefined();
      const src = combinedSource(rec!);
      expect(src, `${helper}: time_bank_remaining`).toContain('time_bank_remaining');
      expect(src, `${helper}: time_bank_uses_remaining`).toContain('time_bank_uses_remaining');
      expect(src, `${helper}: is_sitting_out`).toContain('is_sitting_out');
      expect(src, `${helper}: is_away`).toContain('is_away');
      expect(src, `${helper}: sit_out_at`).toContain('sit_out_at');
      expect(src, `${helper}: funding club_id`).toContain('club_id');
      expect(src, `${helper}: cash_player_session re-point`).toContain('cash_player_session');
    }
  });

  it('keeps fn_move_tournament_player as the sole active tournament seat-mover preserving seat state', () => {
    const retired = ['fn_ca_move_tournament_seat', 'fn_move_tournament_player_atomic'];
    for (const fn of retired) {
      const rec = records.get(fn);
      if (rec) {
        expect(
          rec.droppedInFile,
          `Retired tournament seat-mover ${fn} must remain dropped`
        ).not.toBeNull();
      }
    }

    const mover = records.get('fn_move_tournament_player');
    expect(mover, 'fn_move_tournament_player must exist').toBeDefined();
    expect(mover!.droppedInFile).toBeNull();
    const src = combinedSource(mover!);
    expect(src).toContain('time_bank_remaining');
    expect(src).toContain('time_bank_uses_remaining');
    expect(src).toContain('is_sitting_out');
    expect(src).toContain('is_away');
    expect(src).toContain('sit_out_at');
    expect(src).toContain('f06_move_guard');
    expect(src).toContain('tournament_players');
  });

  it('settles unresolved table_pending_addons when any cash occupancy ends', () => {
    const endedSeat = records.get('fn_record_ended_seat_occupancy');
    expect(endedSeat, 'fn_record_ended_seat_occupancy must exist').toBeDefined();
    expect(endedSeat!.droppedInFile).toBeNull();
    const src = combinedSource(endedSeat!);
    expect(src).toContain('table_pending_addons');
    expect(src).toContain('resolve_pending_addon');
  });

  it('keeps Lightning-to-must-move reversion free of cross-table seat mutations', () => {
    const commit = records.get('fn_cash_cluster_commit_must_move');
    expect(commit, 'fn_cash_cluster_commit_must_move must exist').toBeDefined();
    expect(commit!.droppedInFile).toBeNull();
    const src = combinedSource(commit!);
    // Must not INSERT/UPDATE/DELETE table_seats; proves zero seat mutation via md5 hash.
    expect(src).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?table_seats\b/i);
    expect(src).toContain('md5(');
  });
});
