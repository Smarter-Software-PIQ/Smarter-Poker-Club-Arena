/**
 * Owner 2026-11-13, after eleven guaranteed events in a fortnight closed with
 * house money: build every remaining cover. This pins the second half of the
 * work behind overlayCoverClaimsEveryHorse: rebuys and add-ons as cover, cover
 * that keeps pace with the window, every host guarded, cover ahead of free
 * seats, and a durable alert instead of a console line.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  COVER_PACE_MAX_STEP,
  SHORT_MARK_TTL_MS,
  callHorsesFromCash,
  coveragePaceEntries,
  guaranteeShortNow,
  markGuaranteeShort,
  overlayCallAnswered,
  overlayCoverEvidence,
  recordOverlayCoverPool,
  resetOverlayCalls,
} from './horseOverlayCover.js';
import { HORSE_MAX_REBUYS, horseAddOnRateFor, horseRebuyAllowance } from './FreeBuy.js';
import {
  HORSE_TOURNAMENT_REBUY_SHARE,
  horseTournamentRebuyShareFor,
} from '../tournament/horseTournamentRebuyChoice.js';
import { MIDWAY_UNION_ID, guardHostsWithGuarantees } from './HorseOverlayGuard.js';

const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');
const EVENT = '27268410-ad39-4980-aba1-dad959ac136b';

describe('a short guarantee is covered from every source', () => {
  beforeEach(() => resetOverlayCalls());

  it('the guard marks a short event, the mark clears when covered and lapses on its own', () => {
    const now = 5_000_000;
    markGuaranteeShort(EVENT, 232, now);
    expect(guaranteeShortNow(EVENT, now)).toBe(true);
    expect(guaranteeShortNow(EVENT, now + SHORT_MARK_TTL_MS)).toBe(false);
    markGuaranteeShort(EVENT, 232, now);
    markGuaranteeShort(EVENT, 0, now);
    expect(guaranteeShortNow(EVENT, now)).toBe(false);
    expect(guaranteeShortNow(null)).toBe(false);
  });

  it('every eligible bust rebuys and every horse adds on while the event is short', () => {
    const row = { id: EVENT, buy_in_amount: 31.5 };
    expect(horseTournamentRebuyShareFor(row)).toBe(HORSE_TOURNAMENT_REBUY_SHARE);
    const ordinaryAddOn = horseAddOnRateFor(row);
    expect(ordinaryAddOn).toBeLessThan(1);
    markGuaranteeShort(EVENT, 40);
    expect(horseTournamentRebuyShareFor(row)).toBe(1);
    expect(horseAddOnRateFor(row)).toBe(1);
    expect(horseRebuyAllowance('any-horse', EVENT, row)).toBe(HORSE_MAX_REBUYS);
    markGuaranteeShort(EVENT, 0);
    expect(horseTournamentRebuyShareFor(row)).toBe(HORSE_TOURNAMENT_REBUY_SHARE);
    expect(horseAddOnRateFor(row)).toBe(ordinaryAddOn);
  });

  it('cover keeps pace with the window in bounded steps', () => {
    // 635 entries needed, none covered, a quarter of the way through.
    expect(coveragePaceEntries({ neededEntries: 635, missingEntries: 635, progress: 0.25 })).toBe(
      COVER_PACE_MAX_STEP
    );
    // On pace: nothing extra is asked.
    expect(coveragePaceEntries({ neededEntries: 100, missingEntries: 50, progress: 0.5 })).toBe(0);
    // Three behind: three, never more than is missing.
    expect(coveragePaceEntries({ neededEntries: 100, missingEntries: 53, progress: 0.5 })).toBe(3);
    expect(coveragePaceEntries({ neededEntries: 100, missingEntries: 2, progress: 1 })).toBe(2);
    expect(coveragePaceEntries({ neededEntries: 100, missingEntries: 50, progress: null })).toBe(0);
    expect(coveragePaceEntries({ neededEntries: 0, missingEntries: 0, progress: 0.9 })).toBe(0);
  });

  it('every host with a guaranteed event is guarded, and a closed arena stays out', () => {
    const arena = 'aaaaaaaa-0000-0000-0000-000000000001';
    const union = 'bbbbbbbb-0000-0000-0000-000000000002';
    const club = 'cccccccc-0000-0000-0000-000000000003';
    expect(
      guardHostsWithGuarantees(
        [MIDWAY_UNION_ID],
        [
          { club_id: MIDWAY_UNION_ID, union_id: MIDWAY_UNION_ID },
          { club_id: 'x', union_id: union },
          { club_id: club, union_id: null },
          { club_id: arena, union_id: null },
          { club_id: club, union_id: null },
        ],
        arena
      )
    ).toEqual([MIDWAY_UNION_ID, union, club]);
    // The arena joins only when its switch put it in the base list.
    expect(guardHostsWithGuarantees([MIDWAY_UNION_ID, arena], [], arena)).toEqual([
      MIDWAY_UNION_ID,
      arena,
    ]);
  });

  it('late registration cover runs before the freeroll fill', () => {
    const src = read('HorseOverlayGuard.ts');
    const cycle = src.slice(src.indexOf('function launchOwnedCycle'));
    expect(cycle.indexOf('lateRegisterHorsesOnce(host')).toBeGreaterThan(0);
    expect(cycle.indexOf('lateRegisterHorsesOnce(host')).toBeLessThan(
      cycle.indexOf('fillFreerollsOnce(host')
    );
    const once = src.slice(src.indexOf('export async function runEventFillCycle'));
    expect(once.indexOf('lateRegisterHorsesOnce(')).toBeLessThan(
      once.indexOf('fillFreerollsOnce(')
    );
  });

  it('a short cover cycle, a guarantee tracking short and house money at close are durable alerts', () => {
    const src = read('HorseOverlayGuard.ts');
    for (const source of [
      'HorseOverlayGuard.overlay_cover_short',
      'HorseOverlayGuard.guarantee_tracking_short',
      'Tournament.guarantee_closed_with_house_money',
      'HorseOverlayGuard.guarantee_exceeds_horse_supply',
    ]) {
      const at = src.indexOf(`'${source}',`);
      expect(at, source).toBeGreaterThan(0);
      // Each goes through the durable path with a per-event dedupe key.
      expect(src.slice(at - 160, at)).toContain('raiseFinancialAlert(');
    }
    expect(src).toContain('`${t.id}:guarantee_closed_with_house_money`');
  });

  it('the coverage reading is taken before the registration door', () => {
    const src = read('HorseOverlayGuard.ts');
    const pass = src.slice(src.indexOf('export async function lateRegisterHorsesOnce'));
    expect(pass.indexOf('markGuaranteeShort(t.id, missing, nowMs)')).toBeGreaterThan(0);
    expect(pass.indexOf('markGuaranteeShort(t.id, missing, nowMs)')).toBeLessThan(
      pass.indexOf("'fn_tournament_late_registration_open'")
    );
  });

  it('the evidence on /health counts calls, answer times and the pool each ask met', () => {
    const now = 9_000_000;
    callHorsesFromCash(['a', 'b'], now);
    overlayCallAnswered('a', now + 90_000);
    markGuaranteeShort(EVENT, 12, now);
    recordOverlayCoverPool(EVENT, { asked: 40, free: 3, atLimit: 357, cannotPay: 1 }, now);
    const evidence = overlayCoverEvidence(now);
    expect(evidence.cashCalls).toMatchObject({
      made: 2,
      answered: 1,
      standing: 1,
      medianAnswerMs: 90_000,
    });
    expect(evidence.shortEvents).toEqual([{ tournament: '27268410', missingEntries: 12 }]);
    expect(evidence.lastCover[0]).toMatchObject({ asked: 40, free: 3, atLimit: 357, cannotPay: 1 });
    expect(read('../handlers/health.ts')).toContain('overlayCover: overlayCoverEvidence()');
  });
});
