/**
 * Phase 5.3 (2026-11-05): the horse COMPLAINT pipeline's replay library.
 *
 * An owner or player says "that horse played this hand wrong". The hand is
 * extracted read-only (scripts/horse-measure/sql/complaint-extract.sql via
 * `horse-release-verify.py sql complaint-extract`), and this module:
 *
 *  1. finds every decision a horse made in the hand (each recorded action
 *     with origin 'horse_policy' carries the public table snapshot the engine
 *     recorded at that moment, `publicNode`);
 *  2. rebuilds the retained public game state at each of those decisions (seats,
 *     stacks, street bets, pot, board, legal actions, raise bounds, blinds,
 *     antes, dealer, tournament stage, and the action history strictly before
 *     the decision): the generalisation to every street and variant of the
 *     stateAt() builder in HorseFourBetThenFoldRealHands.law.test.ts;
 *  3. replays today's brain (HorseLogic.decide) at each node for the live
 *     hybrid profile of the hand's format and for every base style, over fixed
 *     seeds, with the opponent-memory module off so the replay is
 *     deterministic, and records which brain receipts (horse_brain_telemetry
 *     feature names) fired on the way: that names the rule that governs;
 *  4. classifies the spot into the cell the daily scorecard measures (V79/V80
 *     top-pair calls, V81 Omaha calls, the 4-bet-then-fold cell, the
 *     tournament reshove cell) so the measured value can be looked up.
 *
 * `toComplaintFixture` turns a confirmed complaint into an anonymised fixture
 * and `complaintPathHits` is the law: a complaint's forbidden path (for
 * example "raise at the 4-bet node, then fold at the 5-bet node") must never
 * be taken again by any profile at any seed. The template that turns a
 * confirmed complaint into a permanent law test is
 * scripts/horse-measure/templates/horse-complaint.law.test.ts.tmpl. Nothing
 * here reads or writes a database.
 */
import { HorseLogic, type HorseGameStateV2, type HorseProfileMods } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import { omahaCallClass } from './HorseOmahaBigBetCalls.js';
import type { Card, CardRank, CardSuit, HorseStyle, SeatPlayer } from '../types.js';
import type { HorsePublicDeductions } from './HorsePublicDeductions.js';

/** The public snapshot the engine records with every horse decision. */
export interface ComplaintPublicNode {
  pot: number;
  ante?: number | null;
  anteType?: string | null;
  mode: 'cash' | 'tournament';
  /** [seat, behind, street bet, hand total, dead ante, individual ante,
   * bit flags: folded=1, all-in=2, sitting-out=4] */
  seats: number[][];
  boards?: string[];
  street: string;
  toCall: number;
  currentBet: number;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  legalActions: string[];
  dealerSeat: number;
  chipUnit: 0.01 | 1;
  bigBlind: number;
  smallBlind: number;
  variant?: string;
  structure?: string;
  actorSeat: number;
  bombPot?: boolean;
  boardCount?: number;
  allInOrFold?: boolean;
  fixedBetSize?: number | null;
  wagersCapped?: boolean;
  asset?: 'chips' | 'diamonds';
  deductions?: HorsePublicDeductions;
  tournamentStage?: Record<string, unknown> | null;
  /** The table's VPIP floor in percent and the acting seat's own judged VPIP,
   *  as the live engine hands them to the decision (ServerTableEngineSettlement).
   *  A recorded snapshot does not carry them, so a node from a floored table
   *  replays as an unfloored one unless a fixture supplies them
   *  (PLO6-AUDIT-004). Absent = unfloored, as before. */
  vpipFloor?: number;
  ownVpip?: { hands: number; vpip: number | null };
}

export interface ComplaintAction {
  ord: number;
  seat: number;
  stage: string;
  action: string;
  amount: number;
  userId?: string;
  origin?: string;
  isFullRaise?: boolean;
  dead?: boolean;
  publicNode?: ComplaintPublicNode;
}

export interface ComplaintPlayer {
  seat: number;
  userId: string;
  isHorse: boolean;
}

