import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { variantInfo, omahaBoatPosition, scoreOmahaHi } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';

function checkedToOmahaValueStreet(player: SeatPlayer, gs: HorseGameStateV2): boolean {
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
    !gs.actionHistory?.some(
      (a) => a.stage === gs.stage && a.action === 'check' && a.userId !== player.user_id
    )
  )
    return false;
  return true;
}

/** Reachable lower boats establish rank position. Bottom and singleton ranks have no reachable lower boat. */
export function checkedToNonBottomBoat(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  return (
    checkedToOmahaValueStreet(player, gs) &&
    (omahaBoatPosition(player.cards, gs.communityCards)?.lowerBoats ?? 0) > 0
  );
}

/** On an unpaired river a flush can lose only to a better flush or straight flush.
 * Both require two cards of the board's flush suit. Count distinct unseen pairs;
 * the exact nuts already have their own pot-size rule. */
export function checkedToOnePairAboveFlush(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  if (
    gs.stage !== 'river' ||
    !checkedToOmahaValueStreet(player, gs) ||
    gs.bettingStructure !== 'pot_limit' ||
    !!player.knownDeadCards?.length ||
    !gs.legalActions?.includes('check') ||
    player.is_folded ||
    player.is_all_in ||
    player.is_sitting_out ||
    !Number.isFinite(player.stack) ||
    player.stack <= 0 ||
    player.bet !== 0
  )
    return false;
  const board = gs.communityCards;
  if (
    new Set(board.map((c) => c.rank)).size !== 5 ||
    gs.actionHistory?.some((a) => a.stage === 'river' && a.action !== 'check') ||
    !gs.actionHistory?.some(
      (a) =>
        a.stage === 'river' &&
        a.action === 'check' &&
        a.seat !== player.seat &&
        gs.players.some((p) => p.seat === a.seat && p.user_id === a.userId)
    )
  )
    return false;
  const known = [...board, ...player.cards];
  if (known.some((c) => !RANKS.includes(c.rank) || !SUITS.includes(c.suit))) return false;
  const suit = SUITS.find((s) => board.filter((c) => c.suit === s).length >= 3);
  if (!suit || player.cards.filter((c) => c.suit === suit).length < 2) return false;
  const heroHigh = scoreOmahaHi(player.cards, board);
  if (Math.floor(heroHigh / 0x100000) !== 6) return false;
  const removed = new Set(known.filter((c) => c.suit === suit).map((c) => c.rank));
  const live = RANKS.filter((rank) => !removed.has(rank)).map((rank) => ({ rank, suit }));
  let higherPairs = 0;
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (scoreOmahaHi([live[i], live[j]], board) > heroHigh && ++higherPairs > 1) return false;
    }
  }
  return higherPairs === 1;
}

/** River-only identity for the initiative gate and original river inspector. */
export function checkedToNonBottomRiverBoat(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  return gs.stage === 'river' && checkedToNonBottomBoat(player, gs);
}
