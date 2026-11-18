/**
 * Upgrade 08 and 09 evidence counters on the Lightning path: the stale
 * pre-action a server-owned Horse seat sheds at its live turn, and the
 * seven-deuce game reaching a Horse turn decision. Real host, real
 * HandController, real decideLightningHorse; nothing here calls noteFire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the Lightning host fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the Lightning host fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

const { buildHost, formedHand, flush } = await import('../testing/lightningHostTestKit.js');
const { drainFires, enableBrainTelemetry } = await import('../engine/BrainTelemetry.js');
const { decideLightningHorse } = await import('./LightningHorse.js');
type Turn = import('./LightningHorse.js').LightningHorseTurn;

const fired = (feature: string): number =>
  drainFires().find((f) => f.feature === feature)?.fires ?? 0;

/** Heads-up, both seats Horses whose own client holds the seat until told otherwise. */
async function startedHand(base: number) {
  const formed = formedHand(2, base);
  const seat = { clientOwned: true };
  const events: string[] = [];
  const t = buildHost(formed, [100, 100], {
    horses: new Set(formed.players),
    deps: {
      isClientControlling: () => seat.clientOwned,
      recordPreAction: (e) => events.push(`${e.playerId}:${e.kind}:${e.action}:${e.detail}`),
    },
  });
  await t.host.start();
  await flush();
  return { formed, seat, events, t };
}

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
});

describe('upgrade 09: a stale pre-action purged at a Horse live turn is counted', () => {
  async function bigBlindTurn(base: number, arm: boolean) {
    const { formed, seat, events, t } = await startedHand(base);
    if (arm) {
      expect(
        t.host.setPreAction(formed.bb, 'auto_check_fold', undefined, formed.handId).success
      ).toBe(true);
    }
    // The small blind's client completes; the brain owns the big blind's turn.
    expect(t.host.handlePlayerAction(formed.sb, 'call').success).toBe(true);
    seat.clientOwned = false;
    await flush();
    expect(t.horseLane.calls.some((snap) => snap.player.user_id === formed.bb)).toBe(true);
    return {
      purged: events.includes(`${formed.bb}:cleared:auto_check_fold:horse_live_turn`),
      fires: fired('upgrade09_preaction_purge_lightning_seen'),
    };
  }

  it('fires once when the seat reaches its turn with a pre-action still armed', async () => {
    expect(await bigBlindTurn(8100, true)).toEqual({ purged: true, fires: 1 });
  });

  it('does not fire when nothing is armed', async () => {
    expect(await bigBlindTurn(8200, false)).toEqual({ purged: false, fires: 0 });
  });
});

describe('upgrade 08: the seven-deuce game reaching a Lightning Horse turn is counted', () => {
  async function decide(extra: Partial<Turn>) {
    const { formed, t } = await startedHand(8300);
    drainFires();
    const turn: Turn = {
      hc: (t.host as unknown as { hc: Turn['hc'] }).hc,
      userId: formed.sb,
      seat: t.host.peekState()!.currentPlayerSeat,
      horseProfile: null,
      variant: 'nlh',
      bigBlind: 2,
      smallBlind: 1,
      ante: 0,
      bigBlindAnte: false,
      allInOrFold: false,
      actionTimeSeconds: 15,
      actions: [],
      generation: 1,
      fence: 'upgrade-counter-fixture',
      turnStartMs: Date.now(),
      now: Date.now(),
      ...extra,
    };
    const answer = await decideLightningHorse(turn, new AbortController().signal, () => {
      return t.horseLane.lane;
    });
    expect(answer.workerFallback).toBe(false);
    return {
      sent: t.horseLane.calls.at(-1)!.gameState.sevenDeuceEnabled,
      fires: fired('upgrade08_seven_deuce_seen'),
    };
  }

  it('fires once on a turn decision at a seven-deuce table', async () => {
    expect(await decide({ sevenDeuceEnabled: true })).toEqual({ sent: true, fires: 1 });
  });

  it('does not fire on an early look, nor without the seven-deuce game', async () => {
    expect((await decide({ sevenDeuceEnabled: true, earlyLook: true })).fires).toBe(0);
    expect(await decide({})).toEqual({ sent: undefined, fires: 0 });
  });
});
