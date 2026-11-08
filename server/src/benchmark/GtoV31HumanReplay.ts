/**
 * V31 HUMAN REPLAY (2026-11-07). Measurement only: never a gate.
 *
 * A V31 playbook is qualified by horse-vs-horse paired replay and league
 * play, but horses earn their money against people. This module asks, for
 * every real decision a horse made postflop in an NLH hand with a person
 * seated: would this sealed playbook's cell set have handled it, what would
 * the playbook have done, what did the horse actually do, and what does the
 * playbook itself say each choice is worth.
 *
 * Nothing is re-implemented. The hand arrives in the complaint-extract shape
 * (scripts/horse-measure/sql/v31-human-replay-hands.sql); the public state at
 * each recorded horse decision is rebuilt by HorseComplaintReplay.stateAt; the
 * decision goes through HorseLogic.decide with the candidate selected by its
 * checksum (opts.gtoV31DatasetChecksum, the offline evaluation selector), so
 * eligibility, position, pot type, node role, depth, texture and the cell
 * lookup are the engine's own runtime path (HorseV31CertifiedPolicy). The
 * engine reports a consult through opts.onV31Demand and an answer through
 * opts.onGtoV31Decision; this module only reads those receipts.
 *
 * What it is not. The replay runs with the opponent-memory module off and a
 * fixed seed per decision, so a decision the live brain handed to another
 * layer (the V53 pressure hand-off reads opponent memory) is replayed as if
 * the playbook had been asked. The EVs are the playbook's own estimates in
 * its own abstraction, not realized results. Summed over decisions they say
 * how much the playbook believes it would have gained; they are not a
 * measured win rate.
 */
import { createHash } from 'node:crypto';

