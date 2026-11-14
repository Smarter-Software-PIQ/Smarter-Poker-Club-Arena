/**
 * MYSTERY BOUNTY PRIZES ARE SHOWN WHEN THE PRIZE POOL IS FINALIZED
 *
 * Dan, 2026-11-13, verbatim: "ONCE THE PRIZE POOL IS 'FINALIZED' (AFTER THE
 * ADD ON PERIOD) ALL MYSTERY BOUNTY PRIZES SHOULD BE SHOWN... DO NOT WAIT
 * UNTIL PLAYERS ARE ITM TO REVEAL MYSTERY BOUNTY PRIZES." For this and every
 * other mystery bounty tournament.
 *
 * Every link of that chain is pinned here, so removing any one of them turns
 * this file red instead of quietly bringing back "Not Drawn Yet":
 *   1. the engine seals the ladder while the threshold is not yet reached;
 *   2. the seal refuses until entry has closed, and only before activation;
 *   3. the lobby read lists the sealed ladder while the stage is pending;
 *   4. the seed opens the sealed ladder, keeping every shown prize when the
 *      field is smaller than sealed;
 *   5. the lobby and the table both hear the seal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  latestDeclaring,
  functionBody,
  migrationFiles,
  readMigration,
} from './helpers/migrations';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('mystery bounty prizes are shown at entry close', () => {
  it('the engine seals the ladder on every sweep that has not reached the threshold', () => {
    const src = read('server/src/tournament/TournamentManagerBase.ts');
    const branch = src.indexOf("decision.reason === 'threshold_not_reached'");
    expect(branch).toBeGreaterThan(-1);
    expect(src.slice(branch, branch + 400)).toContain('this.maybeSealMysteryLadder(');
    const method = src.indexOf('protected async maybeSealMysteryLadder(');
    expect(method).toBeGreaterThan(-1);
    const body = src.slice(method, method + 5000);
    expect(body).toContain("supabase.rpc('fn_mystery_bounty_seal'");
    expect(body).toContain('buildInventoryAtUnit(');
    expect(body).toContain("this.broadcast('mystery_bounty_sealed'");
  });

  it('the seal waits for the finalized pool and never runs after activation', () => {
    const { sql } = latestDeclaring('fn_mystery_bounty_seal');
    const body = functionBody(sql, 'fn_mystery_bounty_seal');
    expect(body).toContain('prize_pool_finalized');
    expect(body).toContain("'entry_still_open'");
    expect(body).toContain("mystery_bounty_stage <> 'pending'");
    // The sealed ladder never touches the paying inventory.
    expect(body).not.toMatch(/INSERT INTO public\.tournament_bounty_chests/);
  });

  it('the lobby read lists the sealed ladder while the stage is pending', () => {
    const { sql } = latestDeclaring('fn_mystery_bounty_inventory');
    const body = functionBody(sql, 'fn_mystery_bounty_inventory');
    expect(body).toContain('public.tournament_mystery_sealed_ladders');
    expect(body).toContain("mystery_bounty_stage = 'pending'");
    expect(body).toContain("'sealed_at'");
  });

  it('the seed opens the sealed ladder, and a smaller field keeps every shown prize', () => {
    const patched = migrationFiles().some((f) =>
      readMigration(f).includes('v_sealed_chests := public.fn_mystery_sealed_ladder_for_open(')
    );
    expect(patched).toBe(true);
    const { sql } = latestDeclaring('fn_mystery_sealed_ladder_for_open');
    const body = functionBody(sql, 'fn_mystery_sealed_ladder_for_open');
    // Drops the smallest chests and spreads them over the rest, to the chip.
    expect(body).toContain('ORDER BY amt ASC, ord DESC');
    expect(body).toContain('<> s.pool_cents');
  });

  it('the lobby re-reads and the table announces when the prizes are sealed', () => {
    expect(read('src/hooks/useMysteryBounty.ts')).toContain("type === 'mystery_bounty_sealed'");
    const table = read('src/pages/TablePage.tsx');
    expect(table).toContain("data?.type === 'mystery_bounty_sealed'");
    expect(table).toContain('MYSTERY_BOUNTY_PRIZES_SET_TEXT');
    expect(table).toMatch(/tab: 'bounties'/);
  });
});
