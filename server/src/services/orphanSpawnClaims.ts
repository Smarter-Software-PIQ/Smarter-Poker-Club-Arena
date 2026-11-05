/**
 * A STUCK SPAWN CLAIM REPAIRS ITSELF (owner 2026-11-05).
 *
 * The scheduled spawner claims an occurrence's spawn key BEFORE it inserts the
 * tournament, then links the claim to the new row. A process that dies between
 * the claim and the insert (an engine restart, a lost connection) leaves a
 * claim with no tournament. Every later poll sees the key as taken and stands
 * down, so that occurrence never exists. On 2026-11-05 six such claims were on
 * the board from the past week, one of them Saturday's 8:30 AM Midway Morning
 * Free Buy.
 *
 * The sweep runs inside the spawner's own poll, at most every
 * ORPHAN_SPAWN_SWEEP_MS, and only touches claims older than
 * ORPHAN_SPAWN_GRACE_MS, far longer than any live spawn takes. For each one:
 *
 *   - exactly one tournament of that schedule was created around the claim:
 *     the insert landed and only the back-link was lost, so the claim is
 *     LINKED to it (never released, which could let the occurrence double);
 *   - none was: the claim is RELEASED, so the next poll spawns the occurrence
 *     if it is still due;
 *   - more than one: ambiguous, left alone and reported.
 *
 * Every write is conditional on tournament_id still being NULL, so a spawner
 * that finishes in between always wins.
 */

export const ORPHAN_SPAWN_GRACE_MS = 10 * 60 * 1000;
export const ORPHAN_SPAWN_SWEEP_MS = 10 * 60 * 1000;
/** A tournament created this long before or after the claim belongs to it. */
export const ORPHAN_SPAWN_MATCH_BEFORE_MS = 60 * 1000;
export const ORPHAN_SPAWN_MATCH_AFTER_MS = 10 * 60 * 1000;
export const ORPHAN_SPAWN_BATCH = 100;

export type OrphanClaim = { spawn_key: string; schedule_id: string | null; created_at: string };
export type OrphanDecision =
  | { kind: 'link'; tournamentId: string }
  | { kind: 'release' }
  | { kind: 'ambiguous'; count: number };

export function orphanClaimDecision(candidateTournamentIds: string[]): OrphanDecision {
  if (candidateTournamentIds.length === 1) {
    return { kind: 'link', tournamentId: candidateTournamentIds[0] };
  }
  if (candidateTournamentIds.length === 0) return { kind: 'release' };
  return { kind: 'ambiguous', count: candidateTournamentIds.length };
}

export function orphanMatchWindow(claimCreatedAt: string): { from: string; to: string } | null {
  const at = Date.parse(claimCreatedAt);
  if (!Number.isFinite(at)) return null;
  return {
    from: new Date(at - ORPHAN_SPAWN_MATCH_BEFORE_MS).toISOString(),
    to: new Date(at + ORPHAN_SPAWN_MATCH_AFTER_MS).toISOString(),
  };
}

import type { supabase as SupabaseClient } from './supabase.js';

type Db = Pick<typeof SupabaseClient, 'from'>;

export type OrphanSweepResult = {
  linked: number;
  released: number;
  ambiguous: number;
  failed: number;
};

export async function sweepOrphanSpawnClaims(
  db: Db,
  now: Date,
  report: (err: Error, source: string) => void,
  log: (line: string) => void = (line) => console.log(line)
): Promise<OrphanSweepResult> {
  const result: OrphanSweepResult = { linked: 0, released: 0, ambiguous: 0, failed: 0 };
  const cutoff = new Date(now.getTime() - ORPHAN_SPAWN_GRACE_MS).toISOString();
  const { data, error } = await db
    .from('tournament_schedule_spawns')
    .select('spawn_key, schedule_id, created_at')
    .is('tournament_id', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(ORPHAN_SPAWN_BATCH);
  if (error) {
    report(
      new Error(`[ScheduledTournaments] orphan spawn claim read failed: ${error.message}`),
      'ScheduledTournaments.orphan_claim_read_failed'
    );
    result.failed++;
    return result;
  }
  for (const claim of (data ?? []) as OrphanClaim[]) {
    const window = orphanMatchWindow(claim.created_at);
    if (!window || !claim.schedule_id) {
      result.failed++;
      continue;
    }
    const { data: rows, error: readErr } = await db
      .from('tournaments')
      .select('id')
      .eq('schedule_id', claim.schedule_id)
      .gte('created_at', window.from)
      .lte('created_at', window.to)
      .limit(5);
    if (readErr) {
      report(
        new Error(
          `[ScheduledTournaments] orphan spawn claim ${claim.spawn_key} match read failed: ${readErr.message}`
        ),
        'ScheduledTournaments.orphan_claim_read_failed'
      );
      result.failed++;
      continue;
    }
    const decision = orphanClaimDecision(((rows ?? []) as { id: string }[]).map((r) => r.id));
    if (decision.kind === 'ambiguous') {
      report(
        new Error(
          `[ScheduledTournaments] orphan spawn claim ${claim.spawn_key} matches ${decision.count} tournaments - left for review`
        ),
        'ScheduledTournaments.orphan_claim_ambiguous'
      );
      result.ambiguous++;
      continue;
    }
    const write =
      decision.kind === 'link'
        ? db
            .from('tournament_schedule_spawns')
            .update({ tournament_id: decision.tournamentId })
            .eq('spawn_key', claim.spawn_key)
            .is('tournament_id', null)
        : db
            .from('tournament_schedule_spawns')
            .delete()
            .eq('spawn_key', claim.spawn_key)
            .is('tournament_id', null);
    const { error: writeErr } = await write;
    if (writeErr) {
      report(
        new Error(
          `[ScheduledTournaments] orphan spawn claim ${claim.spawn_key} ${decision.kind} failed: ${writeErr.message}`
        ),
        'ScheduledTournaments.orphan_claim_repair_failed'
      );
      result.failed++;
      continue;
    }
    if (decision.kind === 'link') {
      result.linked++;
      log(
        `[ScheduledTournaments] orphan spawn claim ${claim.spawn_key} linked to ${decision.tournamentId}`
      );
    } else {
      result.released++;
      log(
        `[ScheduledTournaments] orphan spawn claim ${claim.spawn_key} released - the next poll may spawn it`
      );
    }
  }
  return result;
}
