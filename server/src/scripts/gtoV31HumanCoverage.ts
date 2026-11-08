/**
 * V31 human-coverage analysis CLI (offline; never imported by the engine).
 *
 *   node --import tsx src/scripts/gtoV31HumanCoverage.ts classify <hands.jsonl.gz> <decisions.jsonl> <records.jsonl>
 *   node --import tsx src/scripts/gtoV31HumanCoverage.ts report <records.jsonl> <report.json> [splitAtIso]
 *
 * classify: rebuilds every Horse postflop decision with the engine's own
 * replay (HorseComplaintReplay.stateAt) and V31 key path (GtoDecisionContext,
 * gtoV31DemandCell), and writes one V31CoverageRecord per decision, including
 * multiway decisions the live consult declines. Hands recorded before
 * per-decision public snapshots are rebuilt from the action log (start stack
 * = final stack + chips in - chips won - uncalled excess; antes ignored) and
 * marked method=approx_rebuilt_from_action_log.
 *
 * Inputs: hands.jsonl.gz holds hand_history rows (id, created_at, players,
 * actions, board, button_seat, blinds ...); decisions.jsonl holds
 * {decisionId: "<handId>:<action index>", handId, street, horseId, humanIds,
 * excludedHumans}. Both are produced by the Horse Hands study export.
 *
 * report: runs V31_R9_CANDIDATE_SCHEMES over the records (turn/river and
 * flop separately) with a chronological selection/held-out split (default:
 * the median decision time) and writes the comparison as JSON.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from '../engine/HorseComplaintReplay.js';
import {
  classifyGtoDecisionContext,
  gtoV31FlopRootStack,
  gtoV31HasHeadsUpPostflopLine,
  gtoV31Position,
  gtoV31PotType,
  lastAggressor,
} from '../engine/GtoDecisionContext.js';
import { gtoV31DemandCell } from '../engine/GtoPostflopV31.js';
import { textureClass } from '../engine/GtoPostflop.js';
import type { Card } from '../types.js';
import {
  V31_R9_CANDIDATE_SCHEMES,
  v31CoverageReport,
  v31HumanFacing,
  type V31CoverageRecord,
} from '../benchmark/GtoV31HumanCoverage.js';

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const SUIT_LETTER: Record<string, string> = { clubs: 'c', diamonds: 'd', hearts: 'h', spades: 's' };
const NON_PLAYER_ACTIONS = new Set(['sb', 'bb', 'ante', 'post', 'return', 'bomb_ante']);

function parseList(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return [];
}

function cardText(c: string): string {
  const m = /^(10|[2-9TJQKA])(clubs|diamonds|hearts|spades)$/.exec(c);
  if (!m) throw new Error(`unreadable card ${c}`);
  return (m[1] === '10' ? 'T' : m[1]) + SUIT_LETTER[m[2]];
}

/** Placeholder hole cards: they never enter a cell key, stateAt only needs two. */
function placeholderHole(board: Card[]): Card[] {
  const used = new Set(board.map((c) => `${c.rank}${c.suit}`));
  const res: Card[] = [];
  for (const r of ['2', '3', '4', '5', '6', '7'])
    for (const s of SUITS) {
      if (res.length < 2 && !used.has(`${r}${s}`)) {
        res.push({ rank: r as Card['rank'], suit: s } as Card);
        used.add(`${r}${s}`);
      }
    }
  return res;
}

/**
 * Approximate public snapshot for hands recorded before snapshots existed.
 * Run against the snapshot-recorded decisions this reproduced the exact key
 * for 99.4% (the misses were facing-size buckets, from ignored antes).
 */