/** The row complaint-extract.sql returns (column `hand`). */
export interface ExtractedHand {
  handId: string;
  tableId?: string | null;
  tournamentId?: string | null;
  variant: string;
  handNumber?: number | null;
  createdAt?: string | null;
  hasHuman?: boolean | null;
  bigBlind: number;
  smallBlind: number;
  buttonSeat?: number | null;
  board?: string[] | null;
  bombPot?: boolean;
  runItTwice?: boolean;
  players: ComplaintPlayer[];
  /** user id -> hole cards, horses only. */
  horseHoleCards: Record<string, Card[]>;
  actions: ComplaintAction[];
  results?: Array<{ userId: string; seat: number; position?: string; net: number; netBb?: number }>;
}

/** What the brain chose, reduced to what a complaint is about. A `raise` is a
 * bet or raise that is not all in; an all-in that raises is a `jam`; an all-in
 * that cannot raise is a `call`. */
export type ActionKind = 'fold' | 'check' | 'call' | 'raise' | 'jam';

export interface ForbiddenStep {
  ord: number;
  kind: ActionKind;
}

/** An anonymised, committed complaint: the fixture of a complaint law. */
export interface ComplaintFixture {
  version: 1;
  slug: string;
  title: string;
  complaint: string;
  handId: string;
  fmt: 'cash' | 'tour';
  variant: string;
  players: Array<{ seat: number; isHorse: boolean }>;
  /** seat -> hole cards, for the horse seats on the forbidden path only. */
  hole: Record<string, Card[]>;
  actions: ComplaintAction[];
  forbidden: ForbiddenStep[];
  seeds: number[];
  /** Optional non-vacuity control: with these decide() options the path IS taken. */
  control?: Record<string, unknown> | null;
}

export const COMPLAINT_SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17, 23, 31];
export const BASE_STYLES: readonly HorseStyle[] = ['tag', 'lag', 'balanced', 'tricky', 'grinder'];

export interface ReplayProfile {
  name: string;
  style: HorseStyle;
  mods: HorseProfileMods;
  /** True for the profile the live fleet plays this format with (Hybrid v1). */
  live: boolean;
}

/** Hybrid v1 for the format first (what the live fleet plays), then every base style. */
export function replayProfiles(mode: 'cash' | 'tournament'): ReplayProfile[] {
  const hy = HORSE_HYBRID_PROFILES[mode];
  return [
    { name: `hybrid_${mode}_${hy.style}`, style: hy.style, mods: { ...hy.mods }, live: true },
    ...BASE_STYLES.map((s) => ({ name: s, style: s, mods: {}, live: false })),
  ];
}

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };

/** "Td6cJc" -> cards (the publicNode board encoding). */
export function parseBoard(s: string | null | undefined): Card[] {
  const out: Card[] = [];
  const b = s ?? '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    const suit = SUIT[b[i + 1]];
    if (!suit) throw new Error(`unreadable board card ${b.slice(i, i + 2)}`);
    out.push({ rank: b[i] as CardRank, suit });
  }
  return out;
}

/** Accepts the extract row as returned by execute_sql: `[{hand: {...}}]`, `{hand: {...}}` or the hand itself. */
export function parseExtract(raw: unknown): ExtractedHand {
  let v: unknown = raw;
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object' && 'hand' in v) v = (v as { hand: unknown }).hand;
  if (typeof v === 'string') v = JSON.parse(v);
  const h = v as ExtractedHand | null;
  if (!h || typeof h !== 'object' || !Array.isArray(h.actions) || !Array.isArray(h.players))
    throw new Error('not a complaint-extract row: expected {handId, players[], actions[]}');
  if (!h.handId) throw new Error('the extract found no hand (check the hand id or table + time)');
  return { ...h, horseHoleCards: h.horseHoleCards ?? {} };
}

/** Pull the JSON array out of an execute_sql result (raw JSON, or the MCP wrapper text). */
export function rowsFromResultText(text: string): unknown[] {
  let t = text.trim();
  try {
    const obj = JSON.parse(t) as unknown;
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === 'object' && typeof (obj as { result?: unknown }).result === 'string')
      t = (obj as { result: string }).result;
    else if (obj && typeof obj === 'object') return [obj];
  } catch {
    /* wrapper text */
  }
  const m = /<untrusted-data-[^>]*>([\s\S]*?)<\/untrusted-data-/.exec(t);
  const body = m ? m[1] : t;
  const i = body.indexOf('[');
  const j = body.lastIndexOf(']');
  if (i < 0 || j < i) throw new Error('no JSON rows found in the result text');
  return JSON.parse(body.slice(i, j + 1)) as unknown[];
}

