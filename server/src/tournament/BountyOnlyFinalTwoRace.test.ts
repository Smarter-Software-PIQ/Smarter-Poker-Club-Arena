/**
 * A BOUNTY ONLY PKO REALLY ENDS AT TWO PLAYERS (2026-11-07).
 *
 * Dan's rule (2026-11-05): a bounty only PKO has no paid places, only bounties
 * pay, and THE EVENT ENDS WITH TWO PLAYERS LEFT, both keeping the bounty on
 * their own head. The close had never once succeeded in production -
 * public.ca_bounty_only_final_two held zero rows for all time - and all six
 * completed bounty only PKOs in the seven days to 2026-11-07 played down past
 * two and handed the runner-up's own head to the winner: 105.87 chips.
 *
 * Three things were wrong, and these are the tests that would have caught them:
 *
 *   1. THE RACE. The bust pass latched the field "decided" only when ONE player
 *      remained, so the pass that recorded the bust leaving TWO yielded on the
 *      work budget before the finish stage. That yield cost a median 221 s (3
 *      of 896 admissions inside 15 s, measured 2026-10-02); the field at two
 *      lasted 43.6 s on a turbo table dealing every ~10 s. The next read said
 *      1, not 2.
 *   2. THE SNAPSHOT. The close was entered only while a read said exactly two,
 *      so a read of 3 and then 1 slipped past it for ever.
 *   3. THE DEAL. Nothing stopped the table dealing on at two, so any late
 *      sweep cost a head.
 *
 * The place collision that killed the one real attempt ever made is proven on
 * PostgreSQL in scripts/ci/test-final-two-close-held-place-two.py; the engine
 * half of it - a held place 2 is retried, not refused - is below.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TournamentManagerEliminations } from './TournamentManagerEliminations.js';
import {
  BOUNTY_ONLY_FINAL_TWO_PARK_MS,
  BOUNTY_ONLY_FINAL_TWO_RETRY_MS,
  bountyOnlyFinalTwoCloseIsOwed,
  closeBountyOnlyPkoAtTwo,
  noteBountyOnlyFinalTwoField,
  type FinalTwoDeps,
  type FinalTwoState,
} from './bountyOnlyFinalTwo.js';

const ELIM = readFileSync(new URL('./TournamentManagerEliminations.ts', import.meta.url), 'utf8');
const BASE = readFileSync(new URL('./TournamentManagerBase.ts', import.meta.url), 'utf8');

/** A Free Buy PKO: no entry fee, no guarantee, no place pool, an open bounty pool. */
const BOUNTY_ONLY = {
  is_pko: true,
  buy_in_amount: '0.00',
  guaranteed_prize: '0.00',
  prize_pool: '0.00',
  bounty_pool: '323.00',
};
/** The same event with places to pay: it ends with ONE player, as always. */
const ORDINARY_PKO = { ...BOUNTY_ONLY, prize_pool: '240.00' };

function state(over: Partial<FinalTwoState> = {}): FinalTwoState {
  return { parked: false, refused: false, retryCount: 0, firstRetryAt: null, ...over };
}

function manager(over: Record<string, unknown> = {}) {
  const m = Object.create(TournamentManagerEliminations.prototype) as any;
  Object.assign(m, {
    tournamentId: 'aaaaaaaa-0000-4000-8000-000000000001',
    running: true,
    tournamentCache: BOUNTY_ONLY,
    prizePoolFinalized: true,
    bountyOnlyFinalTwo: state(),
    tableEngines: new Map(),
    requestDecidedEliminationSweep: vi.fn(),
    declareFieldDecided: vi.fn(),
    ...over,
  });
  return m;
}

function fakeEngine(occupied = 2) {
  return {
    pauseAfterHand: vi.fn(),
    resumeDealing: vi.fn(),
    getOccupiedSeatNumbers: () => Array.from({ length: occupied }, (_, i) => i + 1),
  };
}

const stacks = (...live: number[]) => live.map((stack, i) => ({ user_id: `u${i}`, stack }));

