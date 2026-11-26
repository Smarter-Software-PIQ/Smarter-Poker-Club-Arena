import { describe, expect, it } from 'vitest';
import { loadPricedStates } from './HorseOmahaFacingBetPriced.test-support.js';
import { omahaMultiwayValueBetVerdict } from './HorseOmahaMultiwayValueBet.js';

/** The committed heads-up states made three-way (a copy of the live opponent at a free seat), nothing to call. */
function threeWay(limit: number) {
  return loadPricedStates()
    .map((s) => {
      const opp = (s.gs.players ?? []).find(
        (p) => p.seat !== s.player.seat && !p.is_folded && !p.is_all_in && !p.is_sitting_out
      );
      if (!opp) return null;
      const used = new Set((s.gs.players ?? []).map((p) => p.seat));
      let seat = 1;
      while (used.has(seat)) seat++;
      const players = [
        ...(s.gs.players ?? []),
        { ...opp, seat, user_id: `p${seat}`, username: `p${seat}` },
      ];
      const street = s.gs.stage;
      const others = players.filter((p) => p.seat !== s.player.seat && !p.is_folded);
      const history = (s.gs.actionHistory ?? []).filter((a) => a.stage !== street);
      return { s, players, street, others, history };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, limit);
}

describe('the priced multiway value bet (omahaMultiwayValueBetIsPriced, v2)', () => {
  it('prices only when every live opponent has checked this street, and bets only for value', () => {
    let bets = 0;
    for (const { s, players, street, others, history } of threeWay(60)) {
      const base = { ...s.gs, players, toCall: 0, currentBet: 0, legalActions: ['check', 'bet'] };
      const checks = others.map((p) => ({
        stage: street,
        seat: p.seat,
        action: 'check',
        amount: 0,
      }));
      const all = omahaMultiwayValueBetVerdict(
        s.player,
        { ...base, actionHistory: [...history, ...checks] } as never,
        0
      );
      // one opponent still to act: not priced, the check stands
      const oneBehind = omahaMultiwayValueBetVerdict(
        s.player,
        { ...base, actionHistory: [...history, ...checks.slice(1)] } as never,
        0
      );
      expect(oneBehind, s.k).toBeNull();
      // no action history: not priced
      expect(
        omahaMultiwayValueBetVerdict(s.player, { ...base, actionHistory: undefined } as never, 0),
        s.k
      ).toBeNull();
      if (all?.amount) {
        bets++;
        expect(all.valueShare ?? 0, s.k).toBeGreaterThan(0);
        expect(all.evBet, s.k).toBeGreaterThan(all.evCheck);
      }
    }
    expect(bets).toBeGreaterThan(0);
  }, 120_000);
});