const isHorseSeat = (hand: { players: Array<{ seat: number; isHorse: boolean }> }, seat: number) =>
  hand.players.find((p) => p.seat === seat)?.isHorse === true;

/** Every decision a horse made, in order, with its recorded snapshot. */
export function horseNodes(hand: {
  actions: ComplaintAction[];
  players: Array<{ seat: number; isHorse: boolean }>;
}) {
  return hand.actions.filter(
    (a) => a.origin === 'horse_policy' && a.publicNode && isHorseSeat(hand, a.seat)
  );
}

function heroCards(hand: ExtractedHand | ComplaintFixture, seat: number): Card[] {
  if ('hole' in hand) return hand.hole[String(seat)] ?? [];
  const uid = hand.players.find((p) => p.seat === seat)?.userId;
  return (uid && hand.horseHoleCards[uid]) || [];
}

/** The seats that posted the live small and big blind, read from the posts. */
function replayBlindSeats(
  actions: ComplaintAction[]
): { smallBlind: number | null; bigBlind: number } | null {
  const pre = actions.filter((a) => a.stage === 'preflop' && a.dead !== true);
  const bb = pre.find((a) => a.action === 'bb');
  if (!bb) return null;
  const sb = pre.find((a) => a.action === 'sb');
  return { smallBlind: sb ? sb.seat : null, bigBlind: bb.seat };
}

/** The recorded tournament format, when the snapshot captured one. */
function replayFormat(pn: ComplaintPublicNode): 'mtt' | 'spin' | 'sng' | 'hu_sng' | undefined {
  if (pn.mode !== 'tournament') return undefined;
  const f = (pn.tournamentStage as { format?: unknown } | null | undefined)?.format;
  return f === 'mtt' || f === 'spin' || f === 'sng' || f === 'hu_sng' ? f : undefined;
}

/** Retained public state at `node`, with history strictly before it.
 * This is not the original private worker request, memory, RNG or runtime.
 * Missing canonical fields remain missing; never forge original-input custody.
 */