function rebuiltSnapshot(h: any, actions: any[], ord0: number): any {
  const seats: number[] = parseList(h.players)
    .map((p: any) => Number(p.seat))
    .sort((a: number, b: number) => a - b);
  const btn = Number(h.button_seat);
  const sbv = Number(h.small_blind);
  const bbv = Number(h.big_blind);
  const after = (s: number) => seats.find((x) => x > s) ?? seats[0];
  const sbSeat = seats.length === 2 ? btn : after(btn);
  const bbSeat = after(sbSeat);
  const replay = (upto: number) => {
    const total = new Map<number, number>();
    const street = new Map<number, number>();
    const folded = new Set<number>();
    const allin = new Set<number>();
    for (const s of seats) {
      total.set(s, 0);
      street.set(s, 0);
    }
    const put = (s: number, v: number) => {
      total.set(s, (total.get(s) ?? 0) + v);
      street.set(s, (street.get(s) ?? 0) + v);
    };
    put(sbSeat, sbv);
    put(bbSeat, bbv);
    let stage = 'preflop';
    for (let i = 0; i < upto; i++) {
      const a = actions[i];
      if (NON_PLAYER_ACTIONS.has(a.action) || !seats.includes(a.seat)) continue;
      if (a.stage !== stage) {
        stage = a.stage;
        for (const s of seats) street.set(s, 0);
      }
      const cur = street.get(a.seat) ?? 0;
      const amt = Number(a.amount) || 0;
      if (a.action === 'fold') folded.add(a.seat);
      else if (a.action === 'call') put(a.seat, amt);
      else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
        if (amt > cur) put(a.seat, amt - cur);
        if (a.action === 'all_in') allin.add(a.seat);
      }
    }
    return { total, street, folded, allin, stage };
  };
  const end = replay(actions.length);
  const refund = new Map<number, number>();
  const maxStreet = Math.max(...seats.map((s) => end.street.get(s) ?? 0));
  const top = seats.filter((s) => (end.street.get(s) ?? 0) === maxStreet);
  if (top.length === 1) {
    const second = Math.max(
      0,
      ...seats.filter((s) => s !== top[0]).map((s) => end.street.get(s) ?? 0)
    );
    refund.set(top[0], maxStreet - second);
  }
  const won = new Map<string, number>();
  for (const w of parseList(h.winners))
    won.set(w.userId, (won.get(w.userId) ?? 0) + (Number(w.amount) || 0));
  const start = new Map<number, number>();
  for (const p of parseList(h.players)) {
    const s = Number(p.seat);
    start.set(
      s,
      Number(p.stack) + (end.total.get(s) ?? 0) - (won.get(p.userId) ?? 0) - (refund.get(s) ?? 0)
    );
  }
  const at = replay(ord0);
  const node = actions[ord0];
  const stage = node.stage;
  const n = stage === 'flop' ? 3 : stage === 'turn' ? 4 : 5;
  const board = parseList(h.board ?? h.community_cards)
    .slice(0, n)
    .map(cardText)
    .join('');
  const seatRows = seats.map((s) => {
    const tot = at.total.get(s) ?? 0;
    const onStreet = at.stage === stage ? (at.street.get(s) ?? 0) : 0;
    const behind = Math.max(0, (start.get(s) ?? 0) - tot);
    const status = (at.folded.has(s) ? 1 : 0) | (at.allin.has(s) || behind <= 0.005 ? 2 : 0);
    return [s, Math.round(behind * 100) / 100, onStreet, tot, 0, 0, status];
  });
  const currentBet = Math.max(0, ...seatRows.map((r) => r[2]));
  const heroRow = seatRows.find((r) => r[0] === node.seat);
  return {
    pot: seatRows.reduce((a, r) => a + r[3], 0),
    mode: 'cash',
    seats: seatRows,
    boards: [board],
    street: stage,
    toCall: Math.max(0, currentBet - (heroRow?.[2] ?? 0)),
    currentBet,
    minRaiseTo: null,
    maxRaiseTo: null,
    legalActions: [],
    dealerSeat: btn,
    chipUnit: 0.01,
    bigBlind: bbv,
    smallBlind: sbv,
    variant: 'nlh',
    structure: 'no_limit',
    actorSeat: node.seat,
    boardCount: 1,
    bombPot: false,
    status: 'captured',
  };
}

/** Postflop acting order: first live seat clockwise after the button acts first. */
function postflopOrderKey(seat: number, dealerSeat: number): number {
  return seat > dealerSeat ? seat - dealerSeat : seat - dealerSeat + 1000;
}

