/**
 * Horse rebuy purchase refusals (2026-11-26, rpc/process_tournament_rebuy 500s).
 *
 * 1. A bare Postgres NOWAIT refusal ("could not obtain lock on row in relation
 *    profiles", 55P03, seven times in 24 hours) is busy: the transaction rolled
 *    back, so the same idempotent request is resent in place, bounded.
 * 2. A 23514 refusal (FOUR TABLE LIMIT, twelve times in 19 seconds for one
 *    horse) is the horse's final no: declined through the ordinary door and
 *    answered, never re-asked every two seconds.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isFinalTournamentPurchaseRefusal,
  isTournamentPurchasePlayerBusy,
  resendBusyTournamentPurchase,
} from './TournamentManagerEliminations.js';

const PROFILES_NOWAIT = {
  code: '55P03',
  message: 'could not obtain lock on row in relation "profiles"',
};
const MARKED_BUSY = {
  code: '55P03',
  message: 'TOURNAMENT_PURCHASE_PLAYER_BUSY: retry this same purchase request',
};
const FOUR_TABLE_LIMIT = {
  code: '23514',
  message: 'FOUR TABLE LIMIT: a player may hold at most four tables at once',
};

describe('tournament purchase refusals', () => {
  it('treats every 55P03 as busy, marked or bare', () => {
    expect(isTournamentPurchasePlayerBusy(MARKED_BUSY)).toBe(true);
    expect(isTournamentPurchasePlayerBusy(PROFILES_NOWAIT)).toBe(true);
    expect(isTournamentPurchasePlayerBusy(FOUR_TABLE_LIMIT)).toBe(false);
    expect(isTournamentPurchasePlayerBusy({ code: 'P0001', message: 'Rebuy period is closed' })).toBe(false);
    expect(isTournamentPurchasePlayerBusy(null)).toBe(false);
  });

  it('resends a bare profiles NOWAIT refusal in place until it is bought', async () => {
    let sends = 0;
    const result = await resendBusyTournamentPurchase<{ success: boolean } | null, typeof PROFILES_NOWAIT>(
      { data: null, error: PROFILES_NOWAIT },
      async () => {
        sends++;
        return sends < 2
          ? { data: null, error: PROFILES_NOWAIT }
          : { data: { success: true }, error: null };
      },
      () => true,
      3,
      async () => {}
    );
    expect(sends).toBe(2);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ success: true });
  });

  it('treats only 23514 as a final refusal', () => {
    expect(isFinalTournamentPurchaseRefusal(FOUR_TABLE_LIMIT)).toBe(true);
    expect(isFinalTournamentPurchaseRefusal(PROFILES_NOWAIT)).toBe(false);
    expect(isFinalTournamentPurchaseRefusal({ code: 'P0001', message: 'Rebuy period is closed' })).toBe(false);
    expect(isFinalTournamentPurchaseRefusal(undefined)).toBe(false);
  });

  it('declines and answers a horse whose purchase got a final refusal', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./TournamentManagerEliminations.ts', import.meta.url)),
      'utf8'
    );
    const start = src.indexOf("supabase.rpc('process_tournament_rebuy', request)");
    const block = src.slice(start, src.indexOf('rebought.add(h.id);', start));
    expect(block).toMatch(
      /if \(isFinalTournamentPurchaseRefusal\(error\)\) \{\s*await this\.declineHorseRebuyOffer\(h\.id, mayMutate\);\s*answered\.add\(h\.id\);\s*return;\s*\}/
    );
    // The final no comes before the unproven path re-arms the urgent sweep.
    expect(block.indexOf('isFinalTournamentPurchaseRefusal(error)')).toBeLessThan(
      block.indexOf('this.requestUrgentEliminationSweepAfter(')
    );
  });
});
