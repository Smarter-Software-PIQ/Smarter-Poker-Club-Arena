/**
 * THE FINAL-TWO WATCH SEES A CLOSE THAT GAVE UP (2026-11-07).
 *
 * The engine records "...; gave up after N tries" in
 * ca_bounty_only_final_two_refusals when a close runs out of retries - the
 * miss itself - and the watch read any refusal row as "the rule working".
 * c1b3fa5a's runner-up lost their own head with no alert. Measured on
 * production with the watch's own predicate: old rule false, new rule true.
 *
 * Pinned: a gave-up refusal never exempts an event; a made-good miss (the
 * runner-up's exact make-good leg exists) is no longer a breach, so a closed
 * alert is not re-raised every five minutes; the leg is read by exact key.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '20261107195427_the_final_two_watch_sees_a_close_that_gave_up.sql'),
  'utf8'
);

describe('the final-two watch sees a close that gave up', () => {
  it('replaces the any-refusal exemption with a rule-refusal-only one', () => {
    expect(sql).toContain("E'       WHERE NOT closed AND entrants >= 3 AND refusal IS NULL\\n'");
    expect(sql).toContain("AND (refusal IS NULL OR refusal LIKE ''%gave up after %'')");
  });

  it('treats a made-good miss as settled, reading the leg by its exact key', () => {
    expect(sql).toContain('AND NOT made_good');
    expect(sql).toContain("''bounty-only-final-two-make-good:'' || ev.id::text || '':'' || tp.user_id::text");
    expect(sql).toContain('l.idempotency_key = ANY (ARRAY(');
    expect(sql).not.toMatch(/idempotency_key\s+LIKE/i);
  });

  it('pins the preimage and postimage and keeps the function metadata', () => {
    expect(sql).toContain("'63ae46e41c349dd5fe798c0d2f0a30ee'");
    expect(sql).toContain("'3e17a2d7c043ec8594946563d55d3820'");
    expect(sql).toContain('m2 IS DISTINCT FROM m');
  });

  it('closes only the one stranded made-good alert', () => {
    expect(sql).toContain("a.id = '49b95c40-b055-462b-8b6e-bca96455d911'");
    expect(sql).toMatch(/IF n NOT IN \(0,1\)/);
  });
});
