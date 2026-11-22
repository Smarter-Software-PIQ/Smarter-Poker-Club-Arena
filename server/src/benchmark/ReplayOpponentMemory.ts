/**
 * OPPONENT MEMORY IN THE AUDITED-NODE REPLAY, AS OF THE DECISION (REPLAY-V2, HORSE DECISIONS lane, 2026-11-20).
 *
 * The audited-node replay (scripts/audited-node-option-replay.ts) used to run every decision with opponent memory
 * OFF and seats renamed p<seat>, so any option that prices a per-opponent record saw none and fell back to its
 * population prior. This module rebuilds each opponent's PUBLIC record as it stood when the recorded decision was
 * taken, and hands it to the decision the way the live engine holds it:
 *
 *  - Source: retained hand_history rows (public actions with their origin, the showdown list of who showed and the
 *    hand name, no hole cards; board cards). Unshown cards never enter: a history row carries none.
 *  - As of: a hand is learned only when it was settled (hand_history.created_at) strictly before the decision's own
 *    action timestamp, and never the hand being decided. learnThrough() only moves forward, so a record built at t
 *    holds no hand settled at or after t (ReplayOpponentMemory.test.ts proves it).
 *  - Learner: the live completed-hand learner's calls, in the order workerRuntime.observeCompletedHandInMind makes
 *    them (HorseMind.observe under the hand's scope with the hand's identity, then HorseMind.observeHandComplete),
 *    plus the street-read reducer the accepted-hand database learner mirrors (streetReadHandIncrements +
 *    addStreetReadEvidence, keyed as HorseMind.omahaStreetReadOf reads it) - the league's stand-in for that learner
 *    (benchmark/HorseLeagueStreetRead.ts), here keyed by the hand's own mode. All of it runs inside one private
 *    HorseMindSandbox, never the process-wide memory.
 *  - Decision: today's HorseLogic.decide with mind on and observeMind off (the live second-look / exact-replay
 *    control: every strategic read on, no ingestion of the decision's own snapshot) inside the sandbox, with the
 *    decision's intent writes captured (HorseMind.captureDecisionEffects) so no arm or seed changes what the next
 *    one reads. Seats carry their real user ids so the reads find their rows; the memory is keyed by id exactly as
 *    the live memory is (no option may branch on an id: owner rule).
 *
 * What it is not: the durable profile rows (horse_exact_profiles) that the live observer reads blend in are not read
 * (they are lifetime aggregates that include hands after the decision); the record is rebuilt by the same reducers
 * from the retained history instead. Only hands with a person dealt in (has_human) are pulled, so a person's record
 * is complete from his first hand, but a Horse opponent's record lacks his Horse-only hands.
 */
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseGameStateV2, type HorseProfileMods } from '../engine/HorseLogic.js';
import { HorseMind, readScopeOf, type HorseMindSandbox } from '../engine/HorseMind.js';
import { seedFastRandom } from '../engine/HorseEval.js';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import { horseMindHandFromHistory } from '../engine/HorseMindHandIdentity.js';
import { completedHandActionsForMind } from '../engine/horseDecision/completedHandActions.js';
import { bigBlindFromForcedPosts, type ExploitHandAction } from '../engine/HorseOpponentExploit.js';
import { bettingStructureFor } from '../engine/BettingStructure.js';
import { publicMemoryDomainIsValid } from '../engine/HorsePublicMemoryDomain.js';
import { addStreetReadEvidence, streetReadHandIncrements } from '../engine/HorseOmahaStreetRead.js';
import {
  memoryVariant,
  opponentMemoryKey,
  type MemoryMode,
  type MemorySize,
} from '../engine/HorseOpponentMemory.js';
import {
  actionKind,
  type ComplaintAction,
  type ExtractedHand,
  type ProfileReplay,
  type ReplayProfile,
  type stateAt,
} from '../engine/HorseComplaintReplay.js';

/** One retained hand as the pull writes it (hand_history, public columns only), parsed. */
export interface HistoryHand {
  id: string;
  /** hand_history.created_at (settlement), epoch ms. */
  settledAtMs: number;
  variant: string;
  tableId: string | null;
  handNumber: number | null;
  tournament: boolean;
  speed: 'table' | 'lightning' | null;
  bigBlind: number;
  board: Card[];
  showdown: Array<{ user_id: string; mucked: boolean; hand_name?: string }> | null;
  dealt: number;
  players: Array<{ seat: number; userId: string }>;
  actions: unknown[];
}

