/**
 * Dan 2026-11-10: "display only authoritative assignments and handle
 * reassignment, cancellation and reconnect without stale players or card
 * leakage." The engine side of that rule, end to end through the hand host:
 *
 *  - a formation the database refuses at begin_dealing reaches no room at all;
 *  - a formation refused after the participants are known (rules, variant)
 *    tells each room only the idle shape: no player, no card;
 *  - a hand voided after its deal (inside the arrival window) leaves every
 *    room on the idle shape, and the host publishes nothing after it;
 *  - RESYNC on a voided hand re-sends no card;
 *  - a hole card only ever travels privately, to its owner.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the assigned-players fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the assigned-players fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const kit = await import('../testing/lightningHostTestKit.js');
const { buildHost, formedHand, flush } = kit;

type Built = ReturnType<typeof buildHost>;

function playersNamed(t: Built): string[] {
  const ids = new Set<string>();
  for (const f of t.hub.frames) {
    if (f.kind !== 'publish') continue;
    for (const p of (f.payload.players ?? []) as Array<{ user_id?: string; id?: string }>)
      ids.add(String(p?.user_id ?? p?.id ?? ''));
  }
  return [...ids].filter(Boolean);
}

function privateCardFrames(t: Built) {
  return t.hub.frames.filter((f) => f.kind === 'private' && f.payload.kind === 'hole_cards');
}

describe('only an assigned table is ever shown', () => {
  it('a formation refused at begin_dealing reaches no room', async () => {
    const t = buildHost(formedHand(4, 9100), [200, 200, 200, 200]);
    vi.mocked(t.backend.beginDealing).mockResolvedValueOnce({
      ok: false,
      reason: 'formation_superseded',
    } as never);
    await t.host.start();
    await flush();
    expect(t.calls.abandon).toEqual(['begin_dealing_refused:formation_superseded']);
    expect(playersNamed(t)).toEqual([]);
    expect(privateCardFrames(t)).toEqual([]);
    expect(t.hub.frames.filter((f) => f.kind === 'event')).toEqual([]);
  });

  it('a formation refused after its participants are read tells each room only the idle shape', async () => {
    const t = buildHost(formedHand(4, 9200), [200, 200, 200, 200], {
      rules: { game_variant: 'pineapple' },
    });
    await t.host.start();
    await flush();
    expect(t.calls.abandon).toEqual(['variant_not_dealt_by_lightning_host']);
    expect(playersNamed(t)).toEqual([]);
    expect(privateCardFrames(t)).toEqual([]);
    for (const f of t.hub.frames.filter((x) => x.kind === 'publish'))
      expect(f.payload).toMatchObject({ stage: 'waiting', players: [], hand_id: null });
  });

  it('a hand voided inside its arrival window leaves every room empty, and nothing follows', async () => {
    const t = buildHost(formedHand(5, 9300), [200, 200, 200, 200, 200]);
    await t.host.start();
    await flush();
    // The deal went out: the formed players are named, each card privately.
    expect(playersNamed(t).sort()).toEqual([...t.participants.map((p) => p.playerId)].sort());
    await t.host.abort('host_lease_lost');
    await flush();
    for (const p of t.participants) {
      const last = t.hub
        .inRoom(p.poolSessionId)
        .filter((f) => f.kind === 'publish')
        .at(-1)!.payload;
      expect(last).toMatchObject({ stage: 'waiting', players: [], hand_id: null });
    }
    const after = t.hub.frames.length;
    // Reconnect / RESYNC of a voided hand: no card is sent again.
    for (const p of t.participants) t.host.rePushHoleCards(p.playerId);
    await flush();
    expect(t.hub.frames.length).toBe(after);
  });

  it('a hole card only ever travels privately, to its owner, in its owner room', async () => {
    const t = buildHost(formedHand(6, 9400), [200, 200, 200, 200, 200, 200]);
    await t.host.start();
    await flush();
    const cards = privateCardFrames(t);
    expect(cards).toHaveLength(6);
    for (const f of cards) {
      const owner = t.participants.find((p) => p.playerId === f.userId)!;
      expect(f.room).toBe(owner.poolSessionId);
      expect(f.payload.row.user_id).toBe(owner.playerId);
    }
    // No public frame carries a face for any player before showdown. Every
    // published seat carries the `cards` field, so the check is never vacuous.
    let seatsSeen = 0;
    for (const f of t.hub.frames) {
      if (f.kind !== 'publish') continue;
      for (const p of (f.payload.players ?? []) as Array<Record<string, unknown>>) {
        expect(Array.isArray(p.cards)).toBe(true);
        seatsSeen++;
      }
    }
    expect(seatsSeen).toBeGreaterThan(0);
    for (const f of t.hub.frames) {
      if (f.kind === 'private') continue;
      for (const p of (f.payload.players ?? []) as Array<{ cards?: unknown[]; hole_cards?: unknown[] }>) {
        const shown = [...(p.cards ?? []), ...(p.hole_cards ?? [])].filter(
          (c) => c && typeof c === 'object' && 'rank' in (c as object)
        );
        expect(shown).toEqual([]);
      }
    }
  });
});