// ───────────────────────────────────────────────────────────────── 1. the race
describe('the bust that leaves two reaches the close in the same admission', () => {
  it('a bounty only PKO is decided at two, not at one', () => {
    // Three playing, the bust pass commits one: two are left. THIS is the pass
    // that must reach the finish stage, because the close at two is the whole
    // remaining money decision and the table is about to deal again.
    const m = manager();
    expect(m.bustPassDecidedTheField(3, 1)).toBe(true);
    // The same shape with places to pay is NOT decided: that event plays on.
    expect(manager({ tournamentCache: ORDINARY_PKO }).bustPassDecidedTheField(3, 1)).toBe(false);
  });

  it('an ordinary field is still decided only when one player is left', () => {
    const ordinary = manager({ tournamentCache: ORDINARY_PKO });
    expect(ordinary.bustPassDecidedTheField(2, 1)).toBe(true);
    expect(ordinary.bustPassDecidedTheField(4, 1)).toBe(false);
  });

  it('a field of three or more left is not decided in either format', () => {
    expect(manager().bustPassDecidedTheField(5, 1)).toBe(false);
    expect(manager({ tournamentCache: ORDINARY_PKO }).bustPassDecidedTheField(5, 1)).toBe(false);
  });

  it('a pass that committed nothing decided nothing', () => {
    // No progress is not a verdict: the field may simply not have been read.
    expect(manager().bustPassDecidedTheField(2, 0)).toBe(false);
    expect(manager().bustPassDecidedTheField(0, 0)).toBe(false);
  });

  it('a field that can still grow is not decided at two', () => {
    // Late registration open: the roster is not final, so neither is the pair.
    expect(manager({ prizePoolFinalized: false }).bustPassDecidedTheField(3, 1)).toBe(false);
  });

  it('the bust pass uses that verdict to reach the finish stage in this pass', () => {
    // The verdict is only worth anything because of the escape in
    // completedStage: a decided field does not yield on the clock before
    // FINISH_STAGE. Pin both halves - either one alone restores the race.
    expect(ELIM).toContain('if (this.bustPassDecidedTheField(playingCount, committedThisPass)) {');
    const verdict = ELIM.indexOf(
      'if (this.bustPassDecidedTheField(playingCount, committedThisPass)) {'
    );
    const latch = ELIM.indexOf('lastBustRecordedThisPass = true;', verdict);
    const decided = ELIM.indexOf('this.declareFieldDecided();', verdict);
    expect(latch).toBeGreaterThan(verdict);
    expect(decided).toBeGreaterThan(latch);
    expect(ELIM).toContain(
      'if (nextStage <= FINISH_STAGE && (lastBustRecordedThisPass || this.fieldIsDecided()))'
    );
    // and the two writers share ONE format test
    expect(ELIM).toContain('const decidedAtOrBelow = this.bountyOnlyPkoClosesAtTwo() ? 2 : 1;');
  });
});

