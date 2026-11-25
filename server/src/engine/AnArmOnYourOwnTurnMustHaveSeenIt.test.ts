/**
 * AN ARM ON YOUR OWN TURN MUST HAVE SEEN IT (Dan 2026-11-24, CoachTim68).
 *
 * Breakfast Turbo 425c3668, hand 67a4924c: a late registrant with 5,000 was
 * dealt 5-3 offsuit, "folded", and was told he was out. His seat was recorded
 * `all_in 5000 [pre_action]`, 19 seconds into his turn, against a 9,450 shove
 * his lagging display had not shown. This drives the real HandController into
 * that spot (a shove in front of a 5,000 stack, 400/800, big blind ante) and
 * pins the engine's rule (PreActionOnOwnTurn.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: () => {
      throw Error('Unexpected SQL');
    },
    rpc: () => {
      throw Error('Unexpected RPC');
    },
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('../http/auth.js', () => ({
  authenticateRequest: vi.fn(async () => ({ userId: 'hero' })),
}));
vi.mock('../http/body.js', () => ({
  readBody: vi.fn(async (req: { __body?: string }) => req.__body ?? '{}'),
}));

const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { HandController } = await import('./HandController.js');
const { handlePreaction } = await import('../handlers/preaction.js');
const { mockRes, parseJson } = await import('../handlers/_testHelpers.js');
const { ownTurnArmRefusal } = await import('./PreActionOnOwnTurn.js');

const TABLE = 'cccccccc-1124-4000-8000-00000000c0a1';
const HERO = 'hero';
const SHOVER = 'shover';

afterEach(() => vi.restoreAllMocks());

/** CoachTim68's spot: the seat before him shoves; it is then his turn. */
function coachTimSpot() {
  const stacks: Record<number, [string, number]> = {
    1: [SHOVER, 9450],
    2: [HERO, 5000],
    3: ['v3', 17886],
    4: ['v4', 11200],
    5: ['v5', 4700],
    6: ['v6', 20448],
  };
  const players = Object.entries(stacks).map(([seat, [user_id, stack]]) => ({
    seat: Number(seat),
    user_id,
    username: user_id,
    stack,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  }));
  // Dealer 4: small blind 5, big blind 6, so seat 1 opens and seat 2 is next.
  const hand = new HandController(
    {
      tableId: TABLE,
      handNumber: 60771977,
      gameVariant: 'nlh',
      smallBlind: 400,
      bigBlind: 800,
      ante: 800,
      bigBlindAnte: true,
      isTournament: true,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as any,
    players as any,
    4
  );
  hand.start();
  const e = new ServerTableEngine(TABLE) as any;
  e.hub = { emitEvent: vi.fn(), sendToUser: vi.fn().mockReturnValue(1) };
  e.handController = hand;
  expect(hand.getState().currentPlayerSeat).toBe(1);
  // What the lagging display was showing: the shover still deciding at 800.
  const beforeShove = e.getActionContext() as string;
  expect(beforeShove).toBeTruthy();
  expect(hand.performAction(1, 'all_in' as any, undefined, 'horse_policy')).toBe(true);
  expect(hand.getState().currentPlayerSeat).toBe(2);
  const onHisTurn = e.getActionContext() as string;
  expect(onHisTurn).toBeTruthy();
  expect(onHisTurn).not.toBe(beforeShove);
  // The executor: the real one runs the whole table pipeline (lease, clocks,
  // broadcast). Whether it is reached, and with what, is the question here.
  const acted = vi.fn(() => ({ success: true }));
  e.handlePlayerAction = acted;
  const heroStack = () => hand.getState().players.find((p: any) => p.user_id === HERO)!.stack;
  return { e, hand, acted, beforeShove, onHisTurn, heroStack };
}

describe('a Call or Call Any armed on your own turn', () => {
  it.each(['auto_call_any', 'auto_call'])(
    '%s from a display that has not shown the shove is refused, not played and not armed',
    (action) => {
      const { e, acted, beforeShove, heroStack } = coachTimSpot();
      const r = e.setPreAction(
        HERO,
        action,
        action === 'auto_call' ? 800 : undefined,
        undefined,
        beforeShove
      );
      expect(r).toEqual({
        success: false,
        code: 'STALE_ACTION',
        error: 'The turn has changed. Review the table before acting again.',
      });
      expect(acted).not.toHaveBeenCalled();
      expect(e.preActionEngine.getPreAction(TABLE, HERO)).toBeNull();
      expect(heroStack()).toBe(5000);
    }
  );

  it('naming no decision at all (an older page) is refused the same way', () => {
    const { e, acted, heroStack } = coachTimSpot();
    expect(e.setPreAction(HERO, 'auto_call_any')).toMatchObject({ code: 'STALE_ACTION' });
    expect(acted).not.toHaveBeenCalled();
    expect(e.preActionEngine.getPreAction(TABLE, HERO)).toBeNull();
    expect(heroStack()).toBe(5000);
  });

  it('made against the decision on the table now is played at once, as before', () => {
    const { e, acted, onHisTurn } = coachTimSpot();
    expect(e.setPreAction(HERO, 'auto_call_any', undefined, undefined, onHisTurn)).toMatchObject({
      success: true,
    });
    // Call Any is the call it promised: the whole 5,000 against the 9,450.
    expect(acted).toHaveBeenCalledWith(HERO, 'call', 5000, undefined, 'pre_action', 'pre_action');
  });
});

describe('arms that cannot put chips in', () => {
  it.each([
    ['auto_fold', 'fold'],
    ['auto_check_fold', 'fold'],
  ])('%s still acts at once on your own turn with no decision named', (action, played) => {
    const { e, acted } = coachTimSpot();
    expect(e.setPreAction(HERO, action)).toMatchObject({ success: true });
    expect(acted).toHaveBeenCalledWith(
      HERO,
      played,
      0,
      undefined,
      'pre_action',
      action === 'auto_check_fold' ? 'quick_check_fold' : 'pre_action'
    );
  });
});

describe('a genuine pre-action, armed before the turn', () => {
  it('Call Any waits for the turn and needs no decision named', () => {
    const { e, hand, acted } = coachTimSpot();
    // Seat 3 is not on turn: an ordinary arm, held for when action arrives.
    expect(hand.getState().currentPlayerSeat).toBe(2);
    expect(e.setPreAction('v3', 'auto_call_any')).toMatchObject({ success: true });
    expect(acted).not.toHaveBeenCalled();
    expect(e.preActionEngine.getPreAction(TABLE, 'v3')?.action).toBe('auto_call_any');
  });
});

describe('POST /preaction carries the decision the page showed', () => {
  it('passes actionContext through to the engine', async () => {
    const setPreAction = vi.fn(() => ({ success: true }));
    const req = {
      __body: JSON.stringify({ tableId: TABLE, action: 'auto_call_any', actionContext: 'ctx-1' }),
    };
    const { res, captured } = mockRes();
    await handlePreaction(req as any, res, {
      gameServer: { getTableEngine: () => ({ setPreAction }) },
    });
    expect(parseJson(captured)).toEqual({ success: true });
    expect(setPreAction).toHaveBeenCalledWith(HERO, 'auto_call_any', undefined, undefined, 'ctx-1');
  });
});

describe('the rule itself', () => {
  it('asks only Call and Call Any for a matching decision', () => {
    for (const a of ['auto_fold', 'auto_check_fold', 'auto_check']) {
      expect(ownTurnArmRefusal(a, undefined, 'x')).toBeNull();
    }
    for (const a of ['auto_call', 'auto_call_any']) {
      expect(ownTurnArmRefusal(a, 'x', 'x')).toBeNull();
      expect(ownTurnArmRefusal(a, 'y', 'x')).not.toBeNull();
      expect(ownTurnArmRefusal(a, '', 'x')).not.toBeNull();
      expect(ownTurnArmRefusal(a, 'x', null)).not.toBeNull();
    }
  });
});
