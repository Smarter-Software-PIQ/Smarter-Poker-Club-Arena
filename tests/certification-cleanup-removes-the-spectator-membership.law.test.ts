/**
 * The certification cleanup door removes the spectator membership its caller
 * creates (2026-11-02). prepare-spectator joins KINGS CLUB as a zero-balance
 * player under the owner; both guarded cleanup branches admitted only an
 * admin there, so the identity stayed in the real clubs.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const dir = 'supabase/migrations';
const file = fs
  .readdirSync(dir)
  .find((f) => f.endsWith('_certification_cleanup_removes_the_spectator_membership.sql'));
const sql = file ? fs.readFileSync(`${dir}/${file}`, 'utf8') : '';
const script = fs.readFileSync('scripts/ci/production-e2e-account.mjs', 'utf8');

describe('certification cleanup removes the spectator membership', () => {
  it('the caller still creates a KINGS CLUB player membership', () => {
    expect(script).toContain("memberRole: 'player'");
    expect(script).toContain("const DEFAULT_E2E_CLUB_ID = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'");
  });
  it('admits a KINGS CLUB player beside an admin in both branches and removes it', () => {
    expect(sql).toContain(
      "$n1$(club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid AND role IN ('admin','player'))$n1$"
    );
    expect(sql).toContain("$n2$OR NOT (role IN ('admin','player')) IS TRUE$n2$");
    expect(sql).toContain(
      "$n3$AND role IN ('admin','player') AND COALESCE(chip_balance, 0) = 0$n3$"
    );
  });
  it('is exact: preimage-guarded, each replacement single, one transaction', () => {
    expect(sql).toContain('CERTIFICATION_CLEANUP_PREIMAGE_CHANGED');
    expect(sql).toContain('CERTIFICATION_CLEANUP_PATCH_NOT_SINGLE');
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
  });
  it('widens nothing else: no balance, agent or ownership condition is touched', () => {
    for (const kept of ['chip_balance', 'agent_id', 'parent_agent_id', 'owner_id']) {
      expect(sql.split('$n')).not.toContain(kept);
    }
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).not.toMatch(/GRANT /);
  });
});