export function stateAt(hand: ExtractedHand | ComplaintFixture, node: ComplaintAction) {
  const pn = node.publicNode;
  if (!pn) throw new Error(`action ${node.ord} has no recorded snapshot`);
  const heroSeat = pn.actorSeat ?? node.seat;
  const hole = heroCards(hand, heroSeat);
  if (hole.length === 0) throw new Error(`no hole cards for the horse in seat ${heroSeat}`);
  const players = pn.seats.map(
    ([seat, behind, bet, total, dead, individualAnte, status]) =>
      ({
        seat,
        user_id: `p${seat}`,
        username: `p${seat}`,
        stack: behind,
        bet,
        totalInvested: total,
        deadInvested: dead,
        individualAnteInvested: individualAnte,
        cards: seat === heroSeat ? hole : [],
        is_folded: (status & 1) !== 0,
        is_all_in: (status & 2) !== 0,
        is_sitting_out: (status & 4) !== 0,
        is_horse: isHorseSeat(hand, seat),
      }) as SeatPlayer
  );
  const hero = players.find((p) => p.seat === heroSeat);
  if (!hero) throw new Error(`seat ${heroSeat} is not in the snapshot`);
  const ts = pn.tournamentStage ?? undefined;
  const humans = hand.players.filter((p) => !p.isHorse).map((p) => `p${p.seat}`);
  const gs = {
    // The live engine stamps every decision state (ServerTableEngineTurns);
    // the final wager rules (riverNutsRaise, omahaCurrentNutsRaise) read it.
    stateSchemaVersion: 1,
    players,
    communityCards: parseBoard(pn.boards?.[0]),
    ...(pn.boards?.[1] !== undefined ? { communityCards2: parseBoard(pn.boards[1]) } : {}),
    ...(pn.boards?.[2] !== undefined ? { communityCards3: parseBoard(pn.boards[2]) } : {}),
    ...(pn.boardCount !== undefined ? { boardCount: pn.boardCount } : {}),
    ...(pn.bombPot !== undefined ? { bombPot: pn.bombPot } : {}),
    // AoF: the live state always carries a boolean (ServerTableEngineTurns
    // sets tableInfo?.all_in_or_fold === true), so a node recorded before the
    // field existed replays as an ordinary table, false, never undefined.
    allInOrFold: pn.allInOrFold === true,
    ...(pn.fixedBetSize !== undefined ? { fixedBetSize: pn.fixedBetSize } : {}),
    ...(pn.wagersCapped !== undefined ? { wagersCapped: pn.wagersCapped } : {}),
    ...(pn.asset !== undefined ? { asset: pn.asset } : {}),
    ...(pn.vpipFloor !== undefined ? { vpipFloor: pn.vpipFloor } : {}),
    ...(pn.ownVpip !== undefined ? { ownVpip: pn.ownVpip } : {}),
    ...(pn.deductions?.status === 'captured'
      ? {
          rakeConfig: {
            ...pn.deductions.rake,
            playerCountCaps: pn.deductions.rake.playerCountCaps.map(([players, cap]) => ({
              players,
              cap,
            })),
          },
          bbjConfig: pn.deductions.bbj ? { ...pn.deductions.bbj } : null,
        }
      : {}),
    pot: pn.pot,
    currentBet: pn.currentBet,
    toCall: pn.toCall,
    minRaiseTo: pn.minRaiseTo,
    maxRaiseTo: pn.maxRaiseTo,
    legalActions: pn.legalActions,
    stage: pn.street ?? node.stage,
    gameVariant: pn.variant ?? hand.variant,
    gameMode: pn.mode,
    bettingStructure: pn.structure ?? 'no_limit',
    bigBlind: pn.bigBlind,
    smallBlind: pn.smallBlind,
    ante: pn.ante ?? 0,
    bigBlindAnte: pn.anteType === 'big_blind',
    dealerSeat: pn.dealerSeat,
    // The live engine hands every decision the dealt census and the seats
    // that posted the blinds (ServerTableEngineTurns). Without them the
    // position read falls back to "who is live or invested", which drops
    // every uninvested folder: folded to the small blind, the ring shrinks to
    // the two blinds and the small blind replays as a heads-up big blind.
    // The snapshot lists HandController's dealt roster (a tournament
    // sit-out is dealt and auto-folded), so every listed seat was dealt.
    dealtSeatIds: pn.seats.map((s) => s[0]).sort((a, b) => a - b),
    blindSeats: replayBlindSeats(hand.actions),
    // The table format the live decision read (spin, heads-up SNG, MTT).
    // Without it a spin or heads-up hand replays as an MTT.
    ...(replayFormat(pn) ? { format: replayFormat(pn) } : {}),
    chipUnit: pn.chipUnit,
    heroSeat,
    currentPlayerSeat: heroSeat,
    ...(humans.length ? { humanUserIds: humans } : {}),
    actionHistory: hand.actions
      .filter((a) => a.ord < node.ord)
      .map((a) => ({
        stage: a.stage,
        seat: a.seat,
        userId: `p${a.seat}`,
        action: a.action,
        amount: a.amount,
        isFullRaise: a.isFullRaise === true,
        ...(a.dead ? { dead: true } : {}),
      })),
    ...(pn.mode === 'tournament' && ts
      ? {
          tournament: {
            ...ts,
            currentBigBlind: pn.bigBlind,
            currentSmallBlind: pn.smallBlind,
            currentAnte: pn.ante ?? 0,
            anteType: pn.anteType ?? undefined,
            playersAtTable: pn.seats.length,
          },
        }
      : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs, pn };
}

/** fold / check / call / raise / jam. An all-in that cannot raise is a call. */
export function actionKind(
  action: string,
  amount: number | undefined,
  pn: Pick<ComplaintPublicNode, 'seats' | 'actorSeat' | 'currentBet' | 'toCall'>
): ActionKind {
  if (action === 'fold') return 'fold';
  if (action === 'check') return 'check';
  if (action === 'call') return 'call';
  if (action === 'all_in') {
    const row = pn.seats.find((s) => s[0] === pn.actorSeat);
    const reach = row ? row[1] + row[2] : Infinity;
    if (pn.toCall > 0 && reach <= pn.currentBet + 1e-9) return 'call';
    if (amount !== undefined && pn.toCall > 0 && amount <= pn.currentBet + 1e-9) return 'call';
    return 'jam';
  }
  return 'raise';
}

export interface ProfileReplay {
  profile: string;
  live: boolean;
  kinds: Partial<Record<ActionKind, number>>;
  actions: Record<string, number>;
  /** Raise/bet sizes chosen, in big blinds (street total). */
  sizesBb: number[];
  receipts: Record<string, number>;
  reproduced: number;
}

let telemetryArmed = false;

/** Run today's brain at one node for one profile over the seeds. */
export function replayAt(
  st: ReturnType<typeof stateAt>,
  profile: ReplayProfile,
  seeds: readonly number[] = COMPLAINT_SEEDS,
  opts: Record<string, unknown> = {},
  recorded?: ActionKind
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
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(st.hero, st.gs, profile.style, profile.mods, {
      mind: false,
      telemetry: true,
      ...opts,
    } as never);
    for (const f of drainFires())
      out.receipts[f.feature] = (out.receipts[f.feature] ?? 0) + f.fires;
    const k = actionKind(d.action, d.amount, st.pn);
    out.kinds[k] = (out.kinds[k] ?? 0) + 1;
    out.actions[d.action] = (out.actions[d.action] ?? 0) + 1;
    if ((k === 'raise' || k === 'jam') && typeof d.amount === 'number')
      out.sizesBb.push(Math.round((d.amount / st.pn.bigBlind) * 100) / 100);
    if (recorded && k === recorded) out.reproduced++;
  }
  HorseMind.reset();
  return out;
}

