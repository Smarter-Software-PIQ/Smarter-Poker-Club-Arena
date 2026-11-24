/**
 * THE HORSE'S OWN PREFLOP RANGE, FROM ITS OWN PREFLOP POLICY (holdemLateStreetIsPriced / holdemFlopIsPriced only;
 * BUILD-II round 5 step 1).
 *
 * The priced flop/turn/river chooser defends "the strongest (1 - break-even) of my range" and plans its bets over
 * the Horse's own range. Until this file that range started from the band its OPPONENTS read for it
 * (HorseMind.bandFor), and 37-40% of the hands the Horse really held postflop lay outside that band: the band is an
 * estimate of a generic player, not this Horse's policy. Here the start of the range is the Horse's REAL preflop
 * policy: every one of the 169 hand classes is put through the same HorseLogic.decide call that made the Horse's
 * preflop decisions, on each preflop frame the Horse acted on (the history, stacks, blinds and pot as they stood),
 * with the Horse's own style, persona mods and options; a class's weight is the share of a fixed set of policy
 * draws on which the policy takes the action the Horse took at every one of those frames.
 *
 * - No preflop play changes: the asks are throwaway decisions (RNG saved and restored, telemetry suspended, deep-dive
 *   capture detached, style records kept, HorseMind intent writes discarded, never observed).
 * - Deterministic: the policy draws use fixed seeds (HOLDEM_OWN_PREFLOP_SEEDS); the same frame gives the same weights.
 * - Identity-free: nothing reads whether any seat is a person or a Horse; the other seats' hole cards are removed
 *   from the frames (never read).
 * - The Horse's own class always keeps at least one draw's weight: the Horse holds it, so its range holds it.
 * - Anything the frame cannot rebuild (straddles, bomb pots, posting histories it cannot read) returns null and the
 *   chooser keeps the band, as before.
 * Primed at the top of HorseLogic.decide (holdemOwnPreflopPrime) and read by the chooser's range builder
 * (holdemOwnPreflopPrior). The policy is keyed as the owner defined it, by position, preflop action line and stack
 * depth (with style, persona mods and option rows): one computation serves every later hand on that line
 * (CACHE_MAX keys, least recently used dropped). It does not re-read the opponents' memory per hand: the reads in
 * force when the line was first computed stand for it (a documented approximation).
 */
import type { Card, CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from './HorseEval.js';

/** The policy draws per class and frame (fixed seeds mixed with the class: the weights are a deterministic function
 * of the frame; each class reads its own streams). */
export const HOLDEM_OWN_PREFLOP_SEEDS: readonly number[] = [
  0x5eed0001, 0x5eed0b07, 0x5eed1d2f, 0x5eed3a51,
];

const RANKS: readonly CardRank[] = [
  'A',
  'K',
  'Q',
  'J',
  'T',
  '9',
  '8',
  '7',
  '6',
  '5',
  '4',
  '3',
  '2',
];

/** The 169 classes: [hi, lo, suited]; representatives use spades (and hearts for the second card when offsuit). */
const CLASSES: ReadonlyArray<readonly [number, number, boolean]> = (() => {
  const out: Array<readonly [number, number, boolean]> = [];
  for (let i = 0; i < 13; i++)
    for (let j = i; j < 13; j++) {
      if (i === j) out.push([i, j, false]);
      else {
        out.push([i, j, true]);
        out.push([i, j, false]);
      }
    }
  return out;
})();

/** The class index (0..168) of two cards, or -1. */
export function holdemPreflopClassOf(a: Card, b: Card): number {
  const ra = RANKS.indexOf(a.rank);
  const rb = RANKS.indexOf(b.rank);
  if (ra < 0 || rb < 0) return -1;
  const hi = Math.min(ra, rb);
  const lo = Math.max(ra, rb);
  const suited = hi !== lo && a.suit === b.suit;
  return CLASSES.findIndex((c) => c[0] === hi && c[1] === lo && c[2] === suited);
}

function representative(k: number): Card[] {
  const [hi, lo, suited] = CLASSES[k]!;
  const s1: CardSuit = 'spades';
  const s2: CardSuit = suited ? 'spades' : 'hearts';
  return [
    { rank: RANKS[hi]!, suit: s1 },
    { rank: RANKS[lo]!, suit: s2 },
  ];
}

type Want = 'check' | 'call' | 'raise';

export interface HoldemOwnPreflopFrame {
  player: SeatPlayer;
  gs: HorseGameStateV2;
  want: Want;
}

const VOLUNTARY = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);
const POSTING = new Set(['sb', 'bb', 'blind', 'ante', 'straddle', 'post', 'kill_blind']);
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const same = (
  x: { userId?: string; seat?: number },
  p: { user_id: string; seat: number }
): boolean => (x.userId !== undefined ? x.userId === p.user_id : x.seat === p.seat);

