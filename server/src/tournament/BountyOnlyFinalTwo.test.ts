import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  BOUNTY_ONLY_FINAL_TWO_MAX_RETRIES,
  BOUNTY_ONLY_FINAL_TWO_MAX_RETRY_MS,
  BOUNTY_ONLY_FINAL_TWO_PARK_MS,
  BOUNTY_ONLY_FINAL_TWO_RETRY_MS,
  closeBountyOnlyPkoAtTwo,
  isBountyOnlyPkoRow,
  type FinalTwoDeps,
} from './bountyOnlyFinalTwo.js';

// Dan 2026-11-05: a bounty only PKO ends with two players and both keep the
// bounty on their own head. These run the maintained decision the manager
// calls, and read the manager to prove where it is called.

const freeRoll = {
  is_pko: true,
  buy_in_amount: '0.00',
  guaranteed_prize: '0.00',
  prize_pool: '0.00',
};

function table(parked: boolean) {
  const t = {
    parked,
    pauseAfterHand: vi.fn(() => undefined),
    isParkedBetweenHands: () => t.parked,
  };
  return t;
}

function setup(parked: boolean, answer: unknown, error: { message?: string } | null = null) {
  const tables = [table(parked)];
  const deps = {
    tournamentId: 'event-1234',
    tables,
    state: { parked: false, refused: false },
    rpc: vi.fn(async () => ({ data: answer, error })),
    recheckAfter: vi.fn(),
    release: vi.fn(),
    report: vi.fn(),
  } satisfies FinalTwoDeps;
  return { deps, tables };
}

describe('the bounty only PKO format', () => {
  it('is a free, unguaranteed, non-mystery PKO with a zero place pool', () => {
    expect(isBountyOnlyPkoRow(freeRoll)).toBe(true);
    expect(isBountyOnlyPkoRow({ ...freeRoll, prize_pool: '12.00' })).toBe(false);
    expect(isBountyOnlyPkoRow({ ...freeRoll, guaranteed_prize: '100' })).toBe(false);
    expect(isBountyOnlyPkoRow({ ...freeRoll, buy_in_amount: '5' })).toBe(false);
    expect(isBountyOnlyPkoRow({ ...freeRoll, is_pko: false })).toBe(false);
    expect(isBountyOnlyPkoRow({ ...freeRoll, is_mystery_bounty: true })).toBe(false);
    expect(isBountyOnlyPkoRow(null)).toBe(false);
  });
});

