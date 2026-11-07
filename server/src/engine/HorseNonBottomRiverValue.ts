import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { variantInfo, omahaBoatPosition } from './HorseEval.js';

/** Original unpriced value node on a single high-only Omaha board.
 * Reachable lower boats establish rank position, not opponent calling range EV.
 * Singleton ranks and trip boards do not qualify. */
export function checkedToNonBottomBoat(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  const board = gs.communityCards ?? [];
  const vi = variantInfo(gs.gameVariant);
  if (
    (gs.stage !== 'turn' && gs.stage !== 'river') ||
    !vi.isOmaha ||
    !vi.isPotLimit ||
    vi.isHiLo ||
    !['plo4', 'plo5', 'plo6'].includes(gs.gameVariant ?? '') ||
    gs.variantRules?.splitLow8OrBetter ||
    (gs.bettingStructure !== undefined && gs.bettingStructure !== 'pot_limit') ||
    gs.bombPot ||
    gs.allInOrFold ||
    (gs.boardCount ?? 1) !== 1 ||
    gs.communityCards2?.length ||
    gs.communityCards3?.length ||
    board.length !== (gs.stage === 'turn' ? 4 : 5) ||
    player.cards?.length !== Number(gs.gameVariant?.at(-1)) ||
    new Set([...player.cards, ...board].map((c) => `${c.rank}:${c.suit}`)).size !==
      player.cards.length + board.length ||
    (gs.toCall !== undefined && gs.toCall !== 0) ||
    gs.currentBet !== 0 ||
    Math.max(0, gs.currentBet - player.bet) !== 0 ||
    !gs.legalActions?.includes('bet') ||
    board.some((card) => board.filter((other) => other.rank === card.rank).length >= 3) ||
    !gs.actionHistory?.some(
      (a) => a.stage === gs.stage && a.action === 'check' && a.userId !== player.user_id
    )
  )
    return false;
  return (omahaBoatPosition(player.cards, board)?.lowerBoats ?? 0) > 0;
}

/** River-only identity for the initiative gate and original river inspector. */
export function checkedToNonBottomRiverBoat(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  return gs.stage === 'river' && checkedToNonBottomBoat(player, gs);
}