/**
 * The preflop frames the Horse acted on, rebuilt from the public record: every seat's stack and bet as they stood
 * (start stack = stack + chips invested this hand), the pot, the price, the legal menu, the history before the action.
 * Null when the hand cannot be rebuilt honestly.
 */
export function holdemOwnPreflopFrames(
  player: SeatPlayer,
  gs: HorseGameStateV2
): HoldemOwnPreflopFrame[] | null {
  if (gs.bombPot || gs.straddleActive || gs.allInOrFold) return null;
  const hist = (gs.actionHistory ?? []).filter((a) => (a.stage ?? 'preflop') === 'preflop');
  const players = gs.players ?? [];
  if (players.length < 2) return null;
  const bb = num(gs.bigBlind);
  const sbAmt = num(gs.smallBlind);
  if (!(bb > 0)) return null;
  const explicitPosts = hist.some((a) => POSTING.has(String(a.action)));
  const blindSeats = (gs as { blindSeats?: { smallBlind?: number; bigBlind?: number } }).blindSeats;
  if (!explicitPosts && (!blindSeats || blindSeats.bigBlind === undefined)) return null;
  // dead money each seat put in before the betting (antes, dead blinds)
  const deadOf = (p: SeatPlayer) =>
    num((p as { individualAnteInvested?: number }).individualAnteInvested) +
    num((p as { deadInvested?: number }).deadInvested);
  const startOf = (p: SeatPlayer) =>
    num(p.stack) + num((p as { totalInvested?: number }).totalInvested);
  const committed = new Map<number, number>();
  for (const p of players) committed.set(p.seat, 0);
  if (!explicitPosts) {
    if (blindSeats!.smallBlind !== undefined)
      committed.set(
        blindSeats!.smallBlind,
        Math.min(sbAmt, startOf(players.find((p) => p.seat === blindSeats!.smallBlind) ?? player))
      );
    committed.set(
      blindSeats!.bigBlind!,
      Math.min(bb, startOf(players.find((p) => p.seat === blindSeats!.bigBlind) ?? player))
    );
  }
  let currentBet = Math.max(...committed.values());
  let lastRaise = bb;
  const folded = new Set<number>();
  const frames: HoldemOwnPreflopFrame[] = [];
  for (let j = 0; j < hist.length; j++) {
    const x = hist[j]!;
    const seat = players.find((p) => same(x, p))?.seat;
    if (seat === undefined) return null;
    const prev = committed.get(seat) ?? 0;
    const amt = Math.max(0, num(x.amount));
    const act = String(x.action);
    if (same(x, player) && VOLUNTARY.has(act)) {
      if (act === 'fold') return null;
      const pot0 = players.reduce((s, p) => s + deadOf(p) + (committed.get(p.seat) ?? 0), 0);
      const seats = players.map((p) => {
        const c = committed.get(p.seat) ?? 0;
        const stack = Math.max(0, startOf(p) - deadOf(p) - c);
        return {
          ...p,
          cards: p.seat === player.seat ? p.cards : [],
          bet: c,
          stack,
          totalInvested: deadOf(p) + c,
          is_folded: folded.has(p.seat),
          is_all_in: stack <= 0 && c > 0,
        } as SeatPlayer;
      });
      const me = seats.find((p) => p.seat === player.seat)!;
      const toCall = Math.max(0, currentBet - me.bet);
      // the engine's own menu: fold is always offered (also with a free check)
      const legal: string[] = ['fold'];
      if (toCall <= 0) legal.push('check');
      if (toCall > 0 && me.stack > toCall) legal.push('call');
      const stackTo = me.bet + me.stack;
      const minTo = currentBet > 0 ? currentBet + Math.max(bb, lastRaise) : bb;
      const canWager = stackTo > currentBet && stackTo >= minTo;
      if (canWager) legal.push(currentBet > 0 ? 'raise' : 'bet');
      if (me.stack > 0) legal.push('all_in');
      const total = act === 'raise' || act === 'all_in' ? Math.max(prev, amt) : prev + amt;
      const want: Want =
        act === 'check' ? 'check' : act === 'call' || total <= currentBet + 1e-9 ? 'call' : 'raise';
      const frameGs = {
        ...gs,
        stage: 'preflop',
        communityCards: [],
        communityCards2: undefined,
        communityCards3: undefined,
        players: seats,
        pot: pot0,
        pots: undefined,
        contestablePot: undefined,
        currentBet,
        toCall,
        lastRaise,
        minRaise: lastRaise,
        legalActions: legal,
        minRaiseTo: canWager ? minTo : null,
        maxRaiseTo: canWager ? stackTo : null,
        currentPlayerSeat: player.seat,
        heroSeat: player.seat,
        actionHistory: (gs.actionHistory ?? [])
          .filter((a) => (a.stage ?? 'preflop') === 'preflop')
          .slice(0, j),
      } as unknown as HorseGameStateV2;
      frames.push({ player: me, gs: frameGs, want });
    }
    // apply the action
    if (act === 'fold') {
      folded.add(seat);
      continue;
    }
    const total = act === 'raise' || act === 'all_in' ? Math.max(prev, amt) : prev + amt;
    if (total > currentBet + 1e-9) {
      const inc = total - currentBet;
      if (inc >= lastRaise - 1e-9) lastRaise = inc;
      currentBet = total;
    }
    committed.set(seat, total);
  }
  return frames.length > 0 ? frames : null;
}

