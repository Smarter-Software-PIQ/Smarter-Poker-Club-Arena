/**
 * LIGHTNING EARLY FOLD NEEDS THE FOLD-THROUGH (2026-11-15, beyond ledger L-017; DEFAULT OFF,
 * HorseDecideOpts.lightningEarlyFoldNeedsFoldThrough, read in HorseLogic.decide).
 *
 * A Lightning Horse is asked an EARLY LOOK off its turn (LightningHandHost.offerHorseEarlyLooks),
 * priced on the table as it stands while seats before it on the street still have to act, and a
 * fold there is FINAL (the Lightning Fold door releases the seat). The probe (PROBE-BEYOND-BB.md,
 * development seeds, all-Horse tables) measured the same policy, asked on the real turn, continuing
 * where that fold had been final: small blind 2.9 / 10.3 / 8.3 VPIP points (NLH / PLO4 / PLO5),
 * button 0.7 / 2.2 / 1.8, flop and turn 0.5 to 2 continuation points. The small blind folded to
 * continued in about 30% of those folds.
 *
 * "Already folding" means folding in every spot the Horse can still reach. The spot it is most
 * often still in is the one where every live seat before it folds (preflop: first in, or blind
 * against blind; flop and turn: the seats between the bettor and the Horse fold). With the option
 * on, an answer of fold to a priced Lightning decision that still has such seats before it is
 * checked once more on that FOLD-THROUGH frame; the fold stands only if the frame folds too.
 * Otherwise the frame's answer is returned, which the host treats exactly as an early look that
 * did not fold: it is dropped and the Horse decides afresh on its own turn.
 *
 * At the Horse's real turn no seat before it is still to act, so the option changes nothing there.
 * The river, non-Lightning hands (speed not 'lightning') and tournaments are outside it. The frame
 * is built from the public snapshot only (it already holds no other seat's cards and no card not
 * yet dealt): the seats are marked folded, their folds are added to the street's history, and they
 * leave every pot's eligible list; their chips stay in the pot and the Horse's price and menu do
 * not change. The frame is never shown to the opponent model (HorseLogic asks it with
 * observeMind false, so its hypothetical folds are not learned).
 */
import type { HorseGameStateV2 } from './HorseLogic.js';

const BETTING = new Set(['preflop', 'flop', 'turn']);

interface PublicAction {
  seat: number;
  userId: string;
  action: string;
  stage: string;
  origin?: string;
  isFullRaise?: boolean;
}

const isAggression = (a: PublicAction): boolean =>
  a.origin !== 'forced' &&
  (a.action === 'raise' || a.action === 'bet' || (a.action === 'all_in' && a.isFullRaise === true));

/**
 * The live, not-all-in seats that still act before the hero on this street, from public state:
 * the seats after the street's last full aggression (preflop with none: after the big blind), up
 * to the hero, that have not acted since it. Empty unless this is a Lightning cash decision before
 * the river where the hero owes chips with no free check. At the hero's own turn it is empty.
 */
export function lightningFoldThroughSeats(gs: HorseGameStateV2, heroSeat: number): number[] {
  const g = gs as unknown as {
    publicMemoryDomain?: { speed?: unknown } | null;
    gameMode?: string;
    stage: string;
    toCall: number;
    legalActions?: readonly string[];
    players: Array<{ seat: number; is_folded?: boolean; is_all_in?: boolean }>;
    actionHistory?: PublicAction[];
    blindSeats?: { bigBlind: number } | null;
  };
  if (g.publicMemoryDomain?.speed !== 'lightning' || g.gameMode !== 'cash') return [];
  if (!BETTING.has(g.stage) || !(Number(g.toCall) > 0.005)) return [];
  if (g.legalActions?.includes('check')) return [];
  const street = (g.actionHistory ?? []).filter((a) => a.stage === g.stage);
  let last = -1;
  street.forEach((a, i) => {
    if (isAggression(a)) last = i;
  });
  let from: number | null = last >= 0 ? street[last]!.seat : null;
  if (from === null && g.stage === 'preflop') from = g.blindSeats?.bigBlind ?? null;
  if (from === null) return [];
  const acted = new Set(
    street
      .slice(last + 1)
      .filter((a) => a.origin !== 'forced')
      .map((a) => a.seat)
  );
  const seats = g.players.map((p) => p.seat).sort((a, b) => a - b);
  let i = seats.indexOf(from);
  if (i < 0 || !seats.includes(heroSeat)) return [];
  const out: number[] = [];
  for (let k = 0; k < seats.length; k++) {
    i = (i + 1) % seats.length;
    const seat = seats[i]!;
    if (seat === heroSeat) break;
    const p = g.players.find((o) => o.seat === seat);
    if (p && !p.is_folded && !p.is_all_in && !acted.has(seat)) out.push(seat);
  }
  return out;
}