export interface SpotClass {
  street: string;
  facing: 'unopened' | 'facing_bet';
  /** Preflop: voluntary raises before the node (0 open, 1 vs open, 2 vs 3-bet, 3+ vs 4-bet+). */
  preflopRaises?: number;
  situation: string;
  /** The scorecard cell this spot belongs to, if the scorecard measures it. */
  cell: {
    family: 'v79' | 'v81' | 'four_bet_fold' | 'reshove';
    key: string;
    detail: Record<string, unknown>;
  } | null;
}

const RANKS = '23456789TJQKA';
const rankValue = (r: string) => RANKS.indexOf(r) + 2;

/** The wager faced at a postflop node and the pot before it (as sql/v79-cells.sql). */
export function wagerFaced(hand: { actions: ComplaintAction[] }, node: ComplaintAction) {
  const pn = node.publicNode!;
  const prior = hand.actions.filter((a) => a.ord < node.ord && a.stage === node.stage);
  const bet = [...prior]
    .reverse()
    .find(
      (a) =>
        ['bet', 'raise', 'all_in'].includes(a.action) && Math.abs(a.amount - pn.currentBet) < 1e-9
    );
  if (!bet) return null;
  if (bet.publicNode) {
    const row = bet.publicNode.seats.find((s) => s[0] === bet.publicNode!.actorSeat);
    return {
      wager: bet.amount - (row ? row[2] : 0),
      potBefore: bet.publicNode.pot,
      bettorSeat: bet.seat,
      exact: true,
    };
  }
  // A person's bet carries no snapshot: rebuild from the street's amounts
  // (bet/raise/all-in amounts are street totals, call amounts are increments).
  const street: Record<number, number> = {};
  let potAfterBet = 0;
  let wager = 0;
  for (const a of prior) {
    const before = street[a.seat] ?? 0;
    const add = a.action === 'call' ? a.amount : Math.max(0, a.amount - before);
    street[a.seat] = before + add;
    if (a === bet) wager = add;
    if (a.ord > bet.ord) potAfterBet += add;
  }
  return { wager, potBefore: pn.pot - wager - potAfterBet, bettorSeat: bet.seat, exact: false };
}

