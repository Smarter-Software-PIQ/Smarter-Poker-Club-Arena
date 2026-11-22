/**
 * SIMULATED HANDS -> hand_history ROWS (benchmark-only; lane OPPONENT-HUD 2026-11-21, for SPARRING).
 *
 * The bench plays hands in memory. To test the opponent HUD with real lifetime profiles, OpponentHudAsOf needs the
 * same public rows production stores in hand_history. This converter writes exactly those public fields (id,
 * created_at, game_variant, big_blind, button_seat, players {seat, userId, stack}, actions, community_cards,
 * showdown {seat, user_id, mucked, hand_name, reveal_order}, winners {userId, amount}); it never takes or writes hole
 * cards. Amount convention (the engine's, as hand_history records it): blinds / antes / calls are increments; bet,
 * raise and all-in amounts are the actor's street total. A simulator that logs every amount as an increment says so
 * with `amounts: 'increments'` and the converter rebuilds the street totals.
 *
 * Ids are deterministic UUID-shaped digests of (namespace, seed, hand number) and of the simulated player name, so the
 * same seed always yields the same rows. No runtime source may import this file (law test
 * HudHistoryRowsIsBenchmarkOnly.law.test.ts).
 */
import { createHash } from 'node:crypto';

export type SimStage = 'preflop' | 'flop' | 'turn' | 'river';
export type SimAction =
  | 'sb'
  | 'bb'
  | 'ante'
  | 'straddle'
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'all_in';

export interface SimulatedHand {
  seed: string | number;
  handNo: number;
  startedAtMs: number;
  variant: 'plo4' | 'plo5' | 'nlh';
  bigBlind: number;
  buttonSeat: number;
  /** stacks at the start of the hand; `player` is the simulator's name or id for the seat's occupant */
  players: { seat: number; player: string; stack: number }[];
  actions: { seat: number; stage: SimStage; action: SimAction; amount?: number }[];
  board: string[];
  /** listed at showdown in reveal order; a mucked entry reveals nothing */
  showdown?: { seat: number; mucked: boolean; handName: string | null }[];
  winners: { seat: number; amount: number }[];
}

export interface HandHistoryRow {
  id: string;
  created_at: string;
  ended_at: string;
  game_variant: 'plo4' | 'plo5' | 'nlh';
  tournament_id: null;
  big_blind: number;
  button_seat: number;
  bomb_pot: null;
  players: { seat: number; userId: string; stack: number }[];
  actions: {
    seat: number;
    userId: string | null;
    stage: SimStage;
    action: SimAction;
    amount: number;
  }[];
  community_cards: string[];
  showdown: {
    seat: number;
    user_id: string;
    mucked: boolean;
    hand_name: string | null;
    reveal_order: number;
  }[];
  winners: { userId: string; amount: number }[];
}

function uuidOf(...parts: (string | number)[]): string {
  const h = createHash('sha256').update(parts.join('\u0000')).digest('hex');
  // UUID shape, version nibble 5, variant 8: deterministic and accepted by the HUD's row reader
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** The stable user id a simulated player gets in the rows. */
export function simUserId(player: string): string {
  return uuidOf('sparring-player', player);
}
/** The stable hand id of (seed, hand number). */
export function simHandId(seed: string | number, handNo: number): string {
  return uuidOf('sparring-hand', seed, handNo);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function simulatedHandToHistoryRow(
  hand: SimulatedHand,
  opts: { amounts?: 'engine' | 'increments'; ids?: 'hash' | 'keep' } = {}
): HandHistoryRow {
  // ids 'keep': the simulator's own player ids are the user ids (the bench reads its Horses by those ids)
  const uid = (player: string) => (opts.ids === 'keep' ? player : simUserId(player));
  const bySeat = new Map(hand.players.map((p) => [p.seat, uid(p.player)]));
  const committed = new Map<number, number>();
  let stage: SimStage = 'preflop';
  const actions = hand.actions.map((a) => {
    if (a.stage !== stage) {
      stage = a.stage;
      committed.clear();
    }
    let amount = Math.max(0, a.amount ?? 0);
    const before = committed.get(a.seat) ?? 0;
    if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
      if (opts.amounts === 'increments') amount = before + amount; // to the street total
      committed.set(a.seat, amount);
    } else if (
      a.action === 'call' ||
      a.action === 'sb' ||
      a.action === 'bb' ||
      a.action === 'straddle'
    ) {
      committed.set(a.seat, before + amount);
    } else if (a.action === 'fold' || a.action === 'check') amount = 0;
    return {
      seat: a.seat,
      userId: bySeat.get(a.seat) ?? null,
      stage: a.stage,
      action: a.action,
      amount: round2(amount),
    };
  });
  const at = new Date(hand.startedAtMs).toISOString();
  return {
    id: simHandId(hand.seed, hand.handNo),
    created_at: at,
    ended_at: at,
    game_variant: hand.variant,
    tournament_id: null,
    big_blind: hand.bigBlind,
    button_seat: hand.buttonSeat,
    bomb_pot: null,
    players: hand.players.map((p) => ({
      seat: p.seat,
      userId: uid(p.player),
      stack: p.stack,
    })),
    actions,
    community_cards: [...hand.board],
    showdown: (hand.showdown ?? [])
      .filter((s) => bySeat.has(s.seat))
      .map((s, i) => ({
        seat: s.seat,
        user_id: bySeat.get(s.seat)!,
        mucked: s.mucked,
        hand_name: s.mucked ? null : s.handName,
        reveal_order: i,
      })),
    winners: hand.winners
      .filter((w) => bySeat.has(w.seat) && w.amount > 0)
      .map((w) => ({ userId: bySeat.get(w.seat)!, amount: round2(w.amount) })),
  };
}

/** A whole simulated session, oldest first (OpponentHudAsOf accepts any order). */
export function simulatedHandsToHistoryRows(
  hands: Iterable<SimulatedHand>,
  opts: { amounts?: 'engine' | 'increments'; ids?: 'hash' | 'keep' } = {}
): HandHistoryRow[] {
  return [...hands].map((h) => simulatedHandToHistoryRow(h, opts));
}
