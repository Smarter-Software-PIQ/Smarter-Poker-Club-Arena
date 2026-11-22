/**
 * A LIGHTNING SWITCH-OFF STARTS A FRESH VPIP SAMPLE (2026-11-21)
 *
 * While a Lightning pool runs nothing judges VPIP. When the game left
 * Lightning, the anchor tables' first eviction pass judged the whole pool
 * sitting - every pool hand is a ca_hand_facts row of the game - with the
 * game's ten-hand, no-grace rule: an instant eviction and the two-hour bar.
 * Production, 30 days to 2026-11-21: 220 of 236 Lightning-game VPIP bars could
 * not have been judged at that instant under a window that starts at the
 * switch-off (158 lightning_off, 42 lightning_drained, 20 anchor_seat_left
 * then rejoin). 235 of the 236 were Horses; the rule is one rule for both.
 *
 * The fix lives in the ONE window definition every reader shares,
 * fn_nit_sitting_since. These pins keep it there and keep its shape; the
 * behaviour (switch-off, ordinary hands after it, a later joiner, on/off/on/off,
 * pending and aborted switch-offs, a pre-pool warning, a rejoin, people and
 * Horses alike, and byte-identical answers for never-Lightning and Classic
 * games) is proven by execution in
 * scripts/ci/test-lightning-switch-off-vpip-sample.sh.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const MIG_PATH =
  'supabase/migrations/20261121152102_a_lightning_switch_off_starts_a_fresh_vpip_sample.sql';
const MIG = read(MIG_PATH);
const BODY = (() => {
  const start = MIG.indexOf('AS $function$');
  const end = MIG.indexOf('$function$;', start + 13);
  return MIG.slice(start, end);
})();
const PROOF = 'scripts/ci/test-lightning-switch-off-vpip-sample.sh';
const BASE = read('server/src/engine/ServerTableEngineBase.ts');

describe('a Lightning switch-off starts a fresh VPIP sample', () => {
  it('is one transaction pinned by pre- and post-image md5', () => {
    expect(MIG.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIG.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(MIG).toContain("'5c9907e0e981a6840f8a2f37e4faa9ce'");
    expect(MIG).toMatch(/drifted \(md5=%\), refusing to edit/);
    expect(MIG).toMatch(/post-image is %, expected [0-9a-f]{32}/);
  });

  it('changes only the shared window, which stays invoker-rights, STABLE and private', () => {
    expect(MIG.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_nit_sitting_since\(/);
    expect(BODY).not.toMatch(/SECURITY DEFINER/);
    expect(MIG).toMatch(/\n STABLE\n/);
    expect(MIG).toMatch(/became SECURITY DEFINER/);
    expect(MIG).toMatch(/executable by anon or authenticated/);
    // No row is written and no table is altered.
    expect(MIG).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM|ALTER TABLE)\b/);
  });

  it('starts the window at the newest committed (or pending) conversion out of Lightning', () => {
    expect(BODY).toMatch(/FROM public\.cash_cluster_conversion c/);
    expect(BODY).toMatch(/c\.cluster_id = p_game_id/);
    expect(BODY).toMatch(/c\.from_mode IN \('lightning', 'draining'\)/);
    expect(BODY).toMatch(/c\.to_mode IS DISTINCT FROM 'lightning'/);
    expect(BODY).toMatch(/c\.status IN \('committed', 'pending'\)/);
    expect(BODY).toMatch(/max\(COALESCE\(c\.closed_at, now\(\)\)\)/);
    // It is a lower bound beside the floor's own start, never a replacement
    // for the sitting: GREATEST ignores the NULL of a never-Lightning game.
    expect(BODY).toMatch(
      /SELECT GREATEST\([\s\S]*\(SELECT floor_since FROM game\),\s*\(SELECT at FROM left_lightning\)\);/
    );
    // The re-entry window rule is kept as it was.
    expect(BODY).toMatch(/lag\(r\.left_at\) OVER \(ORDER BY r\.joined_at\)/);
  });

  it('reads no Horse identity: people and Horses are one rule', () => {
    expect(BODY).not.toMatch(/is_horse|horse_/i);
  });

  it('leaves the live pool unjudged, as before (a pool judge is a separate change)', () => {
    expect(BASE).toMatch(/if \(!opts\.sitOutOnly && this\.tableInfo\?\.nit_game === true\)/);
  });

  it('is proven by execution in CI', () => {
    expect(existsSync(resolve(ROOT, PROOF))).toBe(true);
    const proof = read(PROOF);
    expect(proof).toContain(MIG_PATH.split('/').pop());
    expect(proof).toContain('PASS  every Lightning switch-off VPIP assertion held');
    const wf = read('.github/workflows/classic-vpip-floor-proof.yml');
    expect(wf).toContain('bash scripts/ci/test-lightning-switch-off-vpip-sample.sh');
    expect(wf).toContain(`- '${MIG_PATH}'`);
  });
});