function actionKind(d: HorseDecision, currentBet: number): Want | 'fold' {
  const a = String(d.action);
  if (a === 'check') return 'check';
  if (a === 'call') return 'call';
  if (a === 'fold') return 'fold';
  if (a === 'all_in')
    return num(d.amount) > currentBet + 1e-9 || !(num(d.amount) > 0) ? 'raise' : 'call';
  return 'raise';
}

/** The throwaway ask of the Horse's own decision on a rebuilt frame (HorseLogic supplies it, sandboxed). */
export type HoldemPreflopAsk = (player: SeatPlayer, gs: HorseGameStateV2) => HorseDecision;

export interface HoldemOwnPreflopRange {
  /** per class (holdemPreflopClassOf): the share of policy draws that take the Horse's actions at every frame */
  weight: Float64Array;
  frames: number;
  /** the class the Horse holds had policy weight before the floor (diagnostic) */
  ownClassReached: boolean;
}

const CACHE = new Map<string, HoldemOwnPreflopRange | null>();
const CACHE_MAX = 512;

const posOf = (seat: number, dealer: number, seats: readonly number[]): number => {
  const order = [...seats].sort((a, b) => a - b);
  const d = order.indexOf(dealer);
  const i = order.indexOf(seat);
  return d < 0 || i < 0 ? -1 : (i - d + order.length) % order.length;
};

/**
 * The policy's key, as the user's order defines the policy: the Horse's position, the preflop action line (each
 * actor's position, action and size in big blinds to the half), the effective stack depth (to 10 big blinds), the
 * table size, the blinds and antes, and the salt (style, persona mods, option rows). Exact chips, seats'
 * identities and the Horse's own cards are not in it, so one computation serves every hand on that line.
 */
function policyKeyOf(player: SeatPlayer, gs: HorseGameStateV2, salt: string): string {
  const bb = num(gs.bigBlind) || 1;
  const seats = (gs.players ?? []).map((p) => p.seat);
  const dealer = num(gs.dealerSeat);
  const startOf = (p: SeatPlayer) =>
    num(p.stack) + num((p as { totalInvested?: number }).totalInvested);
  const hist = (gs.actionHistory ?? [])
    .filter((a) => (a.stage ?? 'preflop') === 'preflop')
    .map((a) => {
      const who = (gs.players ?? []).find((p) => same(a, p));
      return `${who ? posOf(who.seat, dealer, seats) : '?'}:${a.action}:${Math.round((2 * num(a.amount)) / bb) / 2}`;
    })
    .join(',');
  const others = (gs.players ?? []).filter((p) => p.seat !== player.seat).map(startOf);
  const eff = Math.min(startOf(player), Math.max(0, ...others)) / bb;
  const ante = (gs.players ?? []).some(
    (p) => num((p as { individualAnteInvested?: number }).individualAnteInvested) > 0
  );
  return [
    gs.gameVariant,
    seats.length,
    posOf(player.seat, dealer, seats),
    Math.round((num(gs.smallBlind) / bb) * 100) / 100,
    ante ? 'ante' : '',
    Math.round(eff / 10) * 10,
    hist,
    salt,
  ].join('|');
}

/** The hand's own key: this Horse, these cards, this hand's preflop record (the chooser's read of THIS decision). */
function handKeyOf(player: SeatPlayer, gs: HorseGameStateV2): string {
  const hist = (gs.actionHistory ?? [])
    .filter((a) => (a.stage ?? 'preflop') === 'preflop')
    .map((a) => `${a.userId ?? a.seat}:${a.action}:${num(a.amount)}`)
    .join(',');
  return [
    player.user_id,
    player.seat,
    (player.cards ?? []).map((c) => c.rank + c.suit).join(''),
    gs.dealerSeat,
    hist,
  ].join('|');
}