/** Classify a horse decision into the cell the daily scorecard measures. */
export function classifySpot(
  hand: ExtractedHand | ComplaintFixture,
  node: ComplaintAction
): SpotClass {
  const pn = node.publicNode!;
  const street = pn.street ?? node.stage;
  const variant = pn.variant ?? hand.variant;
  const fmt = pn.mode === 'tournament' ? 'tour' : 'cash';
  const facing = pn.toCall > 0 ? 'facing_bet' : 'unopened';
  const heroRow = pn.seats.find((s) => s[0] === pn.actorSeat);
  const hole = heroCards(hand, pn.actorSeat);
  if (street === 'preflop') {
    let cur = Math.max(
      pn.bigBlind,
      ...hand.actions
        .filter((a) => a.ord < node.ord && a.stage === 'preflop' && a.action === 'bb')
        .map((a) => a.amount)
    );
    let raises = 0;
    let callers = 0;
    let heroRaised = false;
    for (const a of hand.actions.filter((x) => x.ord < node.ord && x.stage === 'preflop')) {
      if (['raise', 'bet', 'all_in'].includes(a.action) && a.amount > cur + 1e-9) {
        raises++;
        cur = a.amount;
        callers = 0;
        if (a.seat === pn.actorSeat) heroRaised = true;
      } else if (a.action === 'call' || a.action === 'all_in') callers++;
    }
    const label =
      raises === 0
        ? callers
          ? 'preflop limped pot'
          : 'preflop unopened (open spot)'
        : raises === 1
          ? 'preflop facing an open (3-bet spot)'
          : raises === 2
            ? 'preflop facing a 3-bet (4-bet spot)'
            : heroRaised
              ? 'preflop facing a 5-bet+ after the horse 4-bet'
              : 'preflop facing a 4-bet+';
    let cell: SpotClass['cell'] = null;
    if (variant === 'nlh' && (raises === 2 || (raises >= 3 && heroRaised)))
      cell = { family: 'four_bet_fold', key: `${variant}|${fmt}`, detail: { raises } };
    const effBb = (() => {
      if (!heroRow) return NaN;
      const mine = heroRow[1] + heroRow[2];
      const others = pn.seats
        .filter((s) => s[0] !== pn.actorSeat && s[6] !== 1)
        .map((s) => s[1] + s[2]);
      return Math.min(mine, Math.max(0, ...others)) / pn.bigBlind;
    })();
    if (
      variant === 'nlh' &&
      fmt === 'tour' &&
      raises === 1 &&
      callers === 0 &&
      effBb > 15 &&
      effBb <= 30
    ) {
      const dealt = pn.seats.length;
      cell = {
        family: 'reshove',
        key: `${dealt <= 3 ? 'd<=3' : dealt <= 6 ? 'd4-6' : 'd7+'}|${effBb <= 20 ? '15-20' : effBb <= 25 ? '20-25' : '25-30'}`,
        detail: { effBb: Math.round(effBb * 10) / 10, dealt },
      };
    }
    return { street, facing, preflopRaises: raises, situation: label, cell };
  }
  const board = parseBoard(pn.boards?.[0]);
  const label = `${street} ${facing === 'facing_bet' ? 'facing a bet' : 'checked to / first to act'}`;
  if (facing !== 'facing_bet' || !['turn', 'river'].includes(street))
    return { street, facing, situation: label, cell: null };
  const w = wagerFaced(hand, node);
  const pf = w && w.potBefore > 0 ? w.wager / w.potBefore : NaN;
  const bettorRow = w ? pn.seats.find((s) => s[0] === w.bettorSeat) : undefined;
  const effBb =
    heroRow && bettorRow
      ? Math.min(heroRow[1] + heroRow[2], bettorRow[1] + bettorRow[2]) / pn.bigBlind
      : NaN;
  const active = pn.seats.filter((s) => s[6] === 0 || s[6] === 2).length;
  const detail = {
    potFraction: Math.round(pf * 1000) / 1000,
    effectiveBb: Math.round(effBb * 10) / 10,
    activePlayers: active,
    wagerExact: w?.exact ?? false,
  };
  if (variant === 'plo4' || variant === 'plo5') {
    const cls = omahaCallClass(hole, board);
    const b = pf >= 0.9 ? 'pf>=0.9' : pf >= 0.5 ? 'pf0.5-0.9' : 'pf<0.5';
    return {
      street,
      facing,
      situation: label,
      cell: { family: 'v81', key: `${cls}|${b}|all`, detail: { ...detail, class: cls } },
    };
  }
  if (variant !== 'nlh' || hole.length !== 2)
    return { street, facing, situation: label, cell: null };
  const br = board.map((c) => rankValue(c.rank));
  const top = Math.max(...br);
  const [h1, h2] = hole.map((c) => rankValue(c.rank));
  const topOnce = br.filter((x) => x === top).length === 1;
  const holdsTop = (h1 === top) !== (h2 === top);
  const kick = h1 === top ? h2 : h1;
  if (!topOnce || !holdsTop || br.includes(kick))
    return { street, facing, situation: label, cell: null };
  const kc = kick <= 9 ? 'weak_2_9' : 'strong_T+';
  const huTable = pn.seats.length === 2;
  const bounty = Boolean(
    pn.tournamentStage &&
    (pn.tournamentStage.isBounty || pn.tournamentStage.isPko || pn.tournamentStage.isMysteryBounty)
  );
  let lab: string | null = null;
  if (pf >= 0.9 && top >= 12 && effBb > 60 && !huTable && !bounty) lab = 'A';
  else if (
    pf >= 0.6 &&
    pf < 0.9 &&
    top === 14 &&
    fmt !== 'tour' &&
    effBb > 60 &&
    active <= 2 &&
    !huTable
  )
    lab = 'B';
  return {
    street,
    facing,
    situation: `${label}, top pair ${kc === 'weak_2_9' ? 'weak' : 'strong'} kicker`,
    cell: lab
      ? { family: 'v79', key: `${lab}|${kc}`, detail: { ...detail, top, kicker: kick } }
      : null,
  };
}

