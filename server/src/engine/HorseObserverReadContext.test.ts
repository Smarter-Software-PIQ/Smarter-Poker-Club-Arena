import { expect, it } from 'vitest';
import { horseObserverReadContextFromRequest } from './HorseObserverReadContext.js';
import { decisionRequest } from '../testing/horseRegression/plan/fixture.js';
it.each(['mtt', 'sng', 'spin', 'hu_sng'] as const)(
  'requires known original %s context instead of a guessed transport fallback',
  (format) => {
    const r = decisionRequest();
    r.gameState.gameMode = 'tournament';
    r.gameState.format = format;
    for (const status of [undefined, 'incomplete', 'unknown', 'stale']) {
      r.gameState.tournament = { contextStatus: status } as never;
      expect(horseObserverReadContextFromRequest(r)).toBeNull();
    }
    r.gameState.tournament = { contextStatus: 'complete' } as never;
    expect(horseObserverReadContextFromRequest(r)).toMatchObject({ format });
  }
);

it('uses the original MTT contract for public reads while satellite payout utility stays incomplete', () => {
  const request = decisionRequest();
  const gs = request.gameState;
  gs.gameMode = 'tournament';
  gs.format = 'hu_sng'; // Local seat-shape fallback at a short table.
  gs.publicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
  const issues = [
    'TOURNAMENT_CONTEXT_INCOMPLETE',
    'satellite_award_depth_unavailable',
    'live_field_recovery_pending',
    'live_field_stack_cardinality_mismatch',
  ];
  const tournamentId = '77eb7e69-128b-46db-bc59-1aed5e04d9bb';
  const source = {
    version: 1 as const,
    tournamentId,
    cacheId: tournamentId,
    generation: 1,
    readStartedAtMs: 1,
    readCompletedAtMs: 2,
    contextDigest: '1'.repeat(64),
    contextStatus: 'incomplete' as const,
    contextIssues: issues,
    mttFormatContract: 'mtt-v2' as const,
  };
  const provenance = {
    version: 1 as const,
    readAtMs: 3,
    status: 'incomplete' as const,
    issues,
    ageMs: 1,
    source,
    projection: {
      tableId: request.fence.split(':')[0],
      handNumber: 1000100,
      actorId: request.player.user_id,
      actorSeat: request.player.seat,
      dealerSeat: gs.dealerSeat ?? null,
      dealtSeatIds: [1, 2],
      smallBlind: 1,
      bigBlind: gs.bigBlind,
      ante: gs.ante ?? 0,
      gameVariant: gs.gameVariant!,
    },
  };
  gs.tournament = {
    tournamentId,
    contextStatus: 'incomplete',
    contextIssues: issues,
    sourceAgeMs: 1,
    contextProvenance: provenance,
    currentBigBlind: gs.bigBlind,
    currentSmallBlind: 1,
    currentAnte: gs.ante ?? 0,
  };
  expect(horseObserverReadContextFromRequest(request)).toMatchObject({
    version: 2,
    format: 'mtt',
    dealtCount: 2,
    publicMemoryDomain: gs.publicMemoryDomain,
  });
  expect(gs.tournament.contextStatus).toBe('incomplete');
  for (const mutate of [
    (r: typeof request) => {
      delete r.gameState.tournament!.contextProvenance!.source!.mttFormatContract;
    },
    (r: typeof request) => {
      r.gameState.tournament!.tournamentId = 'another-tournament';
    },
    (r: typeof request) => {
      r.gameState.tournament!.contextIssues!.push('blind_level_cache_lag');
    },
    (r: typeof request) => {
      r.gameState.tournament!.contextStatus = 'stale';
    },
    (r: typeof request) => {
      delete r.gameState.publicMemoryDomain;
    },
    (r: typeof request) => {
      r.gameState.dealtSeatIds = [1];
    },
  ]) {
    const invalid = structuredClone(request);
    mutate(invalid);
    expect(horseObserverReadContextFromRequest(invalid)).toBeNull();
  }
});
