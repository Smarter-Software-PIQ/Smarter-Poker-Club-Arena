/**
 * LAW (2026-11-19): A LIGHTNING FAST FOLD KEEPS THE HORSE'S OWN CARDS.
 *
 * The 48-hour audits could not price a single Lightning fast-fold Horse
 * decision with cards: ca_hand_facts keeps a row's cards only when it put
 * chips in, and nothing else held them. The accepted Lightning stats payload
 * now carries every Horse's dealt cards (stats_facts.horse_hole_cards),
 * including a Horse that folded for free, and never a human's
 * (migration 20261120014240, handFacts.horseDealtHoleCards).
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the Lightning law fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the Lightning law fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), describeError: String }));
vi.mock('../services/HorseDailyRollupContract.js', () => ({
  horseDailyRollupContract: vi.fn(async () => true),
}));
// the installed retention basis accepts the key (migration 20261120025753; HorseStatsBasisContract)
vi.mock('../services/HorseStatsBasisContract.js', () => ({
  horseHoleCardsBasisContract: vi.fn(async () => true),
}));
const { mulberry32 } = await import('../engine/HandFuzzer.js');
const kit = await import('../testing/lightningHostTestKit.js');
const { dealtCardCode } = await import('../services/supabase/handFacts.js');

const CLUB = '00000000-0000-4000-8000-0000000c1ab0';
type Stats = {
  facts: Array<{ user_id: string; invested: number; hole_cards: unknown }>;
  horse_hole_cards?: Array<{ user_id: string; seat: number; cards: string[] }>;
};

describe("LAW: a Lightning fast fold keeps the Horse's own cards", () => {
  for (const base of [13_100, 13_200, 13_300, 13_400]) {
    it(`keeps every Horse's dealt cards and no human's (seed ${base})`, async () => {
      const formed = kit.formedHand(4, base);
      const human = formed.players[3]!;
      const horses = new Set(formed.players.slice(0, 3));
      const t = kit.buildHost(formed, [100, 100, 100, 100], { horses, rules: { club_id: CLUB } });
      await t.host.start();
      const dealt = new Map(
        [
          ...(t.host as unknown as { holeCards: Map<string, { seat: number; cards: unknown[] }> })
            .holeCards,
        ].map(([u, h]) => [u, { seat: h.seat, cards: h.cards.map(dealtCardCode) }])
      );
      expect(dealt.size).toBe(4);
      // The first player to act folds for free when it is a Horse.
      const st = t.host.peekState()!;
      const first = st.players.find((p) => p.seat === st.currentPlayerSeat)!;
      const freeFold = horses.has(first.user_id) && first.bet === 0;
      if (freeFold) expect(t.host.handlePlayerAction(first.user_id, 'fold').success).toBe(true);
      await kit.flush();
      await kit.playOut(t.host, mulberry32(base));
      await kit.flush(40);

      const stats = (
        t.calls.settle[0]!.handRow._accepted_post_commit_facts as { stats_facts: Stats }
      ).stats_facts;
      const expected = [...horses]
        .map((u) => ({ user_id: u, seat: dealt.get(u)!.seat, cards: dealt.get(u)!.cards }))
        .sort((a, b) => a.seat - b.seat);
      expect(stats.horse_hole_cards).toEqual(expected);
      expect(stats.horse_hole_cards!.some((e) => e.user_id === human)).toBe(false);
      expect(JSON.stringify(stats.horse_hole_cards)).not.toContain(human);
      for (const e of stats.horse_hole_cards!)
        for (const c of e.cards) expect(c).toMatch(/^[2-9TJQKA][shdc]$/);
      if (freeFold) {
        const row = stats.facts.find((f) => f.user_id === first.user_id)!;
        // The fact row keeps no cards for a free fold; the Horse list does.
        expect(row.invested).toBe(0);
        expect(row.hole_cards).toBeNull();
        expect(stats.horse_hole_cards!.find((e) => e.user_id === first.user_id)).toBeDefined();
      }
    });
  }

  it('carries no list at all when no Horse was dealt in', async () => {
    const formed = kit.formedHand(2, 13_900);
    const t = kit.buildHost(formed, [100, 200], { rules: { club_id: CLUB } });
    await t.host.start();
    await kit.playOut(t.host, mulberry32(13_900));
    await kit.flush(40);
    const stats = (t.calls.settle[0]!.handRow._accepted_post_commit_facts as { stats_facts: Stats })
      .stats_facts;
    expect(stats).not.toHaveProperty('horse_hole_cards');
  });
});