export interface NodeReplay {
  ord: number;
  seat: number;
  street: string;
  recorded: { action: string; amount: number; kind: ActionKind };
  spot: SpotClass;
  profiles: ProfileReplay[];
  /** Live hybrid profile: share of seeds that still make the recorded action. */
  liveReproduced: number;
  verdict: string;
  replayLimitations: string[];
}

/** Replay every horse decision of a hand (or only the `ords` given). */
export function replayHand(
  hand: ExtractedHand | ComplaintFixture,
  options: { ords?: number[]; seeds?: readonly number[]; opts?: Record<string, unknown> } = {}
): NodeReplay[] {
  const seeds = options.seeds ?? COMPLAINT_SEEDS;
  const out: NodeReplay[] = [];
  for (const node of horseNodes(hand)) {
    if (options.ords && !options.ords.includes(node.ord)) continue;
    const st = stateAt(hand, node);
    const kind = actionKind(node.action, node.amount, st.pn);
    const profiles = replayProfiles(st.pn.mode).map((p) =>
      replayAt(st, p, seeds, options.opts, kind)
    );
    const live = profiles.find((p) => p.live)!;
    const share = live.reproduced / seeds.length;
    const anyStyle = profiles.filter((p) => p.reproduced > 0).map((p) => p.profile);
    const unavailable = [
      ...new Set(
        profiles.flatMap((p) =>
          Object.keys(p.receipts).filter(
            (key) =>
              key.includes('canonical_state_unavailable') || key.includes('blind_seats_unavailable')
          )
        )
      ),
    ].sort();
    out.push({
      ord: node.ord,
      seat: node.seat,
      street: st.pn.street,
      recorded: { action: node.action, amount: node.amount, kind },
      spot: classifySpot(hand, node),
      profiles,
      liveReproduced: share,
      replayLimitations: [
        'Current checked-out source with opponent memory disabled, not original-runtime replay or live-use proof.',
        'Action reproduction is not a strategic correctness or EV verdict.',
        ...unavailable.map((key) => `Policy path unavailable in reconstructed input: ${key}`),
      ],
      verdict:
        share === 0
          ? anyStyle.length
            ? `the reconstructed current hybrid profile did not choose ${kind}; observed in: ${anyStyle.join(', ')}`
            : `the reconstructed current source did not choose ${kind} in the tested profiles and seeds`
          : `the reconstructed current hybrid profile chose ${kind} in ${live.reproduced}/${seeds.length} seeds`,
    });
  }
  return out;
}