function classifyOne(h: any, d: any): V31CoverageRecord & Record<string, unknown> {
  const humans = new Set<string>([...(d.humanIds ?? []), ...(d.excludedHumans ?? [])]);
  const base = {
    decisionId: d.decisionId,
    handId: d.handId,
    createdAt: h?.created_at ?? null,
    street: d.street,
    facesHuman: false,
    liveOpponents: null,
    tableSize: null,
    potType: null,
    heroPosition: null,
    opponentPosition: null,
    stackBB: null,
    texture: null,
    nodeRole: null,
    facingKind: null,
    facingSizeBucket: null,
    heroInPosition: null,
    preflopAggressor: null,
    multiwayOrder: null,
  } as V31CoverageRecord & Record<string, unknown>;
  const done = (status: string, extra: Record<string, unknown> = {}) => ({
    ...base,
    status,
    ...extra,
  });
  if (!h) return done('hand_missing');
  const ord0 = Number(String(d.decisionId).split(':').pop());
  const raw = parseList(h.actions);
  const hasSnapshot = !!raw[ord0]?.publicNode;
  let actions: ComplaintAction[] = raw.map((a: any, i: number) => ({ ...a, ord: i + 1 }));
  let node: any = actions[ord0];
  if (!node) return done('node_missing');
  if (node.stage !== d.street) return done('node_street_mismatch');
  base.method = hasSnapshot ? 'exact_engine_snapshot' : 'approx_rebuilt_from_action_log';
  if (!hasSnapshot) {
    try {
      node = { ...node, publicNode: rebuiltSnapshot(h, raw, ord0) };
    } catch (e: any) {
      return done('rebuild_failed', { error: String(e?.message ?? e).slice(0, 120) });
    }
    actions = actions
      .filter((a: any, i: number) => i === ord0 || !NON_PLAYER_ACTIONS.has(a.action))
      .map((a: any) => (a.ord === ord0 + 1 ? node : a));
  }
  if (node.publicNode.status && node.publicNode.status !== 'captured')
    return done('snapshot_not_captured');
  const players = parseList(h.players).map((p: any) => ({
    seat: Number(p.seat),
    userId: p.userId,
    isHorse: !humans.has(p.userId),
  }));
  const extract = {
    handId: h.id,
    variant: h.game_variant,
    bigBlind: Number(h.big_blind),
    smallBlind: Number(h.small_blind),
    buttonSeat: h.button_seat,
    players,
    horseHoleCards: {},
    actions,
  } as unknown as ExtractedHand;
  let st: any;
  try {
    const probe = stateAt(
      { ...extract, horseHoleCards: { [d.horseId]: placeholderHole([]) } } as any,
      node
    );
    const hole = placeholderHole(probe.gs.communityCards as Card[]);
    st = stateAt({ ...extract, horseHoleCards: { [d.horseId]: hole } } as any, node);
  } catch (e: any) {
    return done('state_rebuild_failed', { error: String(e?.message ?? e).slice(0, 120) });
  }
  const { hero, gs, pn } = st;
  const seatUser = new Map<number, string>(players.map((p: any) => [p.seat, p.userId]));
  const opponents = gs.players.filter(
    (p: any) => !p.is_folded && p.seat !== hero.seat && (!p.is_sitting_out || p.is_all_in)
  );
  base.liveOpponents = opponents.length;
  base.facesHuman = opponents.some((p: any) => humans.has(seatUser.get(p.seat) ?? ''));
  const board = gs.communityCards as Card[];
  base.texture = textureClass(board);
  base.flopTexture = board.length >= 3 ? textureClass(board.slice(0, 3)) : null;
  base.potType = gtoV31PotType(gs.actionHistory);
  const heroPos = gtoV31Position({
    seat: hero.seat,
    dealerSeat: gs.dealerSeat,
    players: gs.players,
    dealtSeatIds: gs.dealtSeatIds,
  });
  base.heroPosition = heroPos?.position ?? null;
  base.tableSize = heroPos?.tableSize ?? null;
  const pfr = lastAggressor(gs.actionHistory, 'preflop');
  base.preflopAggressor =
    pfr === null
      ? 'none'
      : pfr === hero.seat
        ? 'hero'
        : opponents.some((p: any) => p.seat === pfr)
          ? 'opponent'
          : null;
  const live = [hero, ...opponents].sort(
    (a: any, b: any) =>
      postflopOrderKey(a.seat, gs.dealerSeat) - postflopOrderKey(b.seat, gs.dealerSeat)
  );
  const idx = live.findIndex((p: any) => p.seat === hero.seat);
  base.heroInPosition = idx === live.length - 1;
  const ctx = classifyGtoDecisionContext({
    street: d.street,
    hero,
    opponents,
    actionHistory: gs.actionHistory,
    currentBet: gs.currentBet,
    pot: gs.pot,
  });
  base.nodeRole = ctx?.nodeRole ?? null;
  base.facingKind = ctx?.facingKind ?? null;
  base.facingSizeBucket = ctx?.facingSizeBucket ?? null;
  {
    const history: any[] = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
    const prevStreet = d.street === 'flop' ? 'preflop' : d.street === 'turn' ? 'flop' : 'turn';
    const prevAggressor = lastAggressor(gs.actionHistory, prevStreet);
    const actedThisStreet = history.some((a) => a.stage === d.street && a.seat === hero.seat);
    base.fallbackRole =
      Math.max(0, gs.currentBet - hero.bet) > 0.005
        ? 'facing'
        : actedThisStreet
          ? null
          : prevAggressor === hero.seat
            ? 'agg_bet'
            : prevAggressor !== null
              ? 'donk'
              : 'lead';
  }
  const hRoot = gtoV31FlopRootStack({
    street: d.street,
    player: hero,
    actionHistory: gs.actionHistory,
  });
  const oRoots = opponents.map((o: any) =>
    gtoV31FlopRootStack({ street: d.street, player: o, actionHistory: gs.actionHistory })
  );
  const oMax = oRoots.some((x: number | null) => x === null)
    ? null
    : Math.max(...(oRoots as number[]));
  base.stackBB =
    hRoot !== null && oMax !== null && gs.bigBlind > 0 ? Math.min(hRoot, oMax) / gs.bigBlind : null;
  const straddle = actions.some((a: any) => a.stage === 'preflop' && /straddle/i.test(a.action));
  const multiBoard =
    (pn.boardCount ?? 1) !== 1 || (pn.boards?.length ?? 1) > 1 || h.community_cards2 != null;
  if (pn.bombPot === true || h.bomb_pot != null) return done('ineligible_bomb_pot');
  if (multiBoard) return done('ineligible_multi_board');
  if (straddle) return done('ineligible_straddle');
  if ((pn.structure ?? 'no_limit') !== 'no_limit') return done('ineligible_structure');
  if (opponents.length !== 1) {
    base.multiwayOrder = idx === 0 ? 'first' : idx === live.length - 1 ? 'last' : 'middle';
    return done('multiway');
  }
  const opp = opponents[0];
  const oppPos = gtoV31Position({
    seat: opp.seat,
    dealerSeat: gs.dealerSeat,
    players: gs.players,
    dealtSeatIds: gs.dealtSeatIds,
  });
  base.opponentPosition = oppPos?.position ?? null;
  const why: string[] = [];
  if (!ctx) why.push('no_node_context');
  if (!heroPos || !oppPos) why.push('no_position');
  else if (heroPos.tableSize !== oppPos.tableSize) why.push('table_size_mismatch');
  if (base.stackBB === null) why.push('no_root_stack');
  if (!gtoV31HasHeadsUpPostflopLine(gs.actionHistory, hero.seat, opp.seat))
    why.push('third_party_postflop_action');
  if (why.length) return done('unkeyable', { why });
  const cell = gtoV31DemandCell({
    street: d.street,
    family: 'cash',
    objective: 'cash_ev',
    utilityContext: 'cash_ev',
    tableSize: heroPos!.tableSize,
    potType: base.potType!,
    heroPosition: heroPos!.position,
    opponentPosition: oppPos!.position,
    stackBB: base.stackBB!,
    board,
    nodeRole: ctx!.nodeRole,
    facingKind: ctx!.facingKind,
    facingSizeBucket: ctx!.facingSizeBucket,
  });
  if (!cell) return done('unkeyable', { why: ['no_texture_or_board'] });
  return done('keyed', { key: cell.key, depth: cell.depth });
}

