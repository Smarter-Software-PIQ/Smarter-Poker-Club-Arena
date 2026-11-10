/**
 * LIGHTNING CHECK/FOLD: the arm belongs to one player in one hand (Dan
 * 2026-11-09). The behaviour itself is pinned in LightningHandHost.test.ts;
 * this file pins what must stay true when requests repeat, cross each other,
 * arrive late, or arrive from a player whose socket has dropped:
 *
 *   - one fold per player per hand, however many times it is asked for;
 *   - a released player is never asked to act and never acts again;
 *   - a cleared arm releases nobody;
 *   - an arm names its own hand and is refused in any other;
 *   - every chip dealt in is accounted for at settlement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const { mulberry32 } = await import('../engine/HandFuzzer.js');
const kit = await import('../testing/lightningHostTestKit.js');
const { buildHost, formedHand, flush, playOut, uid } = kit;

afterEach(() => {
  vi.restoreAllMocks();
});

const cents = (n: number) => Math.round(n * 100);
function conserved(t: ReturnType<typeof buildHost>, startCents: number): void {
  expect(t.calls.settle).toHaveLength(1);
  const s = t.calls.settle[0];
  expect(cents(s.results.reduce((a, p) => a + p.stackAfter, 0) + s.rake + s.bbj)).toBe(startCents);
}
const passive = (_u: string, legal: string[]) => (legal.includes('check') ? 'check' : 'call');

describe('Lightning Check/Fold belongs to one player in one hand', () => {
  it('repeated taps arm once; a cleared arm releases nobody; a re-arm releases once', async () => {
    const formed = formedHand(4, 4100);
    const t = buildHost(formed, [100, 100, 100, 100]);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    for (let i = 0; i < 5; i++)
      expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(
        true
      );
    expect(t.host.setPreAction(bb, 'clear').success).toBe(true);
    const st = t.host.peekState()!;
    const first = st.players.find((p) => p.seat === st.currentPlayerSeat)!;
    expect(t.host.handlePlayerAction(first.user_id, 'raise', 6).success).toBe(true);
    await flush();
    // Cleared before the raise: still in the hand, nothing released.
    expect(t.host.isWatching(bb)).toBe(true);
    expect(t.calls.fastFold).toEqual([]);
    // Armed again while already priced: released now, once, however often it is tapped.
    const results = [0, 1, 2, 3].map(
      () => t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success
    );
    expect(results).toEqual([true, false, false, false]);
    expect(t.host.isWatching(bb)).toBe(false);
    await playOut(t.host, mulberry32(4100), (userId, legal) => {
      expect(userId).not.toBe(bb);
      return passive(userId, legal);
    });
    await flush();
    expect(t.calls.fastFold.filter((f) => f.playerId === bb)).toHaveLength(1);
    expect(t.released.filter((r) => r.playerId === bb)).toHaveLength(1);
    conserved(t, 40000);
  });

  it('requests that arrive after the release change nothing: clear, re-arm, fold, check', async () => {
    const formed = formedHand(4, 4101);
    const t = buildHost(formed, [100, 100, 100, 100]);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    const st = t.host.peekState()!;
    const first = st.players.find((p) => p.seat === st.currentPlayerSeat)!;
    expect(t.host.handlePlayerAction(first.user_id, 'raise', 6).success).toBe(true);
    expect(t.host.isWatching(bb)).toBe(false);
    const before = structuredClone(t.host.peekState()!);
    const context = `lightning-hand:${formed.handId}`;
    for (const late of [
      () => t.host.setPreAction(bb, 'clear'),
      () => t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId),
      () => t.host.setPreAction(bb, 'auto_call_any', undefined, formed.handId),
      () => t.host.handlePlayerAction(bb, 'fast_fold', undefined, context),
      () => t.host.handlePlayerAction(bb, 'fold'),
      () => t.host.handlePlayerAction(bb, 'check'),
      () => t.host.handlePlayerAction(bb, 'call'),
    ])
      expect(late().success).toBe(false);
    // The public hand is exactly as it was: their seat, cards and bet wait for the turn.
    expect(t.host.peekState()).toEqual(before);
    await playOut(t.host, mulberry32(4101), (userId, legal) => {
      expect(userId).not.toBe(bb);
      return passive(userId, legal);
    });
    await flush();
    const result = t.calls.settle[0].results.find((r) => r.playerId === bb)!;
    expect(result.foldType).toBe('fast');
    expect(result.won).toBe(0);
    expect(t.calls.fastFold.filter((f) => f.playerId === bb)).toHaveLength(1);
    conserved(t, 40000);
  });

  it('an arm for another hand is refused and arms nothing in this one', async () => {
    const formed = formedHand(4, 4102);
    const t = buildHost(formed, [100, 100, 100, 100]);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    for (const stale of [uid(410299), 'old-hand', undefined])
      expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, stale)).toMatchObject({
        success: false,
        code: 'STALE_HAND',
      });
    const st = t.host.peekState()!;
    const first = st.players.find((p) => p.seat === st.currentPlayerSeat)!;
    expect(t.host.handlePlayerAction(first.user_id, 'raise', 6).success).toBe(true);
    await flush();
    expect(t.host.isWatching(bb)).toBe(true);
    expect(t.calls.fastFold).toEqual([]);
  });

  it('a player whose socket dropped after arming is still released on the bet, once', async () => {
    const formed = formedHand(4, 4103);
    const t = buildHost(formed, [100, 100, 100, 100]);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    t.host.notePresence(bb, false);
    const st = t.host.peekState()!;
    const first = st.players.find((p) => p.seat === st.currentPlayerSeat)!;
    expect(t.host.handlePlayerAction(first.user_id, 'raise', 6).success).toBe(true);
    expect(t.host.isWatching(bb)).toBe(false);
    // The socket coming back does not put them back into the hand they left.
    t.host.notePresence(bb, true);
    expect(t.host.isWatching(bb)).toBe(false);
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(
      false
    );
    await playOut(t.host, mulberry32(4103), (userId, legal) => {
      expect(userId).not.toBe(bb);
      return passive(userId, legal);
    });
    await flush();
    expect(t.calls.fastFold.filter((f) => f.playerId === bb)).toHaveLength(1);
    conserved(t, 40000);
  });

  it('a dropped socket keeps a free arm checking every street to showdown', async () => {
    const formed = formedHand(4, 4104);
    const t = buildHost(formed, [100, 100, 100, 100]);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    t.host.notePresence(bb, false);
    await playOut(t.host, mulberry32(4104), (userId, legal) => {
      expect(userId).not.toBe(bb);
      return passive(userId, legal);
    });
    await flush();
    expect(t.calls.settle[0].results.find((r) => r.playerId === bb)!.foldType).toBe('none');
    expect(t.calls.fastFold.filter((f) => f.playerId === bb)).toEqual([]);
    conserved(t, 40000);
  });

  it('one raise releases every armed player it prices, each once; the next actor folds on its turn', async () => {
    const formed = formedHand(6, 4105);
    const t = buildHost(formed, [100, 100, 100, 100, 100, 100]);
    await t.host.start();
    await flush();
    const st = t.host.peekState()!;
    const first = st.players.find((p) => p.seat === st.currentPlayerSeat)!;
    // Everyone but the raiser arms. Those already owing chips leave at once.
    const others = st.players.filter((p) => p.user_id !== first.user_id);
    for (const p of others)
      expect(
        t.host.setPreAction(p.user_id, 'auto_check_fold', undefined, formed.handId).success
      ).toBe(true);
    const free = others.filter((p) => t.host.isWatching(p.user_id));
    expect(free.map((p) => p.user_id)).toEqual([formed.bb]);
    expect(t.host.handlePlayerAction(first.user_id, 'raise', 6).success).toBe(true);
    await flush();
    // Nobody but the raiser is left to drive: every other fold happens on its own turn.
    await playOut(t.host, mulberry32(4105), (userId) => {
      expect(userId).toBe(first.user_id);
      return 'check';
    });
    await flush();
    for (const p of others) {
      expect(t.calls.fastFold.filter((f) => f.playerId === p.user_id)).toHaveLength(1);
      expect(t.released.filter((r) => r.playerId === p.user_id)).toHaveLength(1);
    }
    const s = t.calls.settle[0];
    expect(s.results.find((r) => r.playerId === first.user_id)!.won).toBeGreaterThan(0);
    for (const p of others) expect(s.results.find((r) => r.playerId === p.user_id)!.won).toBe(0);
    conserved(t, 60000);
  });

  it('an all-in that prices the arm releases it like any other bet', async () => {
    const formed = formedHand(4, 4106);
    const t = buildHost(formed, [100, 100, 100, 100]);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    const st = t.host.peekState()!;
    const first = st.players.find((p) => p.seat === st.currentPlayerSeat)!;
    expect(t.host.handlePlayerAction(first.user_id, 'all_in').success).toBe(true);
    expect(t.host.isWatching(bb)).toBe(false);
    await playOut(t.host, mulberry32(4106), (userId) => {
      expect(userId).not.toBe(bb);
      return 'fold';
    });
    await flush();
    expect(t.calls.fastFold.filter((f) => f.playerId === bb)).toHaveLength(1);
    conserved(t, 40000);
  });

  // Requests in any order, from any seat, at any moment of the hand.
  it('random arms, clears, repeats and stale arms never double-fold, strand a seat or lose a chip', async () => {
    // Counted so this can never pass by exercising nothing.
    let privateReleases = 0;
    let carriedChecks = 0;
    for (let seed = 5000; seed < 5040; seed++) {
      const seats = 3 + (seed % 4);
      const formed = formedHand(seats, seed);
      const t = buildHost(formed, Array(seats).fill(100));
      await t.host.start();
      await flush();
      const rnd = mulberry32(seed);
      const ids = t.host.peekState()!.players.map((p) => p.user_id);
      const poke = () => {
        const who = ids[Math.floor(rnd() * ids.length)];
        const roll = rnd();
        if (roll < 0.45) t.host.setPreAction(who, 'auto_check_fold', undefined, formed.handId);
        else if (roll < 0.6) t.host.setPreAction(who, 'clear');
        else if (roll < 0.7) t.host.setPreAction(who, 'auto_check_fold', undefined, uid(seed + 9));
        else if (roll < 0.8)
          t.host.handlePlayerAction(who, 'fast_fold', undefined, `lightning-hand:${formed.handId}`);
        else if (roll < 0.9) t.host.notePresence(who, rnd() < 0.5);
      };
      await playOut(t.host, rnd, (userId, legal) => {
        // A released player is never offered a decision again.
        expect(t.host.isWatching(userId), `seed ${seed}`).toBe(true);
        for (let i = 0; i < 3; i++) poke();
        const seen = t.host.peekState();
        for (const p of seen?.players ?? [])
          if (!p.is_folded && !t.host.isWatching(p.user_id)) privateReleases++;
        // The pokes may have folded or released this very seat.
        const now = t.host.peekState();
        if (!now || now.players.find((p) => p.user_id === userId)?.is_folded) return 'check';
        if (!t.host.isWatching(userId)) return 'check';
        const pick = rnd();
        if (pick < 0.2 && legal.includes('bet')) return 'bet';
        if (pick < 0.3 && legal.includes('raise')) return 'raise';
        return passive(userId, legal);
      });
      await flush();
      expect(t.calls.settle, `seed ${seed}`).toHaveLength(1);
      const s = t.calls.settle[0];
      carriedChecks += s.results.filter((r) => r.foldType === 'none').length;
      expect(
        cents(s.results.reduce((a, p) => a + p.stackAfter, 0) + s.rake + s.bbj),
        `seed ${seed}`
      ).toBe(seats * 10000);
      for (const id of ids) {
        expect(
          t.calls.fastFold.filter((f) => f.playerId === id).length,
          `seed ${seed} ${id}`
        ).toBeLessThanOrEqual(1);
        expect(
          t.released.filter((r) => r.playerId === id).length,
          `seed ${seed} ${id}`
        ).toBeLessThanOrEqual(1);
      }
    }
    expect(privateReleases).toBeGreaterThan(20);
    expect(carriedChecks).toBeGreaterThan(20);
  });
});