const SUITS: Record<string, CardSuit> = {
  hearts: 'hearts',
  diamonds: 'diamonds',
  clubs: 'clubs',
  spades: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
  s: 'spades',
};

/** '7hearts', '10spades', 'Td', {rank, suit} -> Card; unreadable -> null. */
export function cardOf(raw: unknown): Card | null {
  if (raw && typeof raw === 'object') {
    const r = String((raw as { rank?: unknown }).rank ?? '');
    const s = SUITS[String((raw as { suit?: unknown }).suit ?? '')];
    const rank = (r === '10' ? 'T' : r.toUpperCase()) as CardRank;
    return s && /^[2-9TJQKA]$/.test(rank) ? { rank, suit: s } : null;
  }
  const m = /^(10|[2-9TJQKA])(hearts|diamonds|clubs|spades|[hdcs])$/i.exec(String(raw ?? ''));
  if (!m) return null;
  const rank = (m[1] === '10' ? 'T' : m[1].toUpperCase()) as CardRank;
  return { rank, suit: SUITS[m[2].toLowerCase()] };
}

/** Postgres text time ('2026-11-19 00:29:17.005236+00') or ISO -> epoch ms; NaN when unreadable. */
export function historyTimeMs(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  return Date.parse(iso);
}

/** A pulled row -> HistoryHand; null when it cannot be learned (no id, time or actions). */
export function historyHandOf(row: Record<string, unknown>): HistoryHand | null {
  const id = typeof row.id === 'string' ? row.id : null;
  const at = historyTimeMs(row.created_at);
  const acts = Array.isArray(row.act) ? (row.act as unknown[]) : null;
  if (!id || !Number.isFinite(at) || !acts || acts.length === 0) return null;
  const pl = Array.isArray(row.pl) ? (row.pl as Array<{ seat: unknown; userId: unknown }>) : [];
  const pmd = (row.pmd ?? null) as { speed?: unknown } | null;
  const cc = Array.isArray(row.cc) ? (row.cc as unknown[]) : [];
  return {
    id,
    settledAtMs: at,
    variant: String(row.gv ?? 'nlh'),
    tableId: typeof row.tid === 'string' ? row.tid : null,
    handNumber: row.hn === null || row.hn === undefined ? null : Number(row.hn),
    tournament: row.tourney === true || row.tourney === 'true',
    speed: pmd?.speed === 'lightning' ? 'lightning' : pmd?.speed === 'table' ? 'table' : null,
    bigBlind: Number(row.bb ?? 0),
    board: cc.map(cardOf).filter((c): c is Card => c !== null),
    showdown: Array.isArray(row.sd)
      ? (row.sd as Array<{ user_id: string; mucked: boolean; hand_name?: string }>).map((s) => ({
          user_id: s.user_id,
          mucked: s.mucked === true,
          ...(typeof s.hand_name === 'string' ? { hand_name: s.hand_name } : {}),
        }))
      : null,
    dealt: Number(row.np ?? pl.length) || pl.length,
    players: pl
      .filter((p) => typeof p.userId === 'string')
      .map((p) => ({ seat: Number(p.seat), userId: String(p.userId) })),
    actions: acts,
  };
}

/** The opponent records a replay reads, learned forward in time inside one private sandbox. */
export class AsOfOpponentMemory {
  readonly sandbox: HorseMindSandbox = {
    ...HorseMind.createSandbox(),
    styleMaps: HorseMind.createStyleMaps(),
  };
  private readonly hands: HistoryHand[];
  private next = 0;
  private throughMs = -Infinity;
  /** ids of the hands learned so far, in the order learned (for the receipt and the leakage test). */
  readonly learned: string[] = [];
  /** settlement time of the latest hand learned. */
  latestLearnedMs = -Infinity;
  /** hands each user was dealt into that have been learned (the size of his record now). */
  readonly handsOf = new Map<string, number>();
  skipped = 0;

