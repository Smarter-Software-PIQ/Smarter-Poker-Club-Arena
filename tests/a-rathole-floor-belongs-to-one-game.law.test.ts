/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A RATHOLE FLOOR BELONGS TO ONE GAME, NOT TO A STAKES LEVEL (2026-11-18)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-18 01:12 CT: "WOOWOO CAN NOT TAKE HIS BALANCE FROM A PLO5
 * MADNESS GAME, INTO A PLO5 LIGHTNING GAME. THEY ARE NOT THE SAME GAME (EVEN
 * THOUGH THEY ARE THE SAME GAME AND STAKES). DO NOT ALLOW THE GAMES TO CONVERT
 * LIKE THAT AGAIN, HE SHOULD OF ONLY BEEN ABLE TO BUY IN FOR 400 MAX AT THIS
 * 'NEW GAME'."
 *
 * cash_rejoin_constraints was keyed club + variant + sb + bb, so the floor a
 * player earned leaving PLO5 1/2 Madness (3,762.18) was demanded at the door
 * of PLO5 1/2 Lightning Games (max 400), and every buy-in path raised the
 * ceiling to it. The key is now the cash game, `game_scope`, written and read
 * through one definition (fn_cash_game_scope_of_table). This law reads the
 * LATEST definition of every reader and writer in the migration corpus, so a
 * later CREATE OR REPLACE that brings the stakes key back fails here.
 */
import { describe, it, expect } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

/** The body of the newest CREATE OR REPLACE of `fn` in the corpus. */
function latestDefinition(fn: string): { file: string; body: string } {
  const head = `CREATE OR REPLACE FUNCTION public.${fn}(`;
  let hit: { file: string; body: string } | null = null;
  for (const m of migrationCorpus()) {
    let at = m.sql.indexOf(head);
    while (at >= 0) {
      const open = m.sql.indexOf('$function$', at);
      const close = m.sql.indexOf('$function$', open + 10);
      if (open > 0 && close > open) hit = { file: m.name, body: m.sql.slice(at, close) };
      at = m.sql.indexOf(head, at + head.length);
    }
  }
  if (!hit) throw new Error(`${fn} is not defined in supabase/migrations`);
  return hit;
}

const STAKES_KEY = [/c\.variant\s*=/, /c\.sb\s*=/, /c\.bb\s*=/];

describe('the rathole floor and the VPIP bar are matched by game, never by stakes', () => {
  it('one definition of "which game is this table": the cash game, else the table', () => {
    const { body } = latestDefinition('fn_cash_game_scope_of_table');
    expect(body).toContain("WHEN t.cluster_id IS NOT NULL THEN 'cluster:' || t.cluster_id::text");
    expect(body).toContain("'table:' || t.id::text");
  });

  it('the door (fn_cash_rejoin_floor) reads only the floor earned in this game', () => {
    const { body } = latestDefinition('fn_cash_rejoin_floor');
    expect(body).toContain('public.fn_cash_game_scope_of_table(p_table_id)');
    expect(body).toMatch(/c\.game_scope\s*=\s*v_scope/);
    for (const k of STAKES_KEY) expect(body).not.toMatch(k);
  });

  it('the cash-out (fn_cash_session_close) writes the floor and the bar for this game only', () => {
    const { body } = latestDefinition('fn_cash_session_close');
    expect(body).toContain('v_scope := public.fn_cash_game_scope_of_table(p_table_id);');
    // Both lookups (VPIP bar, then winner's floor) match on the game.
    expect(body.match(/c\.game_scope = v_scope/g)?.length).toBe(2);
    // Both inserts carry the game.
    expect(body.match(/, game_scope\)/g)?.length).toBe(2);
    for (const k of STAKES_KEY) expect(body).not.toMatch(k);
  });

  it('the lobby bar timer (fn_cash_game_barred_seconds) reads only that game', () => {
    const { body } = latestDefinition('fn_cash_game_barred_seconds');
    expect(body).toContain("c.game_scope = 'cluster:' || p_game_id::text");
    expect(body).not.toMatch(/g\.variant|g\.sb|g\.bb/);
  });

  it('the horse fleet keys its door rules the same way the database does', async () => {
    const { rejoinTableKey } = await import('../server/src/services/HorseRejoinConstraints');
    expect(rejoinTableKey({ id: 't', cluster_id: 'madness' })).toBe('cluster:madness');
    expect(rejoinTableKey({ id: 't', cluster_id: 'lightning' })).not.toBe(
      rejoinTableKey({ id: 't', cluster_id: 'madness' })
    );
    expect(rejoinTableKey({ id: 'solo' })).toBe('table:solo');
  });
});
