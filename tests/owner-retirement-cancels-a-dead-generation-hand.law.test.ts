import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-11-05: six owner-retired Diamond satellites stayed RUNNING for days,
// each holding one reserved hand of a dead generation. Only the equal-share
// closure could cancel such a hand, and the owner's retirement order had
// superseded equal share. The owner-retirement closure now uses the same door.
const migration = readFileSync(
  'supabase/migrations/20261105170409_owner_retirement_cancels_a_dead_generation_hand.sql',
  'utf8'
);
const boundary = readFileSync('server/src/tournament/TournamentAbortBoundary.ts', 'utf8');
const manager = readFileSync('server/src/tournament/TournamentManagerBase.ts', 'utf8');
const handler = readFileSync('server/src/handlers/tournamentAbortBoundary.ts', 'utf8');
const control = readFileSync('.github/scripts/owner-retirement-control.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/tournament-original-recovery-control.yml', 'utf8');

describe('owner retirement cancels a dead generation hand', () => {
  it('admits the owner-retirement closure only for an owner-recorded event', () => {
    expect(migration).toContain(
      "'public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure"
    );
    expect(migration).toContain(
      "'smarter_private.assert_tournament_abort_absence(uuid,uuid,uuid,uuid,jsonb)'::regprocedure"
    );
    expect(migration).toContain("p_evidence->>'closure_mode' = 'owner_retirement' AND EXISTS");
    expect(migration).toContain("i.owner_chat_id = '01a19ccc-894e-75e2-a9e7-fe0d2df6c326'");
    expect(migration.match(/<> 1 THEN\s+RAISE EXCEPTION/g)?.length).toBe(2);
  });

  it('carries the mode through the engine and cancels instead of parking', () => {
    expect(boundary).toContain(
      "export type TournamentAbortClosureMode = 'equal_share' | 'owner_retirement';"
    );
    expect(boundary).toContain(
      'const archivalCancellation = this.request.closureMode !== undefined;'
    );
    expect(manager).toContain('if (request.closureMode === undefined) return;');
    expect(manager).not.toContain(
      "request.closureMode === 'equal_share' && table.cancellable_permit_id"
    );
    expect(handler).toContain("body.closureMode !== 'owner_retirement'");
  });

  it('is requested explicitly through owner_cancel_ack', () => {
    expect(control).toContain("'owner_cancel_ack'];");
    expect(control).toContain(
      "input.action === 'owner_cancel_ack' ? { closureMode: 'owner_retirement' } : {}"
    );
    expect(workflow).toContain('            owner_cancel_ack,');
  });
});