  constructor(hands: readonly HistoryHand[]) {
    this.hands = [...hands].sort(
      (a, b) => a.settledAtMs - b.settledAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }

  get asOfMs(): number {
    return this.throughMs;
  }

  /**
   * Learn every hand settled strictly before tMs, except `excludeHandId` (the hand being decided, which settles
   * after its own decisions anyway). Forward only: a time earlier than one already reached throws, so no record
   * can be rebuilt with a later hand already in it.
   */
  learnThrough(tMs: number, excludeHandId: string | null = null): number {
    if (!Number.isFinite(tMs))
      throw new Error('AsOfOpponentMemory.learnThrough: time is not finite');
    if (tMs < this.throughMs)
      throw new Error(
        'AsOfOpponentMemory.learnThrough: time went backwards (feed decisions in time order)'
      );
    this.throughMs = tMs;
    let n = 0;
    while (this.next < this.hands.length && this.hands[this.next].settledAtMs < tMs) {
      const h = this.hands[this.next++];
      if (h.id === excludeHandId) continue;
      if (this.learn(h)) n++;
    }
    return n;
  }

  /** The live completed-hand learner's calls for one settled hand, inside the sandbox. */
  private learn(h: HistoryHand): boolean {
    const identity = horseMindHandFromHistory({
      id: h.id,
      table_id: h.tableId,
      hand_number: h.handNumber,
    });
    const projected = completedHandActionsForMind(h.actions, null);
    if (!identity || !projected) {
      this.skipped++;
      return false;
    }
    const scope = readScopeOf(h.variant, h.dealt);
    const bb =
      h.bigBlind > 0
        ? h.bigBlind
        : (bigBlindFromForcedPosts(h.actions as Parameters<typeof bigBlindFromForcedPosts>[0]) ??
          0);
    const mode: MemoryMode = h.tournament ? 'tournament' : 'cash';
    HorseMind.runInSandbox(this.sandbox, () => {
      const previous = HorseMind.currentScope();
      HorseMind.setDecisionScope(scope);
      try {
        HorseMind.observe(
          projected.actions,
          [],
          identity,
          undefined,
          bb,
          bettingStructureFor(h.variant)
        );
      } finally {
        HorseMind.setDecisionScope(previous);
      }
      HorseMind.observeHandComplete(
        `replay:${h.id}`,
        projected.actions,
        bb,
        h.showdown,
        scope,
        false,
        { variant: h.variant, boardCount: 1 },
        undefined,
        mode,
        true,
        h.speed ?? undefined
      );
    });
    this.learnStreetRead(h, projected.actions as unknown as ExploitHandAction[], scope, mode);
    this.learned.push(h.id);
    this.latestLearnedMs = Math.max(this.latestLearnedMs, h.settledAtMs);
    for (const u of new Set(h.players.map((p) => p.userId)))
      this.handsOf.set(u, (this.handsOf.get(u) ?? 0) + 1);
    return true;
  }

  /** The accepted-hand street-read reducer (as benchmark/HorseLeagueStreetRead.ts), keyed by the hand's mode. */
  private learnStreetRead(
    h: HistoryHand,
    actions: ExploitHandAction[],
    scope: string,
    mode: MemoryMode
  ): void {
    const variant = memoryVariant(h.variant);
    const size = scope.split(':')[1] as MemorySize | undefined;
    if (!variant || !size || h.board.length < 3) return;
    const increments = streetReadHandIncrements(actions, h.board.slice(0, 3));
    if (increments.size === 0) return;
    const map = (this.sandbox.pooledStreetRead ??= new Map());
    for (const [userId, inc] of increments) {
      const key = opponentMemoryKey(userId, variant, mode, size);
      const next = addStreetReadEvidence(map.get(key) ?? null, inc);
      if (next) map.set(key, next);
    }
  }
}

/** The decision's own time: its recorded action's timestamp (ms). Null when the node carries none. */
export function decisionTimeMs(node: ComplaintAction): number | null {
  const t = Number((node as { timestamp?: unknown }).timestamp);
  return Number.isSafeInteger(t) && t > 0 ? t : null;
}

/** Who the decision faces: 'people' = every live opponent is a person, 'horse_only' = every one a Horse, else 'mixed'. */
export type FacingKind = 'people' | 'horse_only' | 'mixed';
export interface Facing {
  kind: FacingKind;
  opponents: Array<{ seat: number; userId: string; isHorse: boolean }>;
}
export function facingOf(hand: ExtractedHand, node: ComplaintAction): Facing | null {
  const pn = node.publicNode;
  if (!pn) return null;
  const hero = pn.actorSeat ?? node.seat;
  const bySeat = new Map(hand.players.map((p) => [p.seat, p]));
  const opponents = pn.seats
    .filter((s) => s[0] !== hero && (s[6] & 1) === 0 && (s[6] & 4) === 0)
    .map((s) => bySeat.get(s[0]))
    .filter((p): p is ExtractedHand['players'][number] => !!p)
    .map((p) => ({ seat: p.seat, userId: p.userId, isHorse: p.isHorse === true }));
  if (opponents.length === 0) return null;
  const people = opponents.filter((o) => !o.isHorse).length;
  return {
    kind: people === opponents.length ? 'people' : people === 0 ? 'horse_only' : 'mixed',
    opponents,
  };
}

/**
 * The state stateAt built, with every seat's anonymous id (p<seat>) replaced by the seat's real user id, so the
 * opponent reads find their rows. Cards are untouched: the public seats still carry none.
 */
export function withSeatIds(
  st: ReturnType<typeof stateAt>,
  hand: ExtractedHand
): ReturnType<typeof stateAt> {
  const idOf = new Map(hand.players.map((p) => [`p${p.seat}`, p.userId]));
  const map = (id: unknown): unknown => (typeof id === 'string' ? (idOf.get(id) ?? id) : id);
  const gs = st.gs as unknown as Record<string, unknown> & {
    players: SeatPlayer[];
    actionHistory?: Array<Record<string, unknown>>;
    humanUserIds?: string[];
  };
  const players = gs.players.map((p) => ({
    ...p,
    user_id: map(p.user_id) as string,
    username: map(p.username) as string,
  }));
  const next = {
    ...gs,
    players,
    ...(gs.publicMemoryDomain === undefined && publicMemoryDomainIsValid(hand.publicMemoryDomain)
      ? { publicMemoryDomain: { ...hand.publicMemoryDomain } }
      : {}),
    ...(gs.actionHistory
      ? { actionHistory: gs.actionHistory.map((a) => ({ ...a, userId: map(a.userId) })) }
      : {}),
    ...(gs.humanUserIds ? { humanUserIds: gs.humanUserIds.map((u) => map(u) as string) } : {}),
  } as unknown as HorseGameStateV2;
  const hero = {
    ...st.hero,
    user_id: map(st.hero.user_id) as string,
    username: map(st.hero.username) as string,
  };
  return { ...st, gs: next, hero };
}

let telemetryArmed = false;

/**
 * replayAt (HorseComplaintReplay) with the memory on: the same seeds and reductions, but the brain reads the
 * sandbox (mind on, observeMind off) and its intent writes are captured, so the sandbox reads the same before and
 * after; nothing is reset between seeds because nothing was written.
 */
export function replayAtWithMemory(
  memory: AsOfOpponentMemory,
  st: ReturnType<typeof stateAt>,
  profile: ReplayProfile,
  seeds: readonly number[],
  opts: Record<string, unknown> = {}
): ProfileReplay {
  if (!telemetryArmed) {
    enableBrainTelemetry();
    telemetryArmed = true;
  }
  const out: ProfileReplay = {
    profile: profile.name,
    live: profile.live,
    kinds: {},
    actions: {},
    sizesBb: [],
    receipts: {},
    reproduced: 0,
  };
  for (const seed of seeds) {
    seedFastRandom(seed);
    drainFires();
    const d = HorseMind.runInSandbox(memory.sandbox, () =>
      HorseMind.captureDecisionEffects(() =>
        HorseLogic.decide(
          st.hero,
          st.gs,
          profile.style,
          profile.mods as HorseProfileMods,
          {
            telemetry: true,
            ...opts,
            mind: true,
            observeMind: false,
          } as never
        )
      )
    ).value;
    for (const f of drainFires())
      out.receipts[f.feature] = (out.receipts[f.feature] ?? 0) + f.fires;
    const k = actionKind(d.action, d.amount, st.pn);
    out.kinds[k] = (out.kinds[k] ?? 0) + 1;
    out.actions[d.action] = (out.actions[d.action] ?? 0) + 1;
    if ((k === 'raise' || k === 'jam') && typeof d.amount === 'number')
      out.sizesBb.push(Math.round((d.amount / st.pn.bigBlind) * 100) / 100);
  }
  return out;
}