// ────────────────────────────────────────────────────────────── 2. the snapshot
describe('the field at two is a latch, not a snapshot', () => {
  it('a read of three owes no close', () => {
    const s = state();
    noteBountyOnlyFinalTwoField(s, 3);
    expect(bountyOnlyFinalTwoCloseIsOwed(s)).toBe(false);
  });

  it('a read of two owes the close, and a later read of one does not cancel it', () => {
    // The exact production shape: 3 at one admission, the table deals through
    // two, 1 at the next. The old gate (`remainingCount === 2`) saw neither.
    const s = state();
    noteBountyOnlyFinalTwoField(s, 3);
    noteBountyOnlyFinalTwoField(s, 2);
    expect(bountyOnlyFinalTwoCloseIsOwed(s)).toBe(true);
    noteBountyOnlyFinalTwoField(s, 1);
    expect(bountyOnlyFinalTwoCloseIsOwed(s)).toBe(true);
  });

  it('a read of one latches too: the close is owed and the authority judges it', () => {
    const s = state();
    noteBountyOnlyFinalTwoField(s, 1);
    expect(bountyOnlyFinalTwoCloseIsOwed(s)).toBe(true);
  });

  it('a count it could not read latches nothing', () => {
    for (const unreadable of [null, undefined, NaN]) {
      const s = state();
      noteBountyOnlyFinalTwoField(s, unreadable as number | null | undefined);
      expect(bountyOnlyFinalTwoCloseIsOwed(s)).toBe(false);
    }
    const empty = state();
    noteBountyOnlyFinalTwoField(empty, 0);
    expect(bountyOnlyFinalTwoCloseIsOwed(empty)).toBe(false);
  });

  it('a closed or refused event owes nothing more', () => {
    const closed = state({ seenAtTwoOrFewer: true, closed: true });
    expect(bountyOnlyFinalTwoCloseIsOwed(closed)).toBe(false);
    const refused = state({ seenAtTwoOrFewer: true, refused: true });
    expect(bountyOnlyFinalTwoCloseIsOwed(refused)).toBe(false);
  });

  it('a successful close records itself, so the latch is not asked twice', async () => {
    const tables = [{ pauseAfterHand: vi.fn(), isParkedBetweenHands: () => true }];
    const s = state({ seenAtTwoOrFewer: true });
    const deps = {
      tournamentId: 'event-1234',
      tables,
      state: s,
      rpc: vi.fn(async () => ({ data: { ok: true }, error: null })),
      recheckAfter: vi.fn(),
      release: vi.fn(),
      report: vi.fn(),
    } satisfies FinalTwoDeps;
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('closed');
    expect(s.closed).toBe(true);
    expect(bountyOnlyFinalTwoCloseIsOwed(s)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────── 3. the deal
describe('a bounty only PKO deals no further hand at two players', () => {
  function boundary(over: Record<string, unknown> = {}, occupied = 2) {
    const engine = fakeEngine(occupied);
    const m = manager({ tableEngines: new Map([['t1', engine]]), ...over });
    return { m, engine };
  }

  it('parks the table on the hand that leaves two, and asks for the decided sweep', () => {
    const { m, engine } = boundary();
    m.holdBountyOnlyFinalTwoBoundary(engine, stacks(5000, 3000));
    expect(engine.pauseAfterHand).toHaveBeenCalledWith(BOUNTY_ONLY_FINAL_TWO_PARK_MS, {
      beforeNextHand: true,
    });
    expect(m.requestDecidedEliminationSweep).toHaveBeenCalledWith('bounty_only_pko_at_two');
  });

  it('the park is bounded, because a tournament must never freeze', () => {
    // Deliberately NOT the untilResumed claim that closeBountyOnlyPkoAtTwo
    // arms: if the close is never reached at all the engine's own safety timer
    // lifts this one and the event plays on heads up, as it did before the rule.
    const { m, engine } = boundary();
    m.holdBountyOnlyFinalTwoBoundary(engine, stacks(5000, 3000));
    const [, opts] = engine.pauseAfterHand.mock.calls[0];
    expect(opts).toEqual({ beforeNextHand: true });
    expect(opts).not.toHaveProperty('untilResumed');
    expect(BOUNTY_ONLY_FINAL_TWO_PARK_MS).toBeGreaterThan(0);
  });

  it('a hand that leaves three deals on', () => {
    const { m, engine } = boundary({}, 3);
    m.holdBountyOnlyFinalTwoBoundary(engine, stacks(5000, 3000, 1000));
    expect(engine.pauseAfterHand).not.toHaveBeenCalled();
    expect(m.requestDecidedEliminationSweep).not.toHaveBeenCalled();
  });

  it('a hand that leaves one holds nothing: the ordinary finish owns it', () => {
    const { m, engine } = boundary();
    m.holdBountyOnlyFinalTwoBoundary(engine, stacks(8000, 0));
    expect(engine.pauseAfterHand).not.toHaveBeenCalled();
  });

  it('an event with places to pay deals on at two', () => {
    const { m, engine } = boundary({ tournamentCache: ORDINARY_PKO });
    m.holdBountyOnlyFinalTwoBoundary(engine, stacks(5000, 3000));
    expect(engine.pauseAfterHand).not.toHaveBeenCalled();
  });

  it('a closed or refused close holds nothing', () => {
    for (const over of [{ closed: true }, { refused: true }]) {
      const { m, engine } = boundary({ bountyOnlyFinalTwo: state(over) });
      m.holdBountyOnlyFinalTwoBoundary(engine, stacks(5000, 3000));
      expect(engine.pauseAfterHand).not.toHaveBeenCalled();
    }
  });

  it('a partial bust list is not the size of the field', () => {
    // Two stacks reported at a table of six says nothing about the field.
    const { m, engine } = boundary({}, 6);
    m.holdBountyOnlyFinalTwoBoundary(engine, stacks(5000, 3000));
    expect(engine.pauseAfterHand).not.toHaveBeenCalled();
  });

  it('a field still spread over two tables is not at the final two', () => {
    const engine = fakeEngine(2);
    const m = manager({
      tableEngines: new Map([
        ['t1', engine],
        ['t2', fakeEngine(2)],
      ]),
    });
    m.holdBountyOnlyFinalTwoBoundary(engine, stacks(5000, 3000));
    expect(engine.pauseAfterHand).not.toHaveBeenCalled();
  });

  it('nothing it can throw may stop the bust wake that follows it', () => {
    const m = manager({
      tableEngines: new Map([
        [
          't1',
          {
            pauseAfterHand: () => {
              throw new Error('engine gone');
            },
            getOccupiedSeatNumbers: () => [1, 2],
          },
        ],
      ]),
    });
    const [engine] = m.tableEngines.values();
    expect(() => m.holdBountyOnlyFinalTwoBoundary(engine, stacks(5000, 3000))).not.toThrow();
  });

  it('the manager holds it at the hand boundary, before the decided hint', () => {
    const hold = BASE.indexOf('this.holdBountyOnlyFinalTwoBoundary(engine, finalStacks);');
    const zeroStack = BASE.indexOf(
      'if (finalStacks.some((player) => Number(player.stack) <= 0)) {'
    );
    const wake = BASE.indexOf('this.requestEliminationSweep();', hold);
    expect(hold).toBeGreaterThan(zeroStack);
    expect(wake).toBeGreaterThan(hold);
  });
});

// ──────────────────────────────────────── 4. the place collision, engine half
describe('the close at two owns the park it armed', () => {
  // closeBountyOnlyPkoAtTwo re-arms the park as an untilResumed CLAIM once
  // every table is parked, and arming a claim on an already parked dealer
  // republishes its park edge. releaseManagedTablePauseIfUnowned was handed
  // that claim in the same tick and lifted it, because a bounty only PKO has
  // no money bubble and so never has hand-for-hand active to hold the table.
  // The table then dealt on through the close and the head was lost.
  function parked(over: Record<string, unknown> = {}) {
    const engine = {
      requiresExplicitPauseResume: () => true,
      resumeDealing: vi.fn(),
    };
    const m = manager({
      onBreak: false,
      stageEndPause: false,
      handForHandActive: false,
      addOnDrainPending: false,
      addOnBreakActive: false,
      addOnBreakOwnsPause: false,
      mysteryActivationBoundaryPending: false,
      successorDrainRequested: false,
      ...over,
    });
    return { m, engine };
  }

  it('does not hand the claim back while the close still holds its park', () => {
    const { m, engine } = parked({ bountyOnlyFinalTwo: state({ parked: true }) });
    m.releaseManagedTablePauseIfUnowned(engine);
    expect(engine.resumeDealing).not.toHaveBeenCalled();
  });

  it('hands it back once the close has given up and released it itself', () => {
    // A rule refusal (or retries past their budget) sets refused and calls
    // release(): the event plays on heads up and nothing may hold the table.
    const { m, engine } = parked({
      bountyOnlyFinalTwo: state({ parked: false, refused: true }),
    });
    m.releaseManagedTablePauseIfUnowned(engine);
    expect(engine.resumeDealing).toHaveBeenCalledTimes(1);
  });

  it('hands it back when no close is holding anything', () => {
    const { m, engine } = parked();
    m.releaseManagedTablePauseIfUnowned(engine);
    expect(engine.resumeDealing).toHaveBeenCalledTimes(1);
  });

  it('still asks every authority the pause law names, and still holds no timer', () => {
    const release = BASE.slice(
      BASE.indexOf(
        'protected releaseManagedTablePauseIfUnowned(engine: ServerTableEngine): void {'
      ),
      BASE.indexOf('/** A replacement inherits every pause authority before it can deal. */')
    );
    expect(release).toContain('engine.requiresExplicitPauseResume()');
    expect(release).toContain('this.onBreak || this.stageEndPause || this.handForHandActive');
    expect(release).toContain('this.addOnBreakActive && this.addOnBreakOwnsPause');
    expect(release).toContain('if (this.bountyOnlyFinalTwoOwnsPause()) return;');
    expect(release).toContain('engine.resumeDealing()');
    expect(release).not.toContain('setTimeout');
    expect(release).not.toContain('setLifecycleTimeout');
    expect(release).not.toContain('setLifecycleInterval');
  });
});

describe('a close the authority answered with a held place 2 is retried, not lost', () => {
  function asked(answer: unknown) {
    const tables = [{ pauseAfterHand: vi.fn(), isParkedBetweenHands: () => true }];
    const recordRefusal = vi.fn(async () => undefined);
    const deps = {
      tournamentId: 'event-1234',
      tables,
      state: state({ seenAtTwoOrFewer: true }),
      rpc: vi.fn(async () => ({ data: answer, error: null })),
      recheckAfter: vi.fn(),
      release: vi.fn(),
      report: vi.fn(),
      recordRefusal,
    } satisfies FinalTwoDeps;
    return { deps, recordRefusal };
  }

  it('keeps the tables parked and asks again, moving nothing and refusing nothing', async () => {
    // 20261107130652: the authority answers instead of dying on
    // trg_tournament_place_collision's 23505, because place 2 is held for a
    // moment by the bounty rebuy step's temporary position.
    const { deps, recordRefusal } = asked({
      ok: false,
      reason: 'finishing_place_two_is_held',
      held_by: '4b532a4a-6b79-476b-ab05-b4e0637a52d1',
      runner_up_user_id: '9b918b56-08d8-4a06-b8a0-de2bf4022303',
      live: 2,
    });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('retry');
    expect(deps.recheckAfter).toHaveBeenCalledWith(BOUNTY_ONLY_FINAL_TWO_RETRY_MS);
    expect(deps.release).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
    expect(recordRefusal).not.toHaveBeenCalled();
    expect(deps.state.refused).toBe(false);

    // The money core clears the temporary place; the next ask closes.
    deps.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('closed');
    expect(deps.state.closed).toBe(true);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('a field that already passed two is reported as a MISS, and not hidden from the watch', async () => {
    // ca_bounty_only_final_two_refusals suppresses the watch's
    // closed_without_final_two alert, so a close that arrived too late must NOT
    // write one: this is exactly the loss the rule exists to catch.
    const { deps, recordRefusal } = asked({ ok: false, reason: 'field_is_not_two', live: 1 });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('refused');
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(recordRefusal).not.toHaveBeenCalled();
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(deps.report.mock.calls[0][1]).toBe('Tournament.bounty_only_final_two_missed');
    expect(String(deps.report.mock.calls[0][0].message)).toContain('passed two');
  });

  it('a field not yet settled at two is still a "not yet"', async () => {
    const { deps } = asked({ ok: false, reason: 'field_is_not_two', live: 3 });
    expect(await closeBountyOnlyPkoAtTwo(deps)).toBe('retry');
    expect(deps.release).not.toHaveBeenCalled();
  });
});
