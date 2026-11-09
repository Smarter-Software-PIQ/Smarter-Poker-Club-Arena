/**
 * Dan 2026-11-08, verbatim: "FOR 9 HANDED GAMES, ONCE 4 OR MORE PLAYERS ARE ON
 * THE WAITING LIST, IT WILL REMOVE THE LAST TWO PLAYERS TO SIT IN THE FULL GAME
 * AND MOVE THEM TO THE 'FEEDER GAME'. THEN THE 2ND TABLE STARTS. THOSE 2
 * PLAYERS ARE 'FIRST TO MOVE' AND WILL MOVE OVER ANYTIME ANOTHER PLAYER FROM
 * THE MAIN GAME, LEAVES OR BUSTS, IF A NEW PLAYER JOINS THE FEEDER GAME, THE
 * MAIN GAME DOESN'T GET A NEW PLAYER UNTIL THE FEEDER GAME HAS 7 PLAYERS. THEN
 * FIRST ON THE LIST MOVES. IF ITS A 6 MAX GAME, 'FEEDER GAME' GAME STARTS
 * HEADS UP."
 *
 * Settled with him the same day: the two chairs the bump empties stay empty
 * until the feeder has 7; 6-max is unchanged (two on the list start the feeder
 * heads up, any open Main seat draws the first on the list).
 *
 * The rule lives in one migration that patches four functions in place. This
 * pins each piece of it, so a later re-emit of the tick, the census, the
 * open-seat count or the buy-in gate cannot drop one silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    __dirname,
    '../supabase/migrations/20261108193515_a_full_ring_feeder_starts_with_the_last_two_to_sit.sql'
  ),
  'utf8'
);

describe('a full-ring feeder starts with the last two to sit (Dan 2026-11-08)', () => {
  it('is full ring only: handedness 7 to 9, gate at handedness - 2 (7 for nine-handed)', () => {
    expect(sql).toContain('v_full_ring := coalesce(g.handedness, 9) >= 7;');
    expect(sql).toContain('v_gate := greatest(2, coalesce(g.handedness, 9) - 2);');
    expect(sql).toContain('coalesce(cg.handedness, 9) >= 7');
  });

  it('opens the second table for FOUR on the list, never two buyers', () => {
    expect(sql).toContain('IF v_full_ring AND v_waiting < 4 THEN');
    // 6-max keeps the original two-buyer branch, untouched, after the new ones.
    expect(sql).toContain(
      'ELSIF v_buyers >= 2 THEN\n      UPDATE public.tables SET promote_pending = true\n       WHERE cluster_id = g.id'
    );
  });

  it('moves the last two to sit at Main 1 (arrival at that table) onto the new feeder', () => {
    expect(sql).toContain(
      "v_new_feeder := public.fn_cash_cluster_open_table(g.id, 'feeder', NULL, 'opening', NULL);"
    );
    expect(sql).toContain(
      "m.state = 'done' AND m.executed_at >= ts.joined_at), ts.joined_at) DESC"
    );
    expect(sql).toMatch(/LIMIT 2\s+LOOP\s+INSERT INTO public\.cash_seat_moves[\s\S]*?'balance'/);
  });

  it('holds the two chairs everywhere a chair is counted', () => {
    // the census (must-move, seat changes, breaks), the open-seat count (door,
    // lobby, list offer) and the buy-in gate all read the same held count.
    const reads = sql.match(/SELECT fs\.held FROM public\.cash_cluster_feeder_starts fs/g) ?? [];
    expect(reads.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("'census_reserved'");
    expect(sql).toContain("'open_seats_tail'");
    expect(sql).toContain("'buyin_gate'");
  });

  it('releases one held chair at a time, once the feeder has handedness - 2', () => {
    expect(sql).toContain('IF coalesce(v_feeder_n, 0) >= v_gate THEN');
    expect(sql).toContain('SET held = held - 1');
  });

  it('puts the bumped two first on the list, and lets them past the gate', () => {
    expect(sql).toContain('(ts.user_id = ANY (v_first)) DESC,');
    expect(sql).toContain('OR ts.user_id = ANY (v_first)');
  });

  it('gives a Main a feeder player only while the feeder has handedness - 2, one per chair', () => {
    expect(sql).toMatch(/mo\.from_table_id = c\.id AND mo\.state = 'pending'\) >= v_gate\)/);
    expect(sql).toMatch(/mo\.from_table_id = r\.table_id AND mo\.state = 'pending'\) < v_gate;/);
  });

  it("sends a newcomer to the feeder: a full-ring Main's open chair belongs to the list", () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_cash_main_chair_is_the_lists(p_table_id uuid)'
    );
    expect(sql).toContain(
      'SELECT CASE WHEN public.fn_cash_main_chair_is_the_lists(t.id) THEN 0 ELSE GREATEST(0,'
    );
    expect(sql).toContain('IF public.fn_cash_main_chair_is_the_lists(p_table_id)');
    expect(sql).toContain('SEAT_RESERVED: this seat goes to the next player on the must-move list');
  });

  it('touches no money path and stays one transaction', () => {
    expect(sql.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(sql.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(sql).not.toMatch(/chip_balance|fn_credit|fn_add_chips|chip_ledger/);
    expect(sql).not.toMatch(/REFERENCES\s+public\./);
  });
});

describe('first to move ends when a bumped player returns (2026-11-09)', () => {
  const fix = readFileSync(
    resolve(
      __dirname,
      '../supabase/migrations/20261109010155_a_bumped_player_is_first_to_move_only_until_they_return.sql'
    ),
    'utf8'
  );
  it('keeps priority only while the player is on a feeder or still moving', () => {
    expect(fix).toContain('FIRST TO MOVE ENDS ON RETURN');
    expect(fix).toContain("tb.role = 'feeder' AND tb.lifecycle <> 'closed'");
    expect(fix).toContain("m.player_id = x AND m.game_id = g.id AND m.state = 'pending'");
    expect(fix).toContain('SET first_to_move = ARRAY(');
  });
  it('patches the tick once, in one transaction, touching no money path', () => {
    expect(fix.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(fix.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(fix).not.toMatch(/chip_balance|fn_credit|fn_add_chips|chip_ledger/);
  });
});

describe('first to move ends at the return itself, not at the next tick (2026-11-09)', () => {
  const fix = readFileSync(
    resolve(
      __dirname,
      '../supabase/migrations/20261109021129_first_to_move_ends_at_the_return_itself.sql'
    ),
    'utf8'
  );
  it('reads the move back and the cash-out from the records their own transactions write', () => {
    expect(fix).toContain('FIRST TO MOVE ENDS AT THE RETURN ITSELF');
    expect(fix).toContain("m.state = 'done'");
    expect(fix).toContain("tb.role = 'main' AND m.executed_at >= v_fs.started_at");
    expect(fix).toContain("NOT (m.id = ANY (coalesce(v_fs.bump_move_ids, '{}'::uuid[])))");
    expect(fix).toContain('public.ca_seat_stack_exits e');
    expect(fix).toContain('e.occurred_at >= v_fs.started_at');
  });
  it('builds on the earlier step and patches the tick once, in one transaction, touching no money path', () => {
    expect(fix).toContain("position('FIRST TO MOVE ENDS ON RETURN' IN src) = 0");
    expect(fix.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(fix.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(fix).not.toMatch(/chip_balance|fn_credit|fn_add_chips|chip_ledger/);
  });
});
