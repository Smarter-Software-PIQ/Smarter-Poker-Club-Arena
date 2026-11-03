/**
 * An agent wallet's history explains its balance (owner, 2026-11-02).
 *
 * Weekly commission, rakeback paid out of an agent wallet and club treasury
 * transfers move agent-wallet chips through chip_ledger alone. The wallet
 * history reader must list exactly those ledger-only categories for the
 * reader's own agent wallet, beside chip_transactions, so every movement
 * appears once.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(__dirname, '..', 'supabase', 'migrations');
const latest = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .reverse()
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  .find((sql) => sql.includes('CREATE OR REPLACE FUNCTION public.fn_my_wallet_ledger('));

describe('an agent wallet history lists its ledger-only movements', () => {
  const sql = latest ?? '';
  it('has a definition', () => {
    expect(sql).not.toBe('');
  });
  it('reads chip_transactions and the three ledger-only categories', () => {
    expect(sql).toMatch(/from chip_transactions t/);
    expect(sql).toMatch(/l\.category in \('commission', 'rakeback', 'treasury_transfer'\)/);
  });
  it("reads only the reader's own agent wallet in this club, posted", () => {
    expect(sql).toMatch(/l\.club_id = p_club_id/);
    expect(sql).toMatch(/l\.status = 'posted'/);
    expect(sql).toMatch(
      /\(l\.to_type = 'agent_wallet' and l\.to_entity_id = v_actor\)\s+or \(l\.from_type = 'agent_wallet' and l\.from_entity_id = v_actor\)/
    );
  });
  it('never names a person for a club bank side', () => {
    expect(sql).toMatch(/'from_name', case when x\.from_user is not null then/);
    expect(sql).toMatch(/'to_name', case when x\.to_user is not null then/);
  });
});
