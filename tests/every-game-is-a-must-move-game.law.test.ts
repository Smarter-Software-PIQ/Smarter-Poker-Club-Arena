/**
 * EVERY GAME IS A MUST-MOVE GAME (Dan 2026-11-07, verbatim)
 *
 * "NO ALL CLASSIC GAMES ARE ALSO MUST MOVE GAMES. THEY JUST DON'T MOVE TO
 * LIGHTNING. EVERY SINGLE GAME IS A MUST MOVE GAME, IF THEY ARE LABELED AS
 * 'LIGHTNING' THEY CONVERT WHEN ENOUGH PLAYERS JOIN."
 *
 * Supersedes the 2026-10-24 Classic exception (20261024213758). That exception
 * lived in ONE definition, public.fn_cash_game_never_moves_players, read by the
 * tick, the balancer, the join door, the on-table lobby and the cash_seat_moves
 * trigger. 20261107070717 makes it answer false for every game and sets
 * must_move on every enabled game; the board mirror and the lobby card follow.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cashEntry, type LobbyTableRow } from '../src/components/lobby/lobbyEntries';
import { cashGameNeverMovesPlayers } from '../src/config/classicNeverMovesPlayers';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const FILE = '20261107070717_every_game_is_a_must_move_game_and_second_tables_follow_the_.sql';
const SQL = readFileSync(join(MIGRATIONS, FILE), 'utf8');

describe('every game is a must-move game', () => {
  it('the one definition exempts nobody, and every enabled game is must_move', () => {
    expect(SQL).toMatch(
      /FUNCTION public\.fn_cash_game_never_moves_players\(p_template text, p_ruleset jsonb\)[\s\S]*?SELECT false/
    );
    expect(SQL).toContain('UPDATE public.cash_games SET must_move = true');
    expect(SQL).toContain('WHERE enabled AND must_move IS DISTINCT FROM true;');
  });

  it('no later migration brings a Classic exception back', () => {
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f > FILE)) {
      const text = readFileSync(join(MIGRATIONS, f), 'utf8');
      expect(text, f).not.toMatch(
        /FUNCTION public\.fn_cash_game_never_moves_players[\s\S]*?'classic'/
      );
    }
  });

  it('the board mirror agrees: no game is exempt', () => {
    for (const t of ['classic', 'Classic', 'madness', 'action', null])
      expect(cashGameNeverMovesPlayers(t, null)).toBe(false);
  });

  it('a Classic card says MUST MOVE like every other game', () => {
    const row = {
      id: 't1',
      name: 'NLH 0.25/0.50 Classic Main 1',
      game_variant: 'nlh',
      cluster_id: 'g1',
      cluster_must_move: true,
      cluster_template: 'classic',
      cluster_mode: 'must_move',
      cluster_tables: 2,
      cluster_players: 12,
      max_players: 9,
      current_players: 9,
    } as unknown as LobbyTableRow;
    const labels = JSON.stringify(cashEntry(row).rules ?? []);
    expect(labels).toContain('MUST MOVE');
    expect(labels).not.toContain('Your Seat Is Yours');
  });
});