/** Whether the chooser could read an own range here (NLH, two cards, a postflop street, exactly one live opponent). */
export function holdemOwnPreflopWanted(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  if (gs.stage !== 'flop' && gs.stage !== 'turn' && gs.stage !== 'river') return false;
  if ((player.cards ?? []).length !== 2) return false;
  const v = String(gs.gameVariant ?? '').toLowerCase();
  if (v.includes('short') || v.includes('omaha') || v.includes('plo') || v.includes('pineapple'))
    return false;
  if (gs.bettingStructure === 'fixed_limit' || gs.bettingStructure === 'pot_limit') return false;
  const live = (gs.players ?? []).filter((p) => p.seat !== player.seat && !p.is_folded);
  return live.length === 1;
}

/**
 * Compute (once per policy key) the Horse's own preflop range by asking its own policy, and keep it for this decision.
 * `salt` carries whatever else the policy reads that the frame does not (style, persona mods, option rows).
 */
export function holdemOwnPreflopPrime(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  salt: string,
  ask: HoldemPreflopAsk
): HoldemOwnPreflopRange | null {
  const key = policyKeyOf(player, gs, salt);
  let value: HoldemOwnPreflopRange | null = null;
  if (CACHE.has(key)) {
    value = CACHE.get(key)!;
    CACHE.delete(key);
    CACHE.set(key, value);
  } else {
    const rng = saveFastRandom();
    try {
      const frames = holdemOwnPreflopFrames(player, gs);
      if (frames) {
        const weight = new Float64Array(CLASSES.length).fill(1);
        for (const f of frames) {
          const cb = num(f.gs.currentBet);
          for (let k = 0; k < CLASSES.length; k++) {
            if (weight[k] === 0) continue;
            let hits = 0;
            const cards = representative(k);
            for (const seed of HOLDEM_OWN_PREFLOP_SEEDS) {
              // a stream per class and seed: no shared draw (one strength jitter for every class) can bias a border
              seedFastRandom((seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
              const d = ask({ ...f.player, cards }, f.gs);
              if (actionKind(d, cb) === f.want) hits++;
            }
            weight[k] *= hits / HOLDEM_OWN_PREFLOP_SEEDS.length;
          }
        }
        let any = 0;
        for (let k = 0; k < weight.length; k++) any += weight[k]!;
        value = any > 0 ? { weight, frames: frames.length, ownClassReached: false } : null;
      }
    } catch {
      value = null;
    } finally {
      restoreFastRandom(rng);
    }
    CACHE.set(key, value);
    if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  }
  if (!value) {
    current = { key: handKeyOf(player, gs), value: null };
    return null;
  }
  // The Horse holds its own class, so its range holds it: at least one draw's weight at every frame.
  const own = holdemPreflopClassOf(player.cards[0]!, player.cards[1]!);
  const reached = own >= 0 && value.weight[own]! > 0;
  let weight = value.weight;
  if (own >= 0 && !reached) {
    weight = Float64Array.from(value.weight);
    weight[own] = 1 / Math.pow(HOLDEM_OWN_PREFLOP_SEEDS.length, value.frames);
  }
  const mine: HoldemOwnPreflopRange = { weight, frames: value.frames, ownClassReached: reached };
  current = { key: handKeyOf(player, gs), value: mine };
  return mine;
}

/** The range primed for THIS decision (same Horse, same cards, same preflop record), or null. */
let current: { key: string; value: HoldemOwnPreflopRange | null } | null = null;

/**
 * The chooser's preflop prior for the Horse's own range: a weight per two-card combination from the Horse's own
 * policy, or null (no own range primed for this decision: the band stands).
 */
export function holdemOwnPreflopPrior(
  player: SeatPlayer,
  gs: HorseGameStateV2
): ((a: Card, b: Card) => number) | null {
  if (!current || current.key !== handKeyOf(player, gs) || !current.value) return null;
  const w = current.value.weight;
  return (a: Card, b: Card) => {
    const k = holdemPreflopClassOf(a, b);
    return k >= 0 ? w[k]! : 0;
  };
}

/** The primed own range itself (diagnostics, tests). */
export function holdemOwnPreflopCurrent(
  player: SeatPlayer,
  gs: HorseGameStateV2
): HoldemOwnPreflopRange | null {
  if (!current || current.key !== handKeyOf(player, gs)) return null;
  return current.value;
}

/** Tests: forget every primed range. */
export function holdemOwnPreflopReset(): void {
  CACHE.clear();
  current = null;
}
