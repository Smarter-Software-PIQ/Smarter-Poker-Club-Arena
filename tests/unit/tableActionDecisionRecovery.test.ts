import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveSnapshotActionContext,
  resolveTurnChangeActionContext,
  startMissingDecisionPoller,
  submitTableDecision,
  tableDecisionIsReady,
  type SnapshotActionContextCarryInput,
} from '../../src/lib/tableActionDecision';

const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');

describe('Mongo missing decision recovery', () => {
  it('a stale hero refreshes once without posting or replaying the bet', async () => {
    const send = vi.fn();
    const refresh = vi.fn(async () => true);
    const result = await submitTableDecision({
      actionContext: 'turn:1',
      allowContextless: false,
      clientStateStale: true,
      send,
      refresh,
    });
    expect(send).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, code: 'CLIENT_DECISION_REFRESHED' });
    expect(result.error).toContain('Not Sent');
  });

  it('the page submits the decision visible at the tap, rather than a render closure', () => {
    expect(page).toContain('actionContext: tableStateRef.current.actionContext');
    expect(page).toContain('await submitTableDecision({');
    expect(page).not.toContain('submitAction(tid, uid, action, amount, tableState.actionContext)');
  });
  it('checks missing-token input before optimistic paint can hide its refreshed turn', () => {
    const panel = page.slice(page.indexOf('const handleActionPanelAction = useCallback('));
    const guard = panel.search(/if\s*\(\s*!tableDecisionIsReady\(\{/);
    expect(guard).toBeGreaterThan(0);
    expect(panel.indexOf('finally {', guard)).toBeLessThan(panel.indexOf('setTimeout('));
    expect(panel.indexOf('actionLockRef.current = false;', guard)).toBeLessThan(
      panel.indexOf('setTimeout(')
    );
    expect(panel.indexOf("'panel-missing-decision'")).toBeGreaterThan(guard);
    expect(panel.indexOf("'panel-missing-decision'")).toBeLessThan(
      panel.indexOf("applyOptimisticHeroAction('fold')")
    );
  });
  it('does not send a context-free Classic fold and requests state exactly once', async () => {
    const send = vi.fn();
    const refresh = vi.fn(async () => true);
    const result = await submitTableDecision({
      actionContext: undefined,
      allowContextless: false,
      send,
      refresh,
    });
    expect(send).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/reload/i);
  });
  it.each([
    'ACTION_CONTEXT_REQUIRED',
    'STALE_ACTION',
    'ACTION_NOT_DELIVERED',
    'ACTION_STATE_PENDING',
    'ACTION_NOT_ACCEPTED',
  ])('refreshes a %s refusal without replaying the choice', async (code) => {
    const send = vi.fn(async () => ({ success: false, code, error: 'refused' }));
    const refresh = vi.fn(async () => true);
    expect(
      (
        await submitTableDecision({
          actionContext: 'turn:1',
          allowContextless: false,
          send,
          refresh,
        })
      ).success
    ).toBe(false);
    expect(send).toHaveBeenCalledExactlyOnceWith('turn:1');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('preserves the contextless Lightning path and successful actions', async () => {
    const send = vi.fn(async () => ({ success: true }));
    const refresh = vi.fn(async () => true);
    expect(
      await submitTableDecision({ actionContext: undefined, allowContextless: true, send, refresh })
    ).toEqual({ success: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(refresh).not.toHaveBeenCalled();
  });
  it('a lost accepted bet with no snapshot stays explicitly unconfirmed, never a refusal', async () => {
    const send = vi.fn(async () => ({ success: false, code: 'ACTION_NOT_DELIVERED' }));
    const result = await submitTableDecision({
      actionContext: 'turn:1',
      allowContextless: false,
      send,
      refresh: async () => false,
    });
    expect(send).toHaveBeenCalledExactlyOnceWith('turn:1');
    expect(result).toMatchObject({ success: false, outcomeUnconfirmed: true });
    const panel = page.slice(
      page.indexOf('const handleActionPanelAction = useCallback('),
      page.indexOf('// handleConfirmRaise was removed')
    );
    expect(panel.match(/if \(ok === false\) revert\(\);/g)).toHaveLength(5);
    expect(page).toContain('return res.outcomeUnconfirmed ? null : false;');
    expect(page).toMatch(/error: res.outcomeUnconfirmed\s*\? ACTION_NOT_DELIVERED_MESSAGE/);
  });

  it('keeps ordinary rejection details without requesting another state', async () => {
    const result = {
      success: false,
      code: 'MIN_RAISE',
      error: 'Raise is below the minimum',
      hint: { minRaise: 20 },
    };
    const refresh = vi.fn(async () => true);
    expect(
      await submitTableDecision({
        actionContext: 'turn:1',
        allowContextless: false,
        send: async () => result,
        refresh,
      })
    ).toBe(result);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('authoritative decision readiness', () => {
  it('withholds Classic controls and submission together, then accepts only a fresh explicit tap', async () => {
    const send = vi.fn(async () => ({ success: true }));
    const refresh = vi.fn(async () => true);
    const withheld = { actionContext: undefined, allowContextless: false };
    expect(tableDecisionIsReady(withheld)).toBe(false);
    expect(await submitTableDecision({ ...withheld, send, refresh })).toMatchObject({
      code: 'CLIENT_DECISION_REFRESHED',
    });
    expect(send).not.toHaveBeenCalled();
    const ready = { ...withheld, actionContext: 'incarnation:preflop:0:4:20' };
    expect(tableDecisionIsReady(ready)).toBe(true);
    // Receiving readiness never submits the previously refused choice.
    expect(send).not.toHaveBeenCalled();
    await submitTableDecision({ ...ready, send, refresh });
    expect(send).toHaveBeenCalledExactlyOnceWith(ready.actionContext);
  });

  it('shares readiness across the actual panel, keyboard and submit paths without stopping the clock', () => {
    expect(page).toContain('const heroDecisionReady = tableDecisionIsReady({');
    expect(page).toContain('isHeroTurn: isHeroTurnContext && heroDecisionReady');
    expect(page).toMatch(/tableState\.isHandInProgress &&\s+heroDecisionReady &&/);
    const timer = page.slice(
      page.indexOf('const { clock: actionClock'),
      page.indexOf('const { clock: actionClock') + 1600
    );
    expect(timer).toContain('isHeroTurn: isHeroTurnContext,');
    expect(timer).not.toContain('heroDecisionReady');
    expect(page).toContain(
      'const heroPromptedToAct = isHeroTurnContext && !suppressPanelForPreAction;'
    );
  });

  it('never turns a stale hero into ready input, and preserves the existing Lightning contract', () => {
    expect(
      tableDecisionIsReady({
        actionContext: 'old-hand-token',
        allowContextless: false,
        clientStateStale: true,
      })
    ).toBe(false);
    expect(tableDecisionIsReady({ actionContext: undefined, allowContextless: true })).toBe(true);
    expect(
      tableDecisionIsReady({
        actionContext: undefined,
        allowContextless: true,
        clientStateStale: true,
      })
    ).toBe(false);
    // The actual actor/hand gate remains independent; a valid token alone never grants a turn.
    const gate = page.match(/const isHeroTurnContext =([\s\S]*?);/)?.[1];
    expect(gate).toBeTruthy();
    const isTurn = new Function('tableState', 'return (' + gate + ')');
    expect(isTurn({ heroSeat: 4, currentPlayerSeat: 2, isHandInProgress: true })).toBe(false);
    expect(isTurn({ heroSeat: 4, currentPlayerSeat: 4, isHandInProgress: false })).toBe(false);
  });

  it('preserves already-retained actionContext across mid-turn TIME_BANK_ACTIVATED snapshots and requests bounded RESYNC when a turn arrives with withheld action_context', () => {
    expect(page).toContain('actionContext: resolveSnapshotActionContext({');
    expect(page).toContain('isTimeBankActive: Boolean(mapped.isTimeBankActive),');
    expect(page).toContain('nextTurnStartTimeMs: mapped.actionTimerStartTime,');
    expect(page).toContain('const stopPoller = startMissingDecisionPoller({');
    expect(page).toContain('if (!cancelled) requestEngineSnapshot();');
    expect(page).toContain('GameServerAPI.getTableState(requestedTableId)');
  });

  it('clears the previous hand turn clock on HAND_STARTED and blocks stale previous-hand deadlines from auto-spending UTG time bank before UTG decision is ready', () => {
    const handStarted = page.slice(
      page.indexOf("case 'HAND_STARTED': {"),
      page.indexOf("case 'BOMB_POT_TRIGGERED': {")
    );
    expect(handStarted).toContain('actionContext: undefined,');
    expect(handStarted).toContain('actionTimerDeadline: undefined,');
    expect(handStarted).toContain('actionTimerStartTime: undefined,');
    expect(handStarted).toContain('isTimeBankActive: false,');

    expect(page).toContain('const freshTurnClock =');
    expect(page).toContain('mapped.actionTimerStartTime !== prev.actionTimerStartTime');
    expect(page).toContain('actionTimerDeadline: nextActionTimerDeadline,');
    expect(page).toContain('actionTimerStartTime: nextActionTimerStartTime,');

    const timerBlock = page.slice(
      page.indexOf('const { clock: actionClock'),
      page.indexOf('const { clock: actionClock') + 1900
    );
    expect(timerBlock).toContain(
      '(!lightningRoomRef.current && !tableStateRef.current.actionContext)'
    );
  });

  it('preserves same-seat actionContext and adopts deadline_ms when TURN_CHANGE arrives without a decision token', () => {
    const turnChange = page.slice(
      page.indexOf("case 'TURN_CHANGE': {"),
      page.indexOf("case 'TIMER_COUNTDOWN': {")
    );
    expect(turnChange).toContain('const resolvedActionContext = resolveTurnChangeActionContext({');
    expect(turnChange).toContain('previousCurrentSeat: prev.currentPlayerSeat,');
    expect(turnChange).toContain('actionContext: resolvedActionContext,');
    expect(turnChange).toContain('Number.isFinite(deadlineMs) && deadlineMs > 0');
  });
});

describe('preserved actionContext boundary invariants', () => {
  const baseCarryInput: SnapshotActionContextCarryInput = {
    incomingActionContext: undefined,
    previousActionContext: 'incarnation-1:preflop:0:2:5',
    answeredDecision: null,
    sameHand: true,
    nextCurrentSeat: 2,
    previousCurrentSeat: 2,
    nextStage: 'preflop',
    previousStage: 'preflop',
    nextCurrentBet: 5,
    previousCurrentBet: 5,
    nextMinRaise: 10,
    previousMinRaise: 10,
    nextLastRaise: 5,
    previousLastRaise: 5,
    nextWagersCapped: false,
    previousWagersCapped: false,
    nextBettingStructure: 'NL',
    previousBettingStructure: 'NL',
    nextFixedBetSize: undefined,
    previousFixedBetSize: undefined,
    nextFixedRaiseSize: undefined,
    previousFixedRaiseSize: undefined,
    nextPotLimitPot: undefined,
    previousPotLimitPot: undefined,
    nextActorBet: 2,
    previousActorBet: 2,
    nextActorStatus: 'active',
    previousActorStatus: 'active',
    isTimeBankActive: true,
    nextTurnStartTimeMs: 1700000000500,
    previousTurnStartTimeMs: 1700000000500,
  };

  it('prefers incoming non-empty actionContext, carries previousActionContext across mid-turn time-bank extension on the same turn clock, and clears when isTimeBankActive is false', () => {
    expect(
      resolveSnapshotActionContext({
        ...baseCarryInput,
        incomingActionContext: 'incarnation-1:preflop:0:2:10',
      })
    ).toBe('incarnation-1:preflop:0:2:10');

    expect(resolveSnapshotActionContext(baseCarryInput)).toBe('incarnation-1:preflop:0:2:5');

    expect(
      resolveSnapshotActionContext({
        ...baseCarryInput,
        isTimeBankActive: false,
      })
    ).toBeUndefined();
  });

  it('rejects preserved actionContext across hand, street, seat, turn clock, answered decision, or actor status changes', () => {
    expect(resolveSnapshotActionContext({ ...baseCarryInput, sameHand: false })).toBeUndefined();
    expect(resolveSnapshotActionContext({ ...baseCarryInput, nextStage: 'flop' })).toBeUndefined();
    expect(resolveSnapshotActionContext({ ...baseCarryInput, nextCurrentSeat: 3 })).toBeUndefined();
    expect(resolveSnapshotActionContext({ ...baseCarryInput, nextCurrentSeat: 0 })).toBeUndefined();
    expect(
      resolveSnapshotActionContext({
        ...baseCarryInput,
        nextTurnStartTimeMs: 1700000001500,
      })
    ).toBeUndefined();
    expect(
      resolveSnapshotActionContext({
        ...baseCarryInput,
        nextTurnStartTimeMs: 0,
        previousTurnStartTimeMs: 0,
      })
    ).toBeUndefined();
    expect(
      resolveSnapshotActionContext({
        ...baseCarryInput,
        nextTurnStartTimeMs: undefined,
        previousTurnStartTimeMs: undefined,
      })
    ).toBeUndefined();
    expect(
      resolveSnapshotActionContext({
        ...baseCarryInput,
        answeredDecision: 'incarnation-1:preflop:0:2:5',
      })
    ).toBeUndefined();
    expect(
      resolveSnapshotActionContext({ ...baseCarryInput, nextActorStatus: 'folded' })
    ).toBeUndefined();
    expect(
      resolveSnapshotActionContext({ ...baseCarryInput, nextActorStatus: 'all_in' })
    ).toBeUndefined();
  });

  it('rejects preserved actionContext when any legal-action betting bound changes', () => {
    expect(resolveSnapshotActionContext({ ...baseCarryInput, nextCurrentBet: 10 })).toBeUndefined();
    expect(resolveSnapshotActionContext({ ...baseCarryInput, nextMinRaise: 15 })).toBeUndefined();
    expect(resolveSnapshotActionContext({ ...baseCarryInput, nextLastRaise: 10 })).toBeUndefined();
    expect(
      resolveSnapshotActionContext({ ...baseCarryInput, nextWagersCapped: true })
    ).toBeUndefined();
    expect(
      resolveSnapshotActionContext({ ...baseCarryInput, nextBettingStructure: 'PLO' })
    ).toBeUndefined();
    expect(
      resolveSnapshotActionContext({ ...baseCarryInput, nextFixedBetSize: 10 })
    ).toBeUndefined();
    expect(
      resolveSnapshotActionContext({ ...baseCarryInput, nextFixedRaiseSize: 20 })
    ).toBeUndefined();
    expect(
      resolveSnapshotActionContext({ ...baseCarryInput, nextPotLimitPot: 40 })
    ).toBeUndefined();
    expect(resolveSnapshotActionContext({ ...baseCarryInput, nextActorBet: 5 })).toBeUndefined();
  });

  it('guards TURN_CHANGE carry against hand, seat, clock, and answered-decision boundaries', () => {
    const baseTurnChange = {
      incomingActionContext: undefined,
      previousActionContext: 'incarnation-1:preflop:0:2:5',
      answeredDecision: null,
      isHandInProgress: true,
      newSeat: 2,
      previousCurrentSeat: 2,
      eventHandNumber: 42,
      previousHandNumber: 42,
      eventTimestampMs: 1700000000500,
      previousTurnStartTimeMs: 1700000000500,
    };
    expect(resolveTurnChangeActionContext(baseTurnChange)).toBe('incarnation-1:preflop:0:2:5');
    expect(
      resolveTurnChangeActionContext({ ...baseTurnChange, isHandInProgress: false })
    ).toBeUndefined();
    expect(resolveTurnChangeActionContext({ ...baseTurnChange, newSeat: 4 })).toBeUndefined();
    expect(
      resolveTurnChangeActionContext({ ...baseTurnChange, eventHandNumber: 43 })
    ).toBeUndefined();
    expect(
      resolveTurnChangeActionContext({
        ...baseTurnChange,
        eventTimestampMs: 1700000001000,
      })
    ).toBeUndefined();
    expect(
      resolveTurnChangeActionContext({
        ...baseTurnChange,
        answeredDecision: 'incarnation-1:preflop:0:2:5',
      })
    ).toBeUndefined();
  });
});

describe('startMissingDecisionPoller lifecycle, concurrency, and error backoff', () => {
  it('recovers after more than 6 attempts and stops immediately when stop() is called', async () => {
    vi.useFakeTimers();
    try {
      const requestSnapshot = vi.fn();
      let httpAttempt = 0;
      const fetchTableState = vi.fn(async () => {
        httpAttempt += 1;
        if (httpAttempt <= 8) {
          return { current_player: 2, action_context: undefined };
        }
        return { current_player: 2, action_context: 'incarnation-1:preflop:0:2:5' };
      });
      const onTableState = vi.fn((state: Record<string, unknown>) => {
        if (state.action_context) {
          stop();
        }
      });

      const stop = startMissingDecisionPoller({
        requestSnapshot,
        fetchTableState,
        onTableState,
      });

      // Advance past initial 120ms + eight 350ms intervals (9 total attempts > 6).
      for (let i = 0; i < 10; i += 1) {
        await vi.advanceTimersByTimeAsync(350);
      }

      expect(requestSnapshot).toHaveBeenCalledTimes(9);
      expect(fetchTableState).toHaveBeenCalledTimes(9);
      expect(onTableState).toHaveBeenLastCalledWith({
        current_player: 2,
        action_context: 'incarnation-1:preflop:0:2:5',
      });

      // Advancing further after stop() produces zero additional calls.
      await vi.advanceTimersByTimeAsync(5000);
      expect(requestSnapshot).toHaveBeenCalledTimes(9);
      expect(fetchTableState).toHaveBeenCalledTimes(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prevents overlapping HTTP requests when a slow fetchTableState is still in flight', async () => {
    vi.useFakeTimers();
    try {
      const requestSnapshot = vi.fn();
      let resolvePending!: (val: Record<string, unknown> | null) => void;
      const fetchTableState = vi.fn(
        () =>
          new Promise<Record<string, unknown> | null>((resolve) => {
            resolvePending = resolve;
          })
      );

      const stop = startMissingDecisionPoller({
        requestSnapshot,
        fetchTableState,
      });

      await vi.advanceTimersByTimeAsync(350);
      expect(requestSnapshot).toHaveBeenCalledTimes(1);
      expect(fetchTableState).toHaveBeenCalledTimes(1);

      // Three more 350ms ticks fire while the first HTTP request is still in flight.
      await vi.advanceTimersByTimeAsync(350 * 3);
      expect(requestSnapshot).toHaveBeenCalledTimes(4);
      expect(fetchTableState).toHaveBeenCalledTimes(1);

      resolvePending({ current_player: 2, action_context: 'token-1' });
      await Promise.resolve();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles HTTP rejections with exponential backoff without excessive load and stops at maxAttempts', async () => {
    vi.useFakeTimers();
    try {
      const requestSnapshot = vi.fn();
      const fetchTableState = vi.fn(async () => {
        throw new Error('network error');
      });
      const onTableState = vi.fn();

      startMissingDecisionPoller({
        requestSnapshot,
        fetchTableState,
        onTableState,
        maxAttempts: 10,
      });

      for (let i = 0; i < 15; i += 1) {
        await vi.advanceTimersByTimeAsync(350);
      }

      // WS snapshot capped at exactly maxAttempts (10).
      expect(requestSnapshot).toHaveBeenCalledTimes(10);
      // Exponential HTTP cooldown (1, 2, 4 ticks skipped between failures) keeps HTTP load low (3 requests across 10 ticks).
      expect(fetchTableState).toHaveBeenCalledTimes(3);
      expect(onTableState).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