/**
 * The fold-through frame: a NEW public state in which `seats` have folded (the input is not
 * changed). Null when a named seat is not a live, not-all-in opponent, or a pot would be left
 * with no eligible player (the caller then keeps the answer it had).
 */
export function lightningFoldThroughFrame(
  gs: HorseGameStateV2,
  seats: readonly number[],
  at: number
): HorseGameStateV2 | null {
  const g = gs as unknown as {
    heroSeat?: number;
    stage: string;
    players: Array<{ seat: number; user_id: string; is_folded?: boolean; is_all_in?: boolean }>;
    pots?: Array<{ eligiblePlayers: string[] }>;
    actionHistory?: Array<Record<string, unknown>>;
  };
  const folding = new Map<number, string>();
  for (const seat of seats) {
    const p = g.players.find((o) => o.seat === seat);
    if (!p || seat === g.heroSeat || p.is_folded || p.is_all_in) return null;
    folding.set(seat, p.user_id);
  }
  const ids = new Set(folding.values());
  const pots = (g.pots ?? []).map((pot) => ({
    ...pot,
    eligiblePlayers: pot.eligiblePlayers.filter((id) => !ids.has(id)),
  }));
  if (pots.some((pot) => pot.eligiblePlayers.length === 0)) return null;
  return {
    ...(gs as object),
    players: g.players.map((p) => (folding.has(p.seat) ? { ...p, is_folded: true } : p)),
    ...(g.pots ? { pots } : {}),
    actionHistory: [
      ...(g.actionHistory ?? []),
      ...seats.map((seat) => ({
        seat,
        userId: folding.get(seat)!,
        action: 'fold',
        amount: 0,
        timestamp: at,
        stage: g.stage,
        origin: 'player',
      })),
    ],
  } as unknown as HorseGameStateV2;
}

/** The strength-gated Lightning entries (HorseLightningCheapEntry): their own default-off option, with
 *  their own price bar; a frame answer they carry is a priced continuation, not the blind-vs-blind mix. */
const PRICED_ENTRY_BRANCHES = new Set([
  'lightning_cheap_entry_sb_complete',
  'lightning_cheap_entry_over_limp',
]);

/**
 * NO RELEASE FOR AN UNRAISED LIMP (2026-11-21). True when the frame's answer is a preflop call into a
 * street with no voluntary aggression (a first-in limp or a small-blind complete), unless the answer
 * carries a strength-gated Lightning entry branch on its preflop authority trail.
 *
 * Why (authority file, "Why those limps and weaker entries occur in NLH", item 1): the frame folds the
 * seats before an unopened small blind, so the small blind reads blind-vs-blind (`bvb`, oppsLeft 1) and
 * HorsePreflop's 75% complete mix runs down to `sbLimpFloor` (0.22 base). On the declared NLH half
 * (2026-11-21) that release raised VPIP by 0.97 points with only 45.1% of it the intended kind and the
 * bottom-quartile share of entries from 10.18% to 11.26%. The early look exists so a Horse does not
 * press a fold its real turn would not make for strength reasons ("HORSES SHOULD FOLD RIGHT AWAY IF THEY
 * WERE ALREADY FOLDING", 2026-10-24); a mixed complete at the bottom of the range is the entry the
 * standing Lightning rule forbids as a way to meet the VPIP floor, so it does not undo the early fold.
 *
 * Chosen over rewriting the frame's blind-vs-blind state: the real table CAN fold to the small blind, so
 * the frame's bvb is a reachable spot, not an invented one; what is wrong is releasing for the mix.
 * Raises, calls facing a raise, all-in calls and every postflop answer are unchanged.
 */
export function lightningFoldThroughFrameIsUnraisedLimp(
  gs: HorseGameStateV2,
  through: { action: unknown; preflopAuthority?: { events?: readonly { branch: string }[] } }
): boolean {
  const g = gs as unknown as { stage: string; actionHistory?: PublicAction[] };
  if (g.stage !== 'preflop' || String(through.action) !== 'call') return false;
  if ((g.actionHistory ?? []).some((a) => a.stage === 'preflop' && isAggression(a))) return false;
  const events = through.preflopAuthority?.events ?? [];
  return !events.some((e) => PRICED_ENTRY_BRANCHES.has(e.branch));
}