import { seedFastRandom } from '../engine/HorseEval.js';
import { HorseLogic, type GtoV31DecisionReceipt } from '../engine/HorseLogic.js';
import { HorseMind } from '../engine/HorseMind.js';
import {
  horseNodes,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from '../engine/HorseComplaintReplay.js';
import { gtoV31DemandCell, type GtoV31ActionSpec } from '../engine/GtoPostflopV31.js';
import type { V31DemandSpot } from '../engine/HorseV31CertifiedPolicy.js';

export const GTO_V31_HUMAN_REPLAY_PROTOCOL = 'smarter-poker.v31-human-replay.v1';

export type GtoV31Family = GtoV31ActionSpec['family'];
const POSTFLOP = new Set(['flop', 'turn', 'river']);

/** Where a recorded horse decision ended up. */
export type GtoV31HumanStatus =
  /** the playbook answered (a receipt was emitted) */
  | 'covered'
  /** the engine consulted V31 but this dataset has no cell / no answer */
  | 'cell_miss'
  /** the engine never consulted V31 here (multiway line, ineligible state) */
  | 'not_consulted'
  /** the horse's own hole cards were not retained */
  | 'no_hole_cards'
  /** not NLH no-limit */
  | 'out_of_scope'
  /** the recorded snapshot predates the seat/legal-action fields */
  | 'no_snapshot'
  /** the recorded state could not be rebuilt or replayed */
  | 'replay_error';

export interface GtoV31HumanPlaybook {
  datasetId: string;
  datasetChecksum: string;
  cell: string;
  handKey: string;
  hand: string;
  nodeRole: string;
  depthBucket: number;
  stackBb: number;
  distribution: Record<string, number>;
  actions: Record<string, GtoV31ActionSpec>;
  sampledActionId: string;
  modalActionId: string;
  policyEvBb: number | null;
  actionEvsBb: Record<string, number | null> | null;
  pot: number;
  currentBet: number;
  toCall: number;
  bigBlind: number;
}

export interface GtoV31HumanDecision {
  handId: string;
  ord: number;
  createdAt: string | null;
  street: string;
  seat: number;
  mode: 'cash' | 'tournament';
  /** The single live opponent, when there is exactly one. */
  opponentSeat: number | null;
  opponentKind: 'human' | 'horse' | 'excluded_human' | 'multiway' | 'unknown';
  /** Chips the horse could still put in this street (behind + street bet). */
  heroReach: number | null;
  status: GtoV31HumanStatus;
  /** The cell the engine asked for (demand), covered or not. */
  demandCell: string | null;
  error?: string;
  actual: { action: string; amount: number };
  playbook: GtoV31HumanPlaybook | null;
}

/** The action that was taken, classified against the playbook's menu. */
export interface GtoV31ActualMatch {
  family: GtoV31Family;
  /** The playbook action id whose family and size are closest. Null when the
   * menu has no action of that family. */
  actionId: string | null;
  /** |actual - spec amount| / max(spec amount, 1 bb) for sized actions. */
  sizeError: number | null;
}

/** The amount a sized action would put in, exactly as decideV31Certified
 * builds its intended decision (bet: pot x fraction; raise: to currentBet +
 * (pot + toCall) x fraction). Null for check/fold/call/all-in. */
export function gtoV31SpecAmount(
  spec: GtoV31ActionSpec,
  frame: { pot: number; currentBet: number; toCall: number }
): number | null {
  if (spec.family === 'bet' && spec.size_unit === 'pot_fraction' && spec.size_value)
    return frame.pot * spec.size_value;
  if (spec.family === 'raise' && spec.size_unit === 'pot_after_call_fraction' && spec.size_value)
    return frame.currentBet + (frame.pot + frame.toCall) * spec.size_value;
  return null;
}

/**
 * The family of the recorded action. An all-in that cannot raise is a call
 * (HorseComplaintReplay.actionKind's rule); one that opens or raises is an
 * all_in when the menu has one, else the bet/raise it is.
 */
export function gtoV31ActualFamily(
  action: string,
  amount: number,
  frame: { currentBet: number; toCall: number },
  heroReach: number | null
): GtoV31Family {
  if (action === 'fold' || action === 'check' || action === 'call') return action;
  if (action === 'bet') return 'bet';
  if (action === 'raise') return frame.currentBet > 0 ? 'raise' : 'bet';
  if (action === 'all_in') {
    const reach = heroReach ?? amount;
    if (frame.toCall > 0 && reach <= frame.currentBet + 1e-9) return 'call';
    return 'all_in';
  }
  return 'check';
}

export function matchActualToPlaybook(
  actual: { action: string; amount: number },
  playbook: Pick<GtoV31HumanPlaybook, 'actions' | 'pot' | 'currentBet' | 'toCall' | 'bigBlind'>,
  heroReach: number | null = null
): GtoV31ActualMatch {
  const family = gtoV31ActualFamily(actual.action, actual.amount, playbook, heroReach);
  const entries = Object.entries(playbook.actions);
  const ofFamily = (f: GtoV31Family) => entries.filter(([, spec]) => spec.family === f);
  let candidates = ofFamily(family);
  // An all-in: the explicit all-in action if the menu has one, else the
  // largest wager of the matching kind with its real amount.
  if (family === 'all_in' && candidates.length === 0) {
    candidates = ofFamily(playbook.currentBet > 0 ? 'raise' : 'bet');
  }
  if (candidates.length === 0) return { family, actionId: null, sizeError: null };
  const target =
    family === 'all_in'
      ? (heroReach ?? actual.amount)
      : Number.isFinite(actual.amount)
        ? actual.amount
        : 0;
  let best: { id: string; err: number | null } | null = null;
  for (const [id, spec] of candidates) {
    const specAmount = gtoV31SpecAmount(spec, playbook);
    const err =
      specAmount === null || target <= 0
        ? null
        : Math.abs(target - specAmount) / Math.max(specAmount, playbook.bigBlind || 1);
    if (
      best === null ||
      (err !== null && (best.err === null || err < best.err - 1e-12)) ||
      (err === null && best.err === null && spec.all_in)
    ) {
      best = { id, err };
    }
  }
  return { family, actionId: best!.id, sizeError: best!.err };
}

/** The highest-probability action; ties break on the action id for stability. */
export function gtoV31ModalAction(distribution: Record<string, number>): string {
  return Object.entries(distribution).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}

function stableSeed(handId: string, ord: number): number {
  return (
    createHash('sha256').update(`v31-human-replay:${handId}:${ord}`).digest().readUInt32BE(0) || 1
  );
}

/** Every recorded postflop horse decision of an NLH no-limit hand. */
export function gtoV31HumanNodes(hand: ExtractedHand): ComplaintAction[] {
  return horseNodes(hand).filter((node) => POSTFLOP.has(node.publicNode?.street ?? node.stage));
}

function heroReachOf(node: ComplaintAction): number | null {
  const pn = node.publicNode!;
  const row = pn.seats.find((s) => s[0] === (pn.actorSeat ?? node.seat));
  return row ? row[1] + row[2] : null;
}

function opponentOf(
  hand: ExtractedHand,
  node: ComplaintAction,
  excluded: ReadonlySet<string>
): Pick<GtoV31HumanDecision, 'opponentSeat' | 'opponentKind'> {
  const pn = node.publicNode!;
  const hero = pn.actorSeat ?? node.seat;
  // HorseLogic.decide's own opponent set: not folded, not the hero, and not
  // sitting out unless all in.
  const live = pn.seats.filter(
    ([seat, , , , , , status]) =>
      seat !== hero && (status & 1) === 0 && ((status & 4) === 0 || (status & 2) !== 0)
  );
  if (live.length !== 1) return { opponentSeat: null, opponentKind: 'multiway' };
  const seat = live[0][0];
  const player = hand.players.find((p) => p.seat === seat);
  if (player?.isHorse) return { opponentSeat: seat, opponentKind: 'horse' };
  return {
    opponentSeat: seat,
    opponentKind: player && excluded.has(player.userId) ? 'excluded_human' : 'human',
  };
}

/**
 * Replay every postflop horse decision of one hand through the engine with
 * the candidate selected. The candidate must already be installed in its
 * evaluation store (replaceGtoPostflopV31Evaluation / Recheck), and this must
 * run in a worker thread: public_hist215_v1 cells answer only off the main
 * thread (GtoPostflopV31.gtoStreetAdviceV31).
 */
export function replayGtoV31HumanHand(
  hand: ExtractedHand,
  datasetChecksum: string,
  specs: GtoV31HumanSpecIndex,
  excludedUserIds: ReadonlySet<string> = new Set()
): GtoV31HumanDecision[] {
  const out: GtoV31HumanDecision[] = [];
  for (const node of gtoV31HumanNodes(hand)) {
    const pn = node.publicNode!;
    if (!Array.isArray(pn.seats) || !Array.isArray(pn.legalActions)) {
      out.push({
        handId: hand.handId,
        ord: node.ord,
        createdAt: hand.createdAt ?? null,
        street: pn.street ?? node.stage,
        seat: pn.actorSeat ?? node.seat,
        mode: pn.mode,
        opponentSeat: null,
        opponentKind: 'unknown',
        heroReach: null,
        status: 'no_snapshot',
        demandCell: null,
        actual: { action: node.action, amount: Number(node.amount) || 0 },
        playbook: null,
      });
      continue;
    }
    const base = {
      handId: hand.handId,
      ord: node.ord,
      createdAt: hand.createdAt ?? null,
      street: pn.street ?? node.stage,
      seat: pn.actorSeat ?? node.seat,
      mode: pn.mode,
      ...opponentOf(hand, node, excludedUserIds),
      heroReach: heroReachOf(node),
      actual: { action: node.action, amount: Number(node.amount) || 0 },
    };
    const variant = pn.variant ?? hand.variant;
    if (variant !== 'nlh' || (pn.structure ?? 'no_limit') !== 'no_limit') {
      out.push({ ...base, status: 'out_of_scope', demandCell: null, playbook: null });
      continue;
    }
    const uid = hand.players.find((p) => p.seat === base.seat)?.userId;
    if (!uid || !Array.isArray(hand.horseHoleCards[uid]) || hand.horseHoleCards[uid].length !== 2) {
      out.push({ ...base, status: 'no_hole_cards', demandCell: null, playbook: null });
      continue;
    }
    let receipt: GtoV31DecisionReceipt | null = null;
    let demand: V31DemandSpot | null = null;
    try {
      const st = stateAt(hand, node);
      const profile = replayProfiles(pn.mode)[0];
      seedFastRandom(stableSeed(hand.handId, node.ord));
      HorseMind.reset();
      HorseLogic.decide(st.hero, st.gs, profile.style, profile.mods, {
        mind: false,
        telemetry: false,
        gtoV31DatasetChecksum: datasetChecksum,
        onV31Demand: (spot: V31DemandSpot) => {
          demand = spot;
        },
        onGtoV31Decision: (r: GtoV31DecisionReceipt) => {
          receipt = r;
        },
      });
    } catch (error) {
      out.push({
        ...base,
        status: 'replay_error',
        demandCell: null,
        playbook: null,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const spot = demand as V31DemandSpot | null;
    const demandCell = spot
      ? (gtoV31DemandCell({
          street: spot.street,
          family: spot.family,
          objective: spot.objective,
          utilityContext: spot.utilityContext,
          tableSize: spot.tableSize,
          potType: spot.potType,
          heroPosition: spot.heroPosition,
          opponentPosition: spot.opponentPosition,
          stackBB: spot.stackBB,
          board: spot.board,
          nodeRole: spot.nodeRole,
          facingKind: spot.facingKind,
          facingSizeBucket: spot.facingSizeBucket,
        })?.key ?? null)
      : null;
    const r = receipt as GtoV31DecisionReceipt | null;
    if (!r) {
      out.push({
        ...base,
        status: spot ? 'cell_miss' : 'not_consulted',
        demandCell,
        playbook: null,
      });
      continue;
    }
    if (r.datasetChecksum !== datasetChecksum) {
      throw new Error(
        `V31 human replay received a receipt for another dataset (${r.datasetChecksum})`
      );
    }
    out.push({
      ...base,
      status: 'covered',
      demandCell: demandCell ?? r.cell,
      playbook: {
        datasetId: r.datasetId,
        datasetChecksum: r.datasetChecksum,
        cell: r.cell,
        handKey: r.handKey,
        hand: r.decisionState.hand,
        nodeRole: r.nodeRole,
        depthBucket: r.decisionState.depthBucket,
        stackBb: r.decisionState.stackBb,
        distribution: { ...r.referenceDistribution },
        actions: actionsOf(r, specs),
        sampledActionId: r.actionId,
        modalActionId: gtoV31ModalAction(r.referenceDistribution),
        policyEvBb: r.policyEvBb,
        actionEvsBb: r.actionEvsBb ? { ...r.actionEvsBb } : null,
        pot: r.decisionState.pot,
        currentBet: r.decisionState.currentBet,
        toCall: r.decisionState.toCall,
        bigBlind: r.decisionState.bigBlind,
      },
    });
  }
  return out;
}

/** The sealed cell coordinates, in one string, from either side: a dataset
 * row (snake_case columns) or a receipt's decisionState. The receipt carries
 * the action ids it sampled from; their specs come from the same sealed row
 * the store was installed from. */
export function gtoV31HumanCellIdentity(c: {
  street: string;
  family: string;
  objective: string;
  utilityContext: string;
  tableSize: number;
  potType: string;
  heroPosition: string;
  opponentPosition: string;
  depthBucket: number;
  textureClass: string;
  nodeRole: string;
  facingKind: string;
  facingSizeBucket: string;
}): string {
  return [
    c.street,
    c.family,
    c.objective,
    c.utilityContext,
    c.tableSize,
    c.potType,
    c.heroPosition,
    c.opponentPosition,
    c.depthBucket,
    c.textureClass,
    c.nodeRole,
    c.facingKind,
    c.facingSizeBucket,
  ].join('|');
}

export type GtoV31HumanSpecIndex = ReadonlyMap<string, Record<string, GtoV31ActionSpec>>;

/** Index the sealed rows' action menus by cell identity. */
export function gtoV31HumanSpecIndex(
  rows: ReadonlyArray<{
    street: string;
    game_family: string;
    objective: string;
    utility_context: string;
    table_size: number;
    pot_type: string;
    hero_position: string;
    opponent_position: string;
    depth_bucket: number;
    texture_class: string;
    node_role: string;
    facing_kind: string;
    facing_size_bucket: string;
    action_specs: Record<string, GtoV31ActionSpec>;
  }>
): GtoV31HumanSpecIndex {
  const index = new Map<string, Record<string, GtoV31ActionSpec>>();
  for (const r of rows) {
    index.set(
      gtoV31HumanCellIdentity({
        street: r.street,
        family: r.game_family,
        objective: r.objective,
        utilityContext: r.utility_context,
        tableSize: Number(r.table_size),
        potType: r.pot_type,
        heroPosition: r.hero_position,
        opponentPosition: r.opponent_position,
        depthBucket: Number(r.depth_bucket),
        textureClass: r.texture_class,
        nodeRole: r.node_role,
        facingKind: r.facing_kind,
        facingSizeBucket: r.facing_size_bucket,
      }),
      r.action_specs
    );
  }
  return index;
}

function actionsOf(
  r: GtoV31DecisionReceipt,
  specs: GtoV31HumanSpecIndex
): Record<string, GtoV31ActionSpec> {
  const s = r.decisionState;
  const menu = specs.get(
    gtoV31HumanCellIdentity({
      street: s.street,
      family: s.gameFamily,
      objective: s.objective,
      utilityContext: s.utilityContext,
      tableSize: s.tableSize,
      potType: s.potType,
      heroPosition: s.heroPosition,
      opponentPosition: s.opponentPosition,
      depthBucket: s.depthBucket,
      textureClass: s.textureClass,
      nodeRole: s.nodeRole,
      facingKind: s.facingKind,
      facingSizeBucket: s.facingSizeBucket,
    })
  );
  if (!menu || !Object.keys(r.referenceDistribution).every((id) => id in menu))
    throw new Error(`V31 human replay has no sealed action menu for cell ${r.cell}`);
  return menu;
}

// ---------------------------------------------------------------------------
// Aggregation (pure).

export interface GtoV31HumanScored {
  decision: GtoV31HumanDecision;
  match: GtoV31ActualMatch;
  modalFamily: GtoV31Family;
  /** modal playbook family equals the family actually played */
  agreeModal: boolean;
  /** the action actually taken matches the playbook's modal action id (family and size) */
  agreeExact: boolean;
  /** playbook probability on the family actually played */
  familyMass: number;
  /** playbook EV of the action actually taken (its own estimate), bb */
  actualEvBb: number | null;
  /** playbook EV of its own mixed policy minus actualEvBb, bb; positive = the
   * playbook believes it would have done better */
  evDeltaBb: number | null;
}

export function scoreGtoV31HumanDecision(decision: GtoV31HumanDecision): GtoV31HumanScored {
  const pb = decision.playbook;
  if (!pb || decision.status !== 'covered') throw new Error('only covered decisions are scored');
  const match = matchActualToPlaybook(decision.actual, pb, decision.heroReach);
  const modalFamily = pb.actions[pb.modalActionId]?.family;
  if (!modalFamily) throw new Error(`modal action ${pb.modalActionId} is not on the menu`);
  const familyOf = (id: string) => pb.actions[id]?.family;
  const familyMass = Object.entries(pb.distribution)
    .filter(
      ([id]) =>
        familyOf(id) === match.family || (match.family === 'all_in' && id === match.actionId)
    )
    .reduce((s, [, p]) => s + p, 0);
  const agreeModal =
    modalFamily === match.family ||
    (match.actionId !== null && match.actionId === pb.modalActionId);
  const actualEv =
    match.actionId !== null && pb.actionEvsBb && typeof pb.actionEvsBb[match.actionId] === 'number'
      ? (pb.actionEvsBb[match.actionId] as number)
      : null;
  const evDeltaBb =
    actualEv !== null && typeof pb.policyEvBb === 'number' && Number.isFinite(pb.policyEvBb)
      ? pb.policyEvBb - actualEv
      : null;
  return {
    decision,
    match,
    modalFamily,
    agreeModal,
    agreeExact: match.actionId !== null && match.actionId === pb.modalActionId,
    familyMass: Math.min(1, familyMass),
    actualEvBb: actualEv,
    evDeltaBb,
  };
}

export interface GtoV31HumanSlice {
  decisions: number;
  hands: number;
  agreeModal: number;
  agreementRate: number | null;
  /** same action id as the playbook's modal action (family and size) */
  exactAgreementRate: number | null;
  /** mean playbook probability on the family actually played */
  expectedAgreement: number | null;
  evEligible: number;
  evDeltaSumBb: number;
  evDeltaMeanBb: number | null;
  /** modal playbook family -> family actually played -> count */
  confusion: Record<string, Record<string, number>>;
  actualFamilies: Record<string, number>;
  playbookModalFamilies: Record<string, number>;
}

function slice(rows: readonly GtoV31HumanScored[]): GtoV31HumanSlice {
  const confusion: Record<string, Record<string, number>> = {};
  const actualFamilies: Record<string, number> = {};
  const playbookModalFamilies: Record<string, number> = {};
  let agree = 0;
  let exact = 0;
  let mass = 0;
  let evN = 0;
  let evSum = 0;
  const hands = new Set<string>();
  for (const r of rows) {
    hands.add(r.decision.handId);
    if (r.agreeModal) agree++;
    if (r.agreeExact) exact++;
    mass += r.familyMass;
    (confusion[r.modalFamily] ??= {})[r.match.family] =
      (confusion[r.modalFamily][r.match.family] ?? 0) + 1;
    actualFamilies[r.match.family] = (actualFamilies[r.match.family] ?? 0) + 1;
    playbookModalFamilies[r.modalFamily] = (playbookModalFamilies[r.modalFamily] ?? 0) + 1;
    if (r.evDeltaBb !== null) {
      evN++;
      evSum += r.evDeltaBb;
    }
  }
  const n = rows.length;
  return {
    decisions: n,
    hands: hands.size,
    agreeModal: agree,
    agreementRate: n ? agree / n : null,
    exactAgreementRate: n ? exact / n : null,
    expectedAgreement: n ? mass / n : null,
    evEligible: evN,
    evDeltaSumBb: round(evSum),
    evDeltaMeanBb: evN ? round(evSum / evN) : null,
    confusion,
    actualFamilies,
    playbookModalFamilies,
  };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export interface GtoV31HumanReplayReport {
  protocol: typeof GTO_V31_HUMAN_REPLAY_PROTOCOL;
  dataset: { id: string; checksum: string; cells: number; state: string };
  generatedAt: string;
  inputs: Record<string, unknown>;
  census: {
    hands: number;
    handsWithDecisions: number;
    decisions: number;
    byStatus: Record<GtoV31HumanStatus, number>;
    coveredByOpponent: Record<string, number>;
  };
  /** Covered decisions against a heads-up person (excluded subjects removed). */
  vsHuman: GtoV31HumanSlice;
  /** Every covered decision, any opponent. */
  allCovered: GtoV31HumanSlice;
  perCell: Array<{ cell: string } & GtoV31HumanSlice & { vsHumanDecisions: number }>;
  /** Demanded cells this dataset does not answer, most requested first. */
  uncoveredDemand: Array<{ cell: string; decisions: number; vsHuman: number }>;
  /**
   * How far each V31 consult (covered or missed) was from the dataset's cell
   * set, at the consult's primary depth: the exact cell exists, or a cell
   * differs only by board texture, only by depth bucket, by both, or by any
   * other coordinate (table size, seats, pot type, node role, family).
   */
  demandDistance: {
    consults: number;
    exactCell: number;
    textureOnly: number;
    depthOnly: number;
    textureAndDepth: number;
    other: number;
  } | null;
  largestDisagreements: Array<{
    handId: string;
    ord: number;
    createdAt: string | null;
    street: string;
    opponentKind: string;
    cell: string;
    hand: string;
    actual: string;
    actualActionId: string | null;
    playbookModal: string;
    playbookDistribution: Record<string, number>;
    policyEvBb: number | null;
    actualEvBb: number | null;
    evDeltaBb: number;
  }>;
  replayErrors: Array<{ handId: string; ord: number; error: string }>;
  caveats: string[];
}

export const GTO_V31_HUMAN_REPLAY_CAVEATS: readonly string[] = [
  'Measurement only. Nothing here gates, certifies, promotes or binds a dataset.',
  'The playbook EVs are its own solver-abstraction estimates for the action menu, not realized results; evDelta = policyEv (the playbook mix) minus the EV the playbook assigns to the action the horse took.',
  'The replay runs HorseLogic.decide with the live hybrid profile of the format, opponent memory off and a fixed seed per decision. Live play had memory on, so a spot the V53 pressure layer handed off from V31 is replayed as a V31 consult; the live horse may also have been routed differently upstream.',
  'Decisions whose horse hole cards were not retained are counted as no_hole_cards and never replayed; cards are never invented.',
  'The public state is HorseComplaintReplay.stateAt over the recorded publicNode snapshot, not the original private worker request.',
  'An actual bet or raise is matched to the nearest playbook size of the same family; an all-in to the menu all-in, else the matching wager family.',
];

/** Classify demanded cell ids against a dataset's cell ids (same pipe-joined
 * coordinate order as gtoV31HumanCellIdentity: depth is field 8, texture 9). */
export function gtoV31DemandDistance(
  demanded: readonly string[],
  datasetCellIds: readonly string[]
): NonNullable<GtoV31HumanReplayReport['demandDistance']> {
  const without = (id: string, drop: readonly number[]) =>
    id
      .split('|')
      .filter((_, i) => !drop.includes(i))
      .join('|');
  const exact = new Set(datasetCellIds);
  const noTexture = new Set(datasetCellIds.map((id) => without(id, [9])));
  const noDepth = new Set(datasetCellIds.map((id) => without(id, [8])));
  const neither = new Set(datasetCellIds.map((id) => without(id, [8, 9])));
  const out = {
    consults: 0,
    exactCell: 0,
    textureOnly: 0,
    depthOnly: 0,
    textureAndDepth: 0,
    other: 0,
  };
  for (const id of demanded) {
    out.consults++;
    if (exact.has(id)) out.exactCell++;
    else if (noTexture.has(without(id, [9]))) out.textureOnly++;
    else if (noDepth.has(without(id, [8]))) out.depthOnly++;
    else if (neither.has(without(id, [8, 9]))) out.textureAndDepth++;
    else out.other++;
  }
  return out;
}

export function summarizeGtoV31HumanReplay(args: {
  decisions: readonly GtoV31HumanDecision[];
  hands: number;
  /** The dataset's cell ids (gtoV31HumanSpecIndex keys), for demandDistance. */
  datasetCellIds?: readonly string[];
  dataset: GtoV31HumanReplayReport['dataset'];
  inputs: Record<string, unknown>;
  generatedAt?: string;
  top?: number;
}): GtoV31HumanReplayReport {
  const { decisions } = args;
  const byStatus: Record<GtoV31HumanStatus, number> = {
    covered: 0,
    cell_miss: 0,
    not_consulted: 0,
    no_hole_cards: 0,
    out_of_scope: 0,
    no_snapshot: 0,
    replay_error: 0,
  };
  const coveredByOpponent: Record<string, number> = {};
  const scored: GtoV31HumanScored[] = [];
  const demand = new Map<string, { decisions: number; vsHuman: number }>();
  for (const d of decisions) {
    byStatus[d.status]++;
    if (d.status === 'cell_miss' && d.demandCell) {
      const e = demand.get(d.demandCell) ?? { decisions: 0, vsHuman: 0 };
      e.decisions++;
      if (d.opponentKind === 'human') e.vsHuman++;
      demand.set(d.demandCell, e);
    }
    if (d.status !== 'covered') continue;
    coveredByOpponent[d.opponentKind] = (coveredByOpponent[d.opponentKind] ?? 0) + 1;
    scored.push(scoreGtoV31HumanDecision(d));
  }
  const vsHumanRows = scored.filter((r) => r.decision.opponentKind === 'human');
  const cells = new Map<string, GtoV31HumanScored[]>();
  for (const r of scored) {
    const c = r.decision.playbook!.cell;
    cells.set(c, [...(cells.get(c) ?? []), r]);
  }
  const perCell = [...cells.entries()]
    .map(([cell, rows]) => ({
      cell,
      ...slice(rows),
      vsHumanDecisions: rows.filter((r) => r.decision.opponentKind === 'human').length,
    }))
    .sort((a, b) => b.decisions - a.decisions || (a.cell < b.cell ? -1 : 1));
  const top = args.top ?? 20;
  const largestDisagreements = scored
    .filter((r) => !r.agreeExact && r.evDeltaBb !== null)
    .sort(
      (a, b) =>
        (b.evDeltaBb as number) - (a.evDeltaBb as number) ||
        (a.decision.handId < b.decision.handId ? -1 : 1) ||
        a.decision.ord - b.decision.ord
    )
    .slice(0, top)
    .map((r) => {
      const pb = r.decision.playbook!;
      return {
        handId: r.decision.handId,
        ord: r.decision.ord,
        createdAt: r.decision.createdAt,
        street: r.decision.street,
        opponentKind: r.decision.opponentKind,
        cell: pb.cell,
        hand: pb.hand,
        actual: `${r.decision.actual.action}${r.decision.actual.amount ? ` ${r.decision.actual.amount}` : ''}`,
        actualActionId: r.match.actionId,
        playbookModal: pb.modalActionId,
        playbookDistribution: pb.distribution,
        policyEvBb: pb.policyEvBb,
        actualEvBb: r.actualEvBb,
        evDeltaBb: round(r.evDeltaBb as number),
      };
    });
  return {
    protocol: GTO_V31_HUMAN_REPLAY_PROTOCOL,
    dataset: args.dataset,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    inputs: args.inputs,
    census: {
      hands: args.hands,
      handsWithDecisions: new Set(decisions.map((d) => d.handId)).size,
      decisions: decisions.length,
      byStatus,
      coveredByOpponent,
    },
    vsHuman: slice(vsHumanRows),
    allCovered: slice(scored),
    perCell,
    uncoveredDemand: [...demand.entries()]
      .map(([cell, v]) => ({ cell, ...v }))
      .sort((a, b) => b.decisions - a.decisions || (a.cell < b.cell ? -1 : 1))
      .slice(0, 50),
    largestDisagreements,
    demandDistance: args.datasetCellIds
      ? gtoV31DemandDistance(
          decisions
            .filter((d) => (d.status === 'covered' || d.status === 'cell_miss') && d.demandCell)
            .map((d) => d.demandCell as string),
          args.datasetCellIds
        )
      : null,
    replayErrors: decisions
      .filter((d) => d.status === 'replay_error')
      .slice(0, 50)
      .map((d) => ({ handId: d.handId, ord: d.ord, error: d.error ?? '' })),
    caveats: [...GTO_V31_HUMAN_REPLAY_CAVEATS],
  };
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const bb = (x: number | null) => (x === null ? 'n/a' : `${x >= 0 ? '+' : ''}${x.toFixed(2)} bb`);

export function renderGtoV31HumanReplayMarkdown(report: GtoV31HumanReplayReport): string {
  const c = report.census;
  const h = report.vsHuman;
  const a = report.allCovered;
  const lines: string[] = [
    `# V31 human replay: dataset ${report.dataset.id}`,
    '',
    `Dataset checksum \`${report.dataset.checksum}\` (${report.dataset.cells} cells, state ${report.dataset.state}). Generated ${report.generatedAt}. Measurement only, not a gate.`,
    '',
    '## Census',
    '',
    `- Hands read: ${c.hands}; postflop horse decisions: ${c.decisions} in ${c.handsWithDecisions} hands.`,
    `- Status: ${Object.entries(c.byStatus)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}.`,
    `- Covered by opponent: ${
      Object.entries(c.coveredByOpponent)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || 'none'
    }.`,
    '',
    '## Headline',
    '',
    '| slice | decisions | hands | modal-family agreement | exact-action agreement | expected agreement | EV-eligible | sum EV delta | mean EV delta |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    `| vs a person (heads-up) | ${h.decisions} | ${h.hands} | ${pct(h.agreementRate)} | ${pct(h.exactAgreementRate)} | ${pct(h.expectedAgreement)} | ${h.evEligible} | ${bb(h.evDeltaSumBb)} | ${bb(h.evDeltaMeanBb)} |`,
    `| every covered decision | ${a.decisions} | ${a.hands} | ${pct(a.agreementRate)} | ${pct(a.exactAgreementRate)} | ${pct(a.expectedAgreement)} | ${a.evEligible} | ${bb(a.evDeltaSumBb)} | ${bb(a.evDeltaMeanBb)} |`,
    '',
    'EV delta = the playbook mix EV minus the playbook EV of the action the horse took (playbook estimate, bb). Positive means the playbook believes it would have done better.',
    '',
    '## Playbook modal family vs action taken (vs a person)',
    '',
  ];
  const fams = ['fold', 'check', 'call', 'bet', 'raise', 'all_in'];
  lines.push(
    `| playbook \\ actual | ${fams.join(' | ')} |`,
    `| --- |${fams.map(() => ' --- |').join('')}`
  );
  for (const f of fams) {
    const row = h.confusion[f];
    if (!row) continue;
    lines.push(`| ${f} | ${fams.map((g) => row[g] ?? 0).join(' | ')} |`);
  }
  lines.push('', '## Cells (top 25 by covered decisions)', '');
  lines.push(
    '| cell | decisions | vs person | agreement | sum EV delta |',
    '| --- | --- | --- | --- | --- |'
  );
  for (const cell of report.perCell.slice(0, 25)) {
    lines.push(
      `| \`${cell.cell.replaceAll('|', '/')}\` | ${cell.decisions} | ${cell.vsHumanDecisions} | ${pct(cell.agreementRate)} | ${bb(cell.evDeltaSumBb)} |`
    );
  }
  lines.push(
    '',
    `## ${report.largestDisagreements.length} largest disagreements (action taken is not the playbook's modal action; by EV delta)`,
    ''
  );
  lines.push(
    '| hand | ord | street | opp | hand class | actual | playbook modal | EV delta |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const d of report.largestDisagreements) {
    lines.push(
      `| ${d.handId} | ${d.ord} | ${d.street} | ${d.opponentKind} | ${d.hand} | ${d.actual} (${d.actualActionId ?? '-'}) | ${d.playbookModal} | ${bb(d.evDeltaBb)} |`
    );
  }
  const dd = report.demandDistance;
  if (dd) {
    lines.push(
      '',
      '## How close the consults came to this cell set',
      '',
      `Of ${dd.consults} V31 consults (primary depth): exact cell ${dd.exactCell}, only the texture differs ${dd.textureOnly}, only the depth differs ${dd.depthOnly}, texture and depth differ ${dd.textureAndDepth}, another coordinate differs ${dd.other}.`
    );
  }
  if (report.uncoveredDemand.length) {
    lines.push('', '## Most-demanded cells this dataset does not answer (top 10)', '');
    for (const u of report.uncoveredDemand.slice(0, 10))
      lines.push(
        `- \`${u.cell.replaceAll('|', '/')}\`: ${u.decisions} decisions (${u.vsHuman} vs a person)`
      );
  }
  lines.push('', '## Caveats', '', ...report.caveats.map((x) => `- ${x}`), '');
  return lines.join('\n');
}