function classify(handsPath: string, decisionsPath: string, outPath: string): void {
  const hands = new Map<string, any>();
  for (const line of gunzipSync(readFileSync(handsPath)).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    hands.set(r.id, r);
  }
  const out: string[] = [];
  for (const line of readFileSync(decisionsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const d = JSON.parse(line);
    out.push(JSON.stringify(classifyOne(hands.get(d.handId), d)));
  }
  writeFileSync(outPath, out.join('\n') + '\n');
  console.log(`wrote ${out.length} records`);
}

function report(recordsPath: string, outPath: string, splitArg?: string): void {
  const records: V31CoverageRecord[] = readFileSync(recordsPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const tr = v31HumanFacing(records, ['turn', 'river'])
    .map((r) => r.createdAt ?? '')
    .sort();
  const splitAt = splitArg ?? tr[Math.floor(tr.length / 2)];
  const budgets = [50, 100, 250, 500, 1000, 2000, 5000];
  const result = {
    splitAt,
    turnRiver: V31_R9_CANDIDATE_SCHEMES.map((s) =>
      v31CoverageReport(records, s, { streets: ['turn', 'river'], budgets, splitAt })
    ),
    flop: V31_R9_CANDIDATE_SCHEMES.map((s) =>
      v31CoverageReport(records, s, { streets: ['flop'], budgets, splitAt })
    ),
  };
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  for (const part of ['turnRiver', 'flop'] as const) {
    console.log(`\n${part} (split ${splitAt})`);
    for (const r of result[part]) {
      const c = r.curve.map((p) => `${p.cells}:${p.heldOutCoveragePct}`).join(' ');
      console.log(
        `${r.scheme} | n=${r.decisions} ceiling=${r.ceilingPct}% keys=${r.distinctKeys} | ${c}`
      );
    }
  }
}

const [, , cmd, a, b, c] = process.argv;
if (cmd === 'classify' && a && b && c) classify(a, b, c);
else if (cmd === 'report' && a && b) report(a, b, c);
else {
  console.error(
    'usage: classify <hands.jsonl.gz> <decisions.jsonl> <records.jsonl> | report <records.jsonl> <report.json> [splitAtIso]'
  );
  process.exit(2);
}
