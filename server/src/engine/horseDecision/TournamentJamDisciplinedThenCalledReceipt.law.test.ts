/**
 * LAW (2026-11-05): a tournament jam that the shove discipline turns into a
 * sized raise, and that hold'em rule 4 then turns into a call, is a valid
 * policy receipt.
 *
 * On release 71087373 the decision worker refused 41 no-limit hold'em
 * tournament decisions as "invalid policy receipt: policy_graph" and the
 * table fell back to a fold. Each one is the same chain inside the
 * `wager_rules` node: an owner proposed a preflop jam facing a 3-bet or more,
 * the tournament shove discipline (Dan 2026-10-25) rewrote it into a sized
 * (or covering) raise, and rule 4 (Dan 2026-10-31) made that raise a call.
 * The node records one transition, jam -> call, which the validator only
 * admitted from a fold or a raise.
 *
 * The fixture holds three of those real receipts exactly as the worker
 * journaled them (request player and game state plus the decision), with
 * every id replaced by a synthetic one. Each must now validate against its
 * own request, and each must still be refused when the request does not
 * support the admission (no request, a cash game, or a stack shallow enough
 * that the discipline keeps the jam).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { horseDecisionReceiptRefusal } from './responseValidation.js';
import type { SeatPlayer } from '../../types.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';

interface RealReceipt {
  sourceRelease: string;
  player: SeatPlayer;
  gameState: HorseGameStateV2;
  decision: Record<string, unknown>;
}

const receipts = JSON.parse(
  readFileSync(
    new URL('./fixtures/tournament-jam-disciplined-then-called.receipts.json', import.meta.url),
    'utf8'
  )
) as Record<string, RealReceipt>;

const wagerRules = (d: Record<string, unknown>) =>
  (
    d.policyGraph as {
      transitions: { node: string; before: { action: string } | null; after: { action: string } }[];
    }
  ).transitions.find((t) => t.node === 'wager_rules')!;

describe('a disciplined tournament jam that rule 4 calls is a valid receipt', () => {
  it.each(Object.keys(receipts))('real receipt %s validates against its own request', (key) => {
    const r = receipts[key];
    const t = wagerRules(r.decision);
    expect([t.before?.action, t.after.action]).toEqual(['all_in', 'call']);
    expect(r.decision.action).toBe('call');
    expect(
      horseDecisionReceiptRefusal(r.decision, r.gameState.gameVariant, {
        player: r.player,
        gameState: r.gameState,
      })
    ).toBeNull();
  });

  it.each(Object.keys(receipts))('receipt %s is still refused without its request', (key) => {
    const r = receipts[key];
    expect(horseDecisionReceiptRefusal(r.decision, r.gameState.gameVariant)).toBe('policy_graph');
  });

  it.each(Object.keys(receipts))(
    'receipt %s is refused when the game is not a tournament',
    (key) => {
      const r = receipts[key];
      const gameState = {
        ...r.gameState,
        gameMode: 'cash',
        tournament: undefined,
      } as HorseGameStateV2;
      expect(
        horseDecisionReceiptRefusal(r.decision, r.gameState.gameVariant, {
          player: r.player,
          gameState,
        })
      ).toBe('policy_graph');
    }
  );

  it('the jam -> call admission needs the discipline to rewrite the jam', () => {
    // A jam the discipline keeps (all-in-or-fold table) cannot become a call by rule 4.
    const r = receipts['00917ca7'];
    const gameState = { ...r.gameState, allInOrFold: true } as HorseGameStateV2;
    expect(
      horseDecisionReceiptRefusal(r.decision, r.gameState.gameVariant, {
        player: r.player,
        gameState,
      })
    ).toBe('policy_graph');
  });
});
