/**
 * LAW: 3 AM LOBBY CLOSE AND UNFILLED-SPIN EXPIRY RESPECT THE MAINTENANCE FREEZE
 * (2026-11-21, H10 — run 44887083680 & 2026-11-16 09:04Z).
 *
 * Twice on Backup Engine, a swap rehearsal crossing 09:00:00Z (03:00:00
 * America/Chicago) failed frozen_seat_boundary seconds past the hour because
 * fn_daily_window_close_seat_first_lobbies cancelled open Spin/SNG lobbies
 * while the platform was frozen (125 -> 115 seats on 2026-11-16; 138 -> 132
 * seats on 2026-11-21). Its sibling fn_spin_expire_unfilled had the exact
 * same gap in both the engine discovery pass and SQL.
 *
 * This law pins both halves of the freeze boundary:
 *  1. Engine (server/src/GameServer.ts & TournamentManager.ts): every
 *     post-loop seat-mutating discovery sweep checks isMaintenanceFrozen().
 *  2. Postgres (supabase/migrations/*_lobby_close_and_spin_expiry_respect_maintenance_freeze.sql):
 *     both RPCs fail closed on public.fn_platform_frozen() IS DISTINCT FROM false
 *     before scanning and again before atomic_cancel_tournament, preserving
 *     service_role-only privileges, preimage guards, probes, and zero table locks.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = resolve(ROOT, 'supabase/migrations');
const FILE = readdirSync(MIGRATIONS_DIR).find((f) =>
  f.endsWith('_lobby_close_and_spin_expiry_respect_maintenance_freeze.sql')
);
const SQL = FILE ? readFileSync(resolve(MIGRATIONS_DIR, FILE), 'utf8') : '';
const ENGINE = readFileSync(resolve(ROOT, 'server/src/GameServer.ts'), 'utf8');
const MANAGER = readFileSync(resolve(ROOT, 'server/src/tournament/TournamentManager.ts'), 'utf8');

function fnSection(startMarker: string, endMarker: string): string {
  const start = SQL.indexOf(startMarker);
  const end = SQL.indexOf(endMarker, start);
  expect(start, `missing ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `missing ${endMarker}`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('3 AM lobby close and unfilled-spin expiry respect the maintenance freeze (H10)', () => {
  it('ships a single-transaction, lock-free migration with preimage guards, probes, and live-proof', () => {
    expect(FILE, 'H10 freeze-guard migration must exist').toBeTruthy();
    expect(SQL).toMatch(/^BEGIN;$/m);
    expect(SQL).toMatch(/^COMMIT;$/m);
    expect(SQL).toContain("'d0ebf7a63d861435cd76cc392febd6f1'");
    expect(SQL).toContain("'b26c7716533363bb92347803890f87d5'");
    expect(SQL).toContain('-- @probe-for: public.fn_daily_window_close_seat_first_lobbies');
    expect(SQL).toContain('-- @probe-for: public.fn_spin_expire_unfilled');
    expect(SQL).toMatch(/^-- @live-proof:/m);
    expect(SQL).not.toMatch(/^-- @install-window:/m);
    expect(SQL).not.toMatch(/\b(ALTER|LOCK)\s+TABLE\b/i);
  });

  it('fn_daily_window_close_seat_first_lobbies fails closed on fn_platform_frozen() before scanning and before cancelling', () => {
    const body = fnSection(
      'CREATE OR REPLACE FUNCTION public.fn_daily_window_close_seat_first_lobbies(',
      'CREATE OR REPLACE FUNCTION public.fn_spin_expire_unfilled('
    );
    const guardAt = body.indexOf(
      'IF NOT p_dry AND public.fn_platform_frozen() IS DISTINCT FROM false THEN'
    );
    const scanAt = body.indexOf('FOR g IN');
    const cancelAt = body.indexOf('res := public.atomic_cancel_tournament(g.id, NULL);');
    const inLoopGuardAt = body.lastIndexOf(
      'IF public.fn_platform_frozen() IS DISTINCT FROM false THEN',
      cancelAt
    );

    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(scanAt);
    expect(inLoopGuardAt).toBeGreaterThan(scanAt);
    expect(inLoopGuardAt).toBeLessThan(cancelAt);
    expect(body).toContain("'platform_frozen',true");
    expect(body).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_daily_window_close_seat_first_lobbies\(integer,timestamptz,boolean\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(body).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean) TO service_role;'
    );
  });

  it('fn_spin_expire_unfilled fails closed on fn_platform_frozen() before scanning and before cancelling', () => {
    const body = fnSection(
      'CREATE OR REPLACE FUNCTION public.fn_spin_expire_unfilled(',
      '-- @probe-for: public.fn_daily_window_close_seat_first_lobbies'
    );
    const guardAt = body.indexOf('IF public.fn_platform_frozen() IS DISTINCT FROM false THEN');
    const scanAt = body.indexOf('FOR g IN');
    const cancelAt = body.indexOf('res := public.atomic_cancel_tournament(g.id, NULL);');
    const inLoopGuardAt = body.lastIndexOf(
      'IF public.fn_platform_frozen() IS DISTINCT FROM false THEN',
      cancelAt
    );

    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(scanAt);
    expect(inLoopGuardAt).toBeGreaterThan(scanAt);
    expect(inLoopGuardAt).toBeLessThan(cancelAt);
    expect(body).toContain("'platform_frozen', true");
    expect(body).toContain(
      'REVOKE ALL ON FUNCTION public.fn_spin_expire_unfilled(integer) FROM PUBLIC, anon, authenticated;'
    );
    expect(body).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_spin_expire_unfilled(integer) TO service_role;'
    );
  });

  it('GameServer and TournamentManager gate all three post-loop seat-mutating sweeps on isMaintenanceFrozen()', () => {
    expect(ENGINE).toMatch(
      /if\s*\(\s*!isMaintenanceFrozen\(\)\s*&&\s*Date\.now\(\)\s*-\s*this\.lastSpinExpireAt\s*>\s*10\s*\*\s*60\s*\*\s*1000\s*\)\s*\{/
    );
    expect(ENGINE).toMatch(
      /if\s*\(\s*!isMaintenanceFrozen\(\)\s*&&\s*!spinSngBoardsOpen\(new Date\(\)\)\s*&&\s*Date\.now\(\)\s*-\s*this\.lastLobbyCloseAt\s*>\s*60\s*\*\s*1000\s*\)\s*\{/
    );
    expect(ENGINE).toMatch(
      /private async repairOrphanedTournamentSeats\(\): Promise<void> \{\s*if \(isMaintenanceFrozen\(\)\) return;/
    );
    expect(MANAGER).toMatch(
      /public async absorbOrphanedSeats\(\): Promise<number> \{\s*if \(isMaintenanceFrozen\(\)\) return 0;/
    );
  });
});