describe('a bounty only PKO closes at two players', () => {
  it('parks every table and waits for the hand in play to finish', async () => {
    const { deps, tables } = setup(false, { ok: true });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('waiting');
    expect(tables[0].pauseAfterHand).toHaveBeenCalledWith(BOUNTY_ONLY_FINAL_TWO_PARK_MS);
    expect(deps.rpc).not.toHaveBeenCalled();
    expect(deps.recheckAfter).toHaveBeenCalledTimes(1);
  });

  it('asks the authority once the table is parked and reports the close', async () => {
    const { deps, tables } = setup(true, { ok: true, winner_user_id: 'a', runner_up_user_id: 'b' });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('closed');
    expect(deps.rpc).toHaveBeenCalledWith('fn_ca_bounty_only_pko_final_two', {
      p_tournament_id: 'event-1234',
    });
    expect(deps.release).not.toHaveBeenCalled();
    // The park became a claim the engine's safety timer cannot lift.
    expect(tables[0].pauseAfterHand).toHaveBeenCalledWith(BOUNTY_ONLY_FINAL_TWO_PARK_MS, {
      untilResumed: true,
    });
  });

  it.each(['busts_not_settled', 'field_is_not_two', 'a_live_stack_is_empty'])(
    'keeps the table parked and looks again when the authority says %s',
    async (reason) => {
      const { deps } = setup(true, { ok: false, reason });
      expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('retry');
      expect(deps.release).not.toHaveBeenCalled();
      expect(deps.recheckAfter).toHaveBeenCalledTimes(1);
      expect(deps.report).not.toHaveBeenCalled();
    }
  );

  it('looks again after an unreachable authority without releasing the table', async () => {
    const { deps } = setup(true, null, { message: 'timeout' });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('retry');
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('lets the event play on heads up after a rule refusal, reported once', async () => {
    const { deps, tables } = setup(true, { ok: false, reason: 'heads_do_not_match_the_open_pool' });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('refused');
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledTimes(1);
    tables[0].parked = false;
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('refused');
    expect(deps.rpc).toHaveBeenCalledTimes(1);
    expect(tables[0].pauseAfterHand).toHaveBeenCalledTimes(1);
  });

  it('parks again a table whose safety timer lifted the park while waiting', async () => {
    const { deps, tables } = setup(true, { ok: false, reason: 'busts_not_settled' });
    await closeBountyOnlyPkoAtTwo(deps);
    tables[0].parked = false;
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('waiting');
    expect(tables[0].pauseAfterHand).toHaveBeenLastCalledWith(BOUNTY_ONLY_FINAL_TWO_PARK_MS);
  });
});

describe('a tournament never freezes at the final two (owner rule)', () => {
  it('an authority that always throws is bounded: the final two play on heads up', async () => {
    let clock = 0;
    const tables = [table(true), table(true)];
    const deps = {
      tournamentId: 'event-1234',
      tables,
      state: { parked: false, refused: false },
      rpc: vi.fn(async (): Promise<{ data: unknown; error: { message?: string } | null }> => {
        throw new Error('connect ETIMEDOUT');
      }),
      recheckAfter: vi.fn((delayMs: number) => {
        clock += delayMs;
      }),
      release: vi.fn(),
      report: vi.fn(),
      now: () => clock,
    } satisfies FinalTwoDeps;
    const outcomes: string[] = [];
    for (let i = 0; i < 100 && outcomes.at(-1) !== 'refused'; i += 1) {
      outcomes.push(await closeBountyOnlyPkoAtTwo(deps));
    }
    expect(outcomes.at(-1)).toBe('refused');
    expect(outcomes.length).toBeLessThanOrEqual(BOUNTY_ONLY_FINAL_TWO_MAX_RETRIES);
    expect(clock).toBeLessThanOrEqual(BOUNTY_ONLY_FINAL_TWO_MAX_RETRY_MS);
    expect(outcomes.slice(0, -1).every((o) => o === 'retry')).toBe(true);
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(String(deps.report.mock.calls[0][0].message)).toContain('authority_unreachable');
    expect(deps.report.mock.calls[0][1]).toBe('Tournament.bounty_only_final_two_refused');
    // Once released it stays released: no further park, no further ask.
    const asks = deps.rpc.mock.calls.length;
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('refused');
    expect(deps.rpc).toHaveBeenCalledTimes(asks);
    expect(deps.release).toHaveBeenCalledTimes(1);
  });

  it('a "not yet" that never settles gives up after the time budget', async () => {
    let clock = 1_000;
    const { deps } = setup(true, { ok: false, reason: 'busts_not_settled' });
    const timed = { ...deps, now: () => clock };
    expect(await closeBountyOnlyPkoAtTwo(timed)).toBe('retry');
    clock += BOUNTY_ONLY_FINAL_TWO_MAX_RETRY_MS - 1;
    expect(await closeBountyOnlyPkoAtTwo(timed)).toBe('retry');
    clock += 1;
    expect(await closeBountyOnlyPkoAtTwo(timed)).toBe('refused');
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(String(deps.report.mock.calls[0][0].message)).toContain('busts_not_settled');
  });

  it('records the refusal for the watch, and a failed record never throws', async () => {
    const { deps } = setup(true, { ok: false, reason: 'heads_do_not_match_the_open_pool' });
    const recordRefusal = vi.fn(async () => {
      throw new Error('relation does not exist');
    });
    expect(await closeBountyOnlyPkoAtTwo({ ...deps, recordRefusal })).toBe('refused');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recordRefusal).toHaveBeenCalledWith('heads_do_not_match_the_open_pool');
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.report.mock.calls.map((c) => c[1])).toEqual([
      'Tournament.bounty_only_final_two_refused',
      'Tournament.bounty_only_final_two_refusal_record_failed',
    ]);
  });

  it('a "not yet" that settles inside the budget still closes at two', async () => {
    const { deps } = setup(true, { ok: false, reason: 'field_is_not_two' });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('retry');
    expect(deps.recheckAfter).toHaveBeenLastCalledWith(BOUNTY_ONLY_FINAL_TWO_RETRY_MS);
    deps.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('closed');
    expect(deps.release).not.toHaveBeenCalled();
  });
});

describe('the manager closes the field at two before it reads a winner', () => {
  const source = readFileSync(
    new URL('./TournamentManagerEliminations.ts', import.meta.url),
    'utf8'
  );
  it('asks for the close on a settled field of two in a bounty only PKO', () => {
    const close = source.indexOf('closeBountyOnlyPkoAtTwo({');
    const finish = source.indexOf("this.noteEliminationSweepStep('finishTournament');");
    expect(close).toBeGreaterThan(0);
    expect(finish).toBeGreaterThan(close);
    expect(source).toMatch(
      /remainingCount === 2 &&\s*this\.prizePoolFinalized &&\s*isBountyOnlyPkoRow\(this\.tournamentCache\)/
    );
    expect(source).toContain("if (finalTwo === 'closed') remainingCount = 1;");
    expect(source).toContain("else if (finalTwo !== 'refused') return;");
  });
});
