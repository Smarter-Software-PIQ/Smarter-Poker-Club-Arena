/**
 * A SETTLED HAND COUNTS ITS MEMORY DOMAIN (evidence for HVH2D-EXE-002, 2026-11-12).
 *
 * The repair merged today makes settlement carry the hand's blind snapshot
 * into the post-hand tasks, so a cash showdown hand is written with its
 * public memory domain. Until now the only way to see that in production was
 * to read hand rows. Settlement now counts, once per settled hand, whether
 * the row it built has a domain (hand_memory_domain_recorded_seen) or not
 * (hand_memory_domain_absent_seen).
 *
 * The counter is evidence only. It is emitted from the snapshot the post-hand
 * tasks already built, before their first await, and it never reads the live
 * controller (AShowdownHandKeepsItsMemoryDomain.law.test.ts forbids that).
 *
 * This file is the source law for where the count is taken. The behaviour is
 * driven through the real postHandTasks in OriginalPayloadRetry.runtime.mjs:
 * a hand with its blind snapshot counts recorded once even when its write is
 * retried, and a hand without one counts absent once.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('where the count is taken', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./ServerTableEngineSettlement.ts', import.meta.url)),
    'utf8'
  );
  const start = source.indexOf('protected async postHandTasks(');
  // postHandTasks runs to the next class member declared at two-space indent.
  const rest = source.slice(start + 1);
  const end = rest.search(/\n {2}(?:protected|private|public|async|static) /);
  const post = rest.slice(0, end);
  const call =
    /noteFire\(\s*snap\.publicMemoryDomain\s*\?\s*'hand_memory_domain_recorded_seen'\s*:\s*'hand_memory_domain_absent_seen'\s*\)/g;

  it('postHandTasks counts the snapshot it built, once', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(0);
    expect(post.match(call)?.length).toBe(1);
    // Nowhere else in settlement counts a hand.
    expect(source.split('hand_memory_domain_recorded_seen').length - 1).toBe(1);
    expect(source.split('hand_memory_domain_absent_seen').length - 1).toBe(1);
  });

  it('the count is taken before the first await, from the hand that is settling', () => {
    const body = post.slice(post.indexOf('): Promise<void> {'));
    const at = body.search(call);
    expect(at).toBeGreaterThan(0);
    // Comments above the call talk about awaits; only code can yield.
    const code = body
      .slice(0, at)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bawait\b/);
    expect(code).toContain('const snap = {');
  });
});
