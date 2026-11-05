/**
 * A bounty-only PKO always finishes (2026-11-05).
 *
 * Midday Free Buy 39b5fa14 (Free Buy PKO, ordinary prize pool exactly 0,
 * bounty pool 323.00) reached one player at 21:17Z and stayed RUNNING: the
 * cash authority fn_settle_tournament_places returned `payouts: []` and the
 * terminal guard refused it as "cash authority returned a partial result".
 * #9570 let the empty ladder settle; #9580 made the cash authority return the
 * zero-dollar place-1 winner line the guard and the engine receipt verifier
 * both require.
 *
 * The regression vector is a LATER migration that rewrites one of these
 * functions from an older body and silently drops the zero branch. Every
 * format with a zero ordinary pool (Free Buy PKO MTTs and satellites, bounty
 * SNGs) goes through the same two functions, so this law pins the branch in
 * every later rewrite, not only in the one file that added it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const dir = 'supabase/migrations';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');

const ZERO_LINE =
  "jsonb_build_array(jsonb_build_object(''place'',1,''user_id'',v_winner.user_id,''amount'',0))";
const EMPTY_LADDER_SETTLES = '20261105203911_a_zero_prize_pool_pko_settles_with_no_place_ladder.sql';
const ZERO_WINNER_LINE = '20261105215135_a_zero_prize_pko_returns_its_zero_winner_line.sql';

const redefines = (sql: string, fn: string) =>
  new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, 'i').test(sql);

describe('a bounty-only PKO always finishes', () => {
  it('keeps both zero-pool migrations on main', () => {
    expect(files).toContain(EMPTY_LADDER_SETTLES);
    expect(files).toContain(ZERO_WINNER_LINE);
  });

  it('the cash authority returns a zero-dollar place-1 winner line only for an empty ladder and a zero pool', () => {
    const sql = read(ZERO_WINNER_LINE);
    expect(sql).toContain("jsonb_array_length(v_ladder) = 0 AND v_t.prize_pool = 0");
    expect(sql).toContain(ZERO_LINE.replace(/''/g, "''"));
    expect(sql).toContain('@live-proof:');
  });

  it('moves no money and is one guarded transaction', () => {
    const sql = read(ZERO_WINNER_LINE);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.(chip_ledger|tournament_payouts)/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.(chip_ledger|player_wallets|club_members)/i);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain('expected exactly one terminal RETURN to amend');
  });

  it('no later migration rewrites the cash authority without the zero winner line', () => {
    const later = files.filter((f) => f > ZERO_WINNER_LINE);
    for (const f of later) {
      const sql = read(f);
      if (redefines(sql, 'fn_settle_tournament_places')) {
        expect(sql, `${f} rewrites fn_settle_tournament_places and drops the zero-pool winner line`).toContain(
          'jsonb_array_length(v_ladder) = 0 AND v_t.prize_pool = 0'
        );
      }
    }
  });

  it('no later migration rewrites the terminal guard to demand a positive cash payout for a zero pool', () => {
    const later = files.filter((f) => f > ZERO_WINNER_LINE);
    for (const f of later) {
      const sql = read(f);
      if (redefines(sql, 'fn_complete_tournament_terminal_pre_seat_guard')) {
        expect(sql, `${f} rewrites the terminal guard without its zero-pool branch`).toMatch(
          /prize_pool\s*=\s*0/i
        );
      }
    }
  });
});
