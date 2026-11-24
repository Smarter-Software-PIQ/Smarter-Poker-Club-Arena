/**
 * LAW (owner rule 8; PLO-OWNER lead-6 2026-11-24): the corrected PLO4/PLO5 facing-bet price and the priced multiway
 * value bet never key on whether an opponent is a person or a Horse, on a user id or a name, and read no unshown
 * card. (1) Their source reads none of those inputs. (2) The same spot with the bettor marked a person, a Horse,
 * listed or not in humanUserIds, renamed and re-keyed, prices the same.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPricedStates, pricedOutcome } from './HorseOmahaFacingBetPriced.test-support.js';
import { omahaMultiwayValueBetVerdict } from './HorseOmahaMultiwayValueBet.js';

const FILES = [
  'HorseOmahaMeasuredBettorRange.ts',
  'HorseOmahaFacingBetPriced.ts',
  'HorseOmahaPricedJointSample.ts',
  'HorseOmahaFlopCallTree.ts',
  'HorseOmahaFastScore.ts',
  'HorseOmahaMultiwayValueBet.ts',
];

describe('the corrected facing-bet price never keys on person vs Horse', () => {
  it('reads no identity input and no other player cards', () => {
    for (const f of FILES) {
      const src = readFileSync(join(__dirname, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const banned of [
        'omahaOpponentKindOf',
        'is_horse',
        'humanUserIds',
        'username',
        'omahaPricedKindPrior',
        'omahaFlopDefenceTreeInputs',
        'OMAHA_FLOP_DEFENCE_FOLD_TO_RAISE_PRIOR',
        'hole_cards',
        'shownHoleCards',
      ])
        expect(src.includes(banned), `${f} reads ${banned}`).toBe(false);
      // other players' cards: only the Horse's own (player.cards) and the known dead cards are read
      expect(/\.players[\s\S]{0,80}\.cards/.test(src), `${f} reads another seat's cards`).toBe(
        false
      );
    }
  });

  it('the same spot prices the same whatever the bettor is marked as', () => {
    const states = loadPricedStates().filter((_, i) => i % 9 === 0);
    let n = 0;
    for (const s of states) {
      const base = pricedOutcome(s, 'on');
      if (!base) continue;
      for (const horse of [true, false]) {
        const gs = {
          ...s.gs,
          humanUserIds: horse
            ? []
            : (s.gs.players ?? []).filter((p) => p.seat !== s.player.seat).map((p) => p.user_id),
          players: (s.gs.players ?? []).map((p) =>
            p.seat === s.player.seat
              ? p
              : { ...p, is_horse: horse, user_id: `x-${horse}-${p.seat}`, username: `n${p.seat}` }
          ),
        };
        expect(pricedOutcome({ ...s, gs }, 'on')?.call, s.k).toBe(base.call);
      }
      n++;
    }
    expect(n).toBeGreaterThan(50);
  }, 300_000);

  it('the multiway value bet prices the same whatever the field is marked as', () => {
    // the committed states are heads-up: a second live opponent (a copy of the first at a free seat) makes each
    // one a three-way spot the option prices
    const states = loadPricedStates()
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
        return { ...s, gs: { ...s.gs, players } };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .slice(0, 40);
    let priced = 0;
    let bets = 0;
    for (const s of states) {
      // every other seat in the hand has checked this street (the spot the option prices)
      const street = s.gs.stage;
      const checks = (s.gs.players ?? [])
        .filter((p) => p.seat !== s.player.seat && !p.is_folded)
        .map((p) => ({
          stage: street,
          seat: p.seat,
          userId: p.user_id,
          action: 'check',
          amount: 0,
        }));
      const history = [...(s.gs.actionHistory ?? []).filter((a) => a.stage !== street), ...checks];
      const gs = {
        ...s.gs,
        toCall: 0,
        currentBet: 0,
        legalActions: ['check', 'bet'],
        actionHistory: history,
      };
      const a = omahaMultiwayValueBetVerdict(s.player, gs as never, 0);
      if (a) priced++;
      if (a?.amount) bets++;
      const flipped = {
        ...gs,
        players: (gs.players ?? []).map((p) =>
          p.seat === s.player.seat ? p : { ...p, is_horse: !p.is_horse }
        ),
      };
      const b = omahaMultiwayValueBetVerdict(s.player, flipped as never, 0);
      expect(b?.amount ?? null, s.k).toBe(a?.amount ?? null);
    }
    expect(priced).toBeGreaterThan(0);
    expect(bets).toBeGreaterThan(0);
  }, 120_000);
});