/**
 * The law. A forbidden path is a list of (node, action kind). For each
 * profile it is "taken" when every step's kind occurs at its node in at least
 * one seed (the same rule as the 4-bet-then-fold law: 4-bets in some seed and
 * folds in some seed). Returns the profiles that can still take it.
 */
export function complaintPathHits(
  fx: ComplaintFixture,
  opts: Record<string, unknown> = {}
): string[] {
  const nodes = new Map(horseNodes(fx).map((n) => [n.ord, n]));
  const hits: string[] = [];
  const mode = fx.fmt === 'tour' ? 'tournament' : 'cash';
  for (const p of replayProfiles(mode)) {
    const taken = fx.forbidden.every((step) => {
      const node = nodes.get(step.ord);
      if (!node) throw new Error(`forbidden step ${step.ord} is not a recorded horse decision`);
      const r = replayAt(stateAt(fx, node), p, fx.seeds, opts, step.kind);
      return r.reproduced > 0;
    });
    if (taken) hits.push(p.name);
  }
  return hits;
}

/** True when the recorded hand really took the forbidden path. */
export function recordedPathMatches(fx: ComplaintFixture): boolean {
  return fx.forbidden.every((step) => {
    const a = fx.actions.find((x) => x.ord === step.ord);
    return !!a?.publicNode && actionKind(a.action, a.amount, a.publicNode) === step.kind;
  });
}

/** Anonymise a confirmed complaint into a committed fixture (seats only, no user ids or names). */
export function toComplaintFixture(
  hand: ExtractedHand,
  meta: {
    slug: string;
    title: string;
    complaint: string;
    forbidden: ForbiddenStep[];
    seeds?: number[];
    control?: Record<string, unknown> | null;
  }
): ComplaintFixture {
  const nodes = new Map(horseNodes(hand).map((n) => [n.ord, n]));
  const hole: Record<string, Card[]> = {};
  for (const step of meta.forbidden) {
    const n = nodes.get(step.ord);
    if (!n) throw new Error(`ord ${step.ord} is not a recorded horse decision in this hand`);
    hole[String(n.seat)] = heroCards(hand, n.seat).map((c) => ({ rank: c.rank, suit: c.suit }));
  }
  const strip = (pn: ComplaintPublicNode): ComplaintPublicNode => {
    const {
      pot,
      ante,
      anteType,
      mode,
      seats,
      boards,
      street,
      toCall,
      currentBet,
      minRaiseTo,
      maxRaiseTo,
      legalActions,
      dealerSeat,
      chipUnit,
      bigBlind,
      smallBlind,
      variant,
      structure,
      actorSeat,
      bombPot,
      tournamentStage,
    } = pn;
    return {
      pot,
      ante,
      anteType,
      mode,
      seats,
      boards,
      street,
      toCall,
      currentBet,
      minRaiseTo,
      maxRaiseTo,
      legalActions,
      dealerSeat,
      chipUnit,
      bigBlind,
      smallBlind,
      variant,
      structure,
      actorSeat,
      bombPot,
      tournamentStage: tournamentStage ?? null,
    };
  };
  const fx: ComplaintFixture = {
    version: 1,
    slug: meta.slug,
    title: meta.title,
    complaint: meta.complaint,
    handId: hand.handId,
    fmt: hand.tournamentId ? 'tour' : 'cash',
    variant: hand.variant,
    players: hand.players.map((p) => ({ seat: p.seat, isHorse: p.isHorse })),
    hole,
    actions: hand.actions.map((a) => ({
      ord: a.ord,
      seat: a.seat,
      stage: a.stage,
      action: a.action,
      amount: a.amount,
      ...(a.origin ? { origin: a.origin } : {}),
      isFullRaise: a.isFullRaise === true,
      dead: a.dead === true,
      ...(a.publicNode ? { publicNode: strip(a.publicNode) } : {}),
    })),
    forbidden: meta.forbidden,
    seeds: meta.seeds ?? [...COMPLAINT_SEEDS],
    control: meta.control ?? null,
  };
  if (!recordedPathMatches(fx))
    throw new Error('the recorded hand did not take that path: check each ORD:KIND');
  return fx;
}
