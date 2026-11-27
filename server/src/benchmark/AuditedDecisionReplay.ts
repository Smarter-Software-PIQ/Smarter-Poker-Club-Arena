/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUDITED DECISION REPLAY SCORER (2026-11-18, PLO Horse lanes)
 * ═══════════════════════════════════════════════════════════════════════════
 * An option that changes a Horse decision is replayed on the real decisions
 * the audits judged: each decision is re-decided with the option off (the
 * base arm) and on (one arm per option or option set), and the result is read
 * against the audit's own verdict. Until now every lane wrote that join as a
 * scratch script that zipped two lists by position, so one skipped record
 * shifted every verdict after it. This module is the one committed scorer:
 *
 *  - The join is BY DECISION NODE, never by position: a node is
 *    (hand, seat, street, k), k = the 0-based index of that seat's own
 *    voluntary decision (origin horse_policy: fold, check, call, bet, raise,
 *    all_in) on that street of that hand. An audited decision without a
 *    replay row, a replay row without an audited decision, and a replay row
 *    whose base arm does not reproduce the recorded action are counted and
 *    listed, never matched to a neighbour.
 *  - Two audit sources are read in their own published formats:
 *    audit2 (PLO5-WOOWOO-AUDIT-PART2 decisions.csv + the audit's hands.jsonl,
 *    which places each row at its node), and the WooWoo 48 h audit
 *    (decision-audit/decisions-full.csv + spec/decision-to-finding.csv).
 *    A third source, `placed` (2026-11-20), reads audited decisions another
 *    tool already placed at their node (one JSON line each; placedDecisions):
 *    the six HVH48 audits (PLO5 Lightning, PLO4/PLO5 table, PLO6, Hold'em
 *    cash, Hold'em and PLO tournaments) each publish their own columns, and
 *    scripts/hvh48-audit-nodes.py places their rows. It is scored
 *    verdict-only, and where the audit names the better action a change
 *    counts as fixed only when it is a change to that action.
 *  - audit2 has an action-level judge (its analyze.py rules, ported below as
 *    judgeAudit2): the base and the replayed action are each judged, so a
 *    change is fixed (bad -> ok), newly wrong (ok -> bad), still wrong or
 *    ok -> ok, and the audit's EV model prices it in bb where it can.
 *    The WooWoo audit declares no EV ("No solver, no EV", its METHOD.md): it
 *    is scored verdict-only. A change away from an action it judged wrong or
 *    questionable counts as fixed (verdict-only), a change away from an action
 *    it judged correct or acceptable_close as newly wrong (verdict-only); no
 *    bb is claimed for it.
 *  - A third source since 2026-11-20: the PLO6 audit set (HVH48 auditor C,
 *    six-card Omaha), read by plo6Decisions from its own three files
 *    (decisions.csv, meta.jsonl, hands.jsonl), each row placed at exactly one
 *    action of the hand, and scored verdict-only by the WooWoo rule.
 *  - A fourth source since 2026-11-20: `placed` (placedDecisions), reading
 *    audited decisions another tool already placed at their node (one JSON line
 *    each; scripts/hvh48-audit-nodes.py writes them for the six HVH48 sets).
 *    Scored verdict-only, and where the audit names the better action a change
 *    counts as fixed only when it is a change to that action.
 *  - SIZE-AWARE placed nodes (2026-11-27): a placed line may carry sizeBand {min, max}, the amounts of the recorded
 *    bet or raise the audit judges CORRECT (in the replay rows' amount unit). A resize (same kind, another amount) is
 *    then judged in or out of the band and counted as a change (fixed, newly wrong, still wrong, ok to ok; also
 *    resizeJudged). Without a band a resize stays unchanged, exactly as before. The band is the audit's model: the PLO
 *    hand audit prices a postflop raise with one size-independent fold rate, so read it with that limit. A placed line
 *    may also carry equivalent [kinds]: kinds the audit prices as the recorded action (a raise over an opponent who is
 *    already all in is a call); a change to one keeps the recorded verdict (ok to ok or still wrong).
 *  - Every count is also split per rule receipt the replayed arm carried
 *    (the per-decision rule receipts of BrainTelemetry.noteDecisionRuleReceipt
 *    or the decision's fired receipt keys), so a reviewer sees which rule made
 *    each fix and each new mistake.
 *
 *  - AN ARM MUST BE THE OPTION SET IT IS NAMED FOR (2026-11-19). A journaled
 *    option set replayed on today's source is refused whole by the registry
 *    when it names an option that is off-only or unregistered today
 *    (HorseOptionSwitch.optionSwitchStatesFrom): nothing is switched, every
 *    arm plays the release defaults and the "result" is four identical arms.
 *    replayValidity reads the option set each arm declares and compares each
 *    arm with the base; replayRefusals turns an invalid set, an arm identical
 *    to the base, or (for an authority row) an undeclared set into a refusal.
 *    The CLI exits non-zero on any of them and scores nothing.
 *  - The machine-read Replay row of an option authority file
 *    (docs/horse-option-authority.d/<option>.md) is written and parsed here
 *    (replayBarRows, parseReplayBarRows), one format for the scorer and the
 *    law that reads it (engine/EveryHorseOptionRecordsItsReplay.law.test.ts).
 *
 * It decides nothing and reads no production data by itself: the CLI
 * (server/scripts/audited-decision-replay.ts) is pointed at local evidence
 * files. Tests use synthetic, anonymized rows in the real formats.
 */

import {
  OPTION_SWITCH_PLAIN_NAMES,
  optionSwitchOffOnly,
  optionSwitchRefusal,
  optionSwitchStatesFrom,
  optionSwitchUnknownNames,
  optionSwitchStatesOf,
} from '../engine/HorseOptionSwitch.js';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];
export const VOLUNTARY_ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);

/** One decision of one seat: hand, seat, street and the seat's own decision index on that street. */
export interface DecisionNode {
  hand: string;
  seat: number;
  street: Street;
  k: number;
}
export const nodeKey = (n: DecisionNode): string => `${n.hand}:${n.seat}:${n.street}:${n.k}`;

export type VerdictClass = 'bad' | 'ok' | 'unjudged';
/** The audit sets the scorer reads. Only audit2 has an action-level judge; the others are scored verdict-only. */
export type AuditSource = 'audit2' | 'woowoo' | 'plo6' | 'placed';

/** The inputs of the audit2 judge (columns of its decisions.csv; chips unless named _bb). */
export interface Audit2JudgeInputs {
  type: string;
  pot: number;
  tc: number;
  price: number | null;
  nlive: number;
  ip: boolean;
  cat: string;
  eqR: number | null;
  evbBb: number | null;
  evcBb: number | null;
  bb: number;
  /** Hole cards as the audit wrote them ("As Ah 5d ..."), used only by the preflop re-raise AA test. */
  hero: string;
}

export interface AuditedDecision {
  node: DecisionNode;
  source: AuditSource;
  /** plo6: the audit's own decision id and the index of the action in the hand's actions array (for the harness). */
  at?: { id: string; actionIndex: number };
  recorded: { action: string; amount: number | null };
  /** The audit's verdict word as written, and its class. */
  verdict: string;
  cls: VerdictClass;
  finding?: string;
  judge?: Audit2JudgeInputs;
  /**
   * placed only: the action kinds the audit names as better than the recorded one. With it, a change away from a
   * judged-bad action is fixed only when it is a change to one of these; any other change is still wrong.
   */
  better?: readonly string[];
  /**
   * placed only (2026-11-27): the amounts of the recorded action kind the audit judges CORRECT, in the replay rows'
   * amount unit (the harness's: big blinds, the street total a raise goes to). With it a RESIZE (same kind, another
   * amount) is judged: in the band ok, outside bad, so a resized raise can be fixed or newly wrong. Without it a resize
   * is unchanged, as before (verdict-only reads action kinds only).
   */
  sizeBand?: { min: number; max: number };
  /**
   * placed only (2026-11-27): action kinds the audit prices as the SAME action as the recorded one, e.g. a raise over
   * an opponent who is already all in, which the audit prices as a call (nobody can put another chip in). A change to
   * one of them keeps the recorded action's verdict (ok to ok, or still wrong), never fixed or newly wrong.
   */
  equivalent?: readonly string[];
}

export interface ReplayArm {
  action: string;
  amount?: number | null;
  legal?: boolean;
  refusal?: boolean;
  receipts?: readonly string[];
  error?: string;
  /**
   * The option-switch set the harness handed the brain for this arm at this node ({option: 'on' | 'off'}), after
   * any sanitizing. Read by replayValidity: a set today's registry refuses switches nothing (an inert arm).
   */
  options?: Readonly<Record<string, unknown>>;
}
export interface ReplayRow extends DecisionNode {
  arms: Record<string, ReplayArm>;
}

// ── CSV (RFC 4180: quotes, doubled quotes, newlines inside quotes) ─────────
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0];
  return nonEmpty.slice(1).map((r) => {
    if (r.length !== header.length)
      throw new Error(
        `csv row has ${r.length} fields, header has ${header.length}: ${r.join(',')}`
      );
    const o: Record<string, string> = {};
    header.forEach((h, j) => (o[h] = r[j]));
    return o;
  });
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
const isStreet = (s: string): s is Street => (STREETS as readonly string[]).includes(s);

// ── audit2 ─────────────────────────────────────────────────────────────────
interface Audit2HandAction {
  a: string;
  o?: string | null;
  st: string;
  amt?: number | string | null;
  seat: number | string;
  toCall?: number | string | null;
}
interface Audit2Hand {
  hand_number: number | string;
  big_blind: number | string;
  players: { seat: number | string; name: string }[];
  actions: Audit2HandAction[];
}

/** A decision row of audit2 faces a bet (its type) — the same split the audit made. */
const audit2RowFaces = (type: string): boolean =>
  type.startsWith('face_') || type.startsWith('pf_face_') || type === 'raise_other';
/** The audit wrote an all-in as the kind it amounted to (raise, call or bet). */
const audit2KindMatches = (kind: string, action: string): boolean =>
  action === 'all_in' ? kind === 'raise' || kind === 'call' || kind === 'bet' : kind === action;

export interface AdapterResult {
  decisions: AuditedDecision[];
  /** Audit rows no node could be found for (hand missing from the hands file, or no matching action); plo6
   * puts the audit's decision id in `name`, and lists a row whose verdict it cannot map. */
  unplaced: { row: number; hand: string; name: string; street: string; reason: string }[];
  /** audit2: rows placed where more than one decision matched and the amount to call did not single one out
   * (placed at the first in order). */
  ambiguous?: number;
}

/**
 * audit2: decisions.csv rows placed at their node by walking each hand's action list. A row of
 * (hand, name, street) takes the not-yet-used horse_policy decision of that seat on that street that faces
 * a bet exactly when the row's type does, whose action is the row's kind and, when several do, whose amount
 * to call is the row's (else the first in order, counted as ambiguous).
 */
export function audit2Decisions(decisionsCsv: string, handsJsonl: string): AdapterResult {
  const hands = new Map<string, Audit2Hand>();
  for (const line of handsJsonl.split('\n')) {
    if (!line.trim()) continue;
    const h = JSON.parse(line) as Audit2Hand;
    hands.set(String(h.hand_number), h);
  }
  const rows = parseCsv(decisionsCsv);
  const decisions: AuditedDecision[] = [];
  const unplaced: AdapterResult['unplaced'] = [];
  let loose = 0;
  // Per hand: the voluntary horse_policy decisions as nodes, in order.
  const nodesOf = new Map<
    string,
    {
      node: DecisionNode;
      name: string;
      faces: boolean;
      toCall: number | null;
      action: string;
      amount: number | null;
      used: boolean;
    }[]
  >();
  const nodesFor = (hand: Audit2Hand) => {
    const key = String(hand.hand_number);
    const cached = nodesOf.get(key);
    if (cached) return cached;
    const nameOf = new Map(hand.players.map((p) => [Number(p.seat), p.name]));
    const k = new Map<string, number>();
    const list: NonNullable<ReturnType<typeof nodesOf.get>> = [];
    for (const a of hand.actions) {
      if (a.o !== 'horse_policy' || !VOLUNTARY_ACTIONS.has(a.a) || !isStreet(a.st)) continue;
      const seat = Number(a.seat);
      const ks = `${seat}:${a.st}`;
      const idx = k.get(ks) ?? 0;
      k.set(ks, idx + 1);
      list.push({
        node: { hand: key, seat, street: a.st, k: idx },
        name: nameOf.get(seat) ?? '',
        faces: (num(String(a.toCall ?? '')) ?? 0) > 0,
        toCall: num(String(a.toCall ?? '')),
        action: a.a,
        amount: num(String(a.amt ?? '')),
        used: false,
      });
    }
    nodesOf.set(key, list);
    return list;
  };
  rows.forEach((r, i) => {
    const hand = hands.get(r.hand);
    if (!hand) {
      unplaced.push({
        row: i + 2,
        hand: r.hand,
        name: r.name,
        street: r.st,
        reason: 'hand not in hands file',
      });
      return;
    }
    const candidates = nodesFor(hand).filter(
      (n) =>
        !n.used &&
        n.name === r.name &&
        n.node.street === r.st &&
        n.faces === audit2RowFaces(r.type) &&
        audit2KindMatches(r.kind, n.action)
    );
    // Two decisions of one seat on one street can share the facing flag and the action (a call of a
    // Horse's bet, then a call of the human's raise): the amount to call the audit recorded decides.
    const tc = num(r.tc);
    const byPrice =
      tc !== null && tc > 0
        ? candidates.filter((n) => n.toCall !== null && Math.abs(n.toCall - tc) < 0.005)
        : [];
    const slot = byPrice[0] ?? candidates[0];
    if (slot && candidates.length > 1 && byPrice.length !== 1) loose++;
    if (!slot) {
      unplaced.push({
        row: i + 2,
        hand: r.hand,
        name: r.name,
        street: r.st,
        reason: 'no matching action',
      });
      return;
    }
    slot.used = true;
    const v = r.verdict;
    decisions.push({
      node: slot.node,
      source: 'audit2',
      recorded: { action: slot.action, amount: slot.amount },
      verdict: v,
      cls: v === 'wrong' ? 'bad' : v === 'right' ? 'ok' : 'unjudged',
      finding: r.cause || undefined,
      judge: {
        type: r.type,
        pot: num(r.pot) ?? 0,
        tc: num(r.tc) ?? 0,
        price: num(r.price),
        nlive: num(r.nlive) ?? 2,
        ip: r.ip === 'True' || r.ip === 'true',
        cat: r.cat,
        eqR: num(r.eqR),
        evbBb: num(r.evb_bb),
        evcBb: num(r.evc_bb),
        bb: num(String(hand.big_blind)) ?? 0,
        hero: r.hero ?? '',
      },
    });
  });
  return { decisions, unplaced, ambiguous: loose };
}

/** audit2's realization by (street, in position) — analyze.py REAL. */
const AUDIT2_REAL: Record<string, number> = {
  'flop:true': 0.82,
  'flop:false': 0.7,
  'turn:true': 0.9,
  'turn:false': 0.8,
  'river:true': 1.0,
  'river:false': 1.0,
};
const AGGRESSIVE = new Set(['bet', 'raise', 'all_in']);

/**
 * The audit2 judge (audit2-01BNteGZ analyze.py) applied to any action at the audited node: its class and,
 * where the audit's model prices it, its EV in bb (fold facing a bet = 0; call = realized equity x pot after
 * the call - the call; check after his check = evc; bet = evb at the audit's own bet size). A raise is
 * judged by the audit's equity bar and not priced. Anything the audit did not judge is unjudged.
 */
export function judgeAudit2(
  j: Audit2JudgeInputs,
  street: Street,
  action: string,
  amount: number | null
): { cls: VerdictClass; evBb: number | null } {
  const U = { cls: 'unjudged' as VerdictClass, evBb: null };
  if (!(j.bb > 0)) return U;
  if (j.type.startsWith('pf_face_')) {
    if (j.eqR === null || !j.price) return U;
    const eff = j.eqR * (j.ip ? 0.85 : 0.7);
    if (action === 'fold') return { cls: eff > j.price + 0.08 ? 'bad' : 'ok', evBb: 0 };
    if (action === 'call')
      return {
        cls: eff < j.price - 0.05 ? 'bad' : 'ok',
        evBb: (eff * (j.pot + j.tc) - j.tc) / j.bb,
      };
    if (AGGRESSIVE.has(action)) {
      const aces = j.hero.split(/\s+/).filter((c) => c.startsWith('A')).length >= 2;
      return { cls: !aces && j.eqR < 0.5 ? 'bad' : 'ok', evBb: null };
    }
    return U;
  }
  if (street === 'preflop') return U;
  if (j.type === 'face_bet' || j.type === 'face_raise') {
    if (j.eqR === null || !j.price) return U;
    let real =
      (AUDIT2_REAL[`${street}:${j.ip}`] ?? 1) * (j.nlive > 2 && street !== 'river' ? 0.9 : 1);
    if (j.cat === 'SD') real = Math.min(1, real + 0.12);
    const eff = j.eqR * real;
    if (action === 'fold') return { cls: eff > j.price + 0.08 ? 'bad' : 'ok', evBb: 0 };
    if (action === 'call')
      return {
        cls: eff < j.price - 0.05 ? 'bad' : 'ok',
        evBb: (eff * (j.pot + j.tc) - j.tc) / j.bb,
      };
    if (AGGRESSIVE.has(action))
      return { cls: j.eqR < 0.4 && j.cat !== 'SD' ? 'bad' : 'ok', evBb: null };
    return U;
  }
  if (j.type === 'checked_to' || j.type === 'lead') {
    if (j.evbBb === null || j.evcBb === null) return U;
    const potBb = j.pot / j.bb;
    if (action === 'check')
      return { cls: j.evbBb > j.evcBb + 0.15 * potBb ? 'bad' : 'ok', evBb: j.evcBb };
    if (AGGRESSIVE.has(action)) {
      const tiny = j.pot >= 4 * j.bb && amount !== null && amount < 0.25 * j.pot;
      return { cls: tiny || j.evbBb < j.evcBb - 0.1 * potBb ? 'bad' : 'ok', evBb: j.evbBb };
    }
    return U;
  }
  return U;
}

// ── WooWoo 48 h audit ──────────────────────────────────────────────────────
const WOOWOO_BAD = new Set(['wrong', 'questionable']);
const WOOWOO_OK = new Set(['correct', 'acceptable_close']);

/**
 * WooWoo audit: decisions-full.csv (hand_number, dec_idx, seat, street, action, amount) joined to
 * decision-to-finding.csv (hand, d = dec_idx). k orders a seat's decisions on a street by dec_idx.
 */
export function wooWooDecisions(decisionsFullCsv: string, findingsCsv: string): AdapterResult {
  const findings = new Map<string, Record<string, string>>();
  for (const f of parseCsv(findingsCsv)) findings.set(`${f.hand}#${f.d}`, f);
  const rows = parseCsv(decisionsFullCsv)
    .map((r, i) => ({ r, line: i + 2 }))
    .sort(
      (a, b) =>
        a.r.hand_number.localeCompare(b.r.hand_number) || Number(a.r.dec_idx) - Number(b.r.dec_idx)
    );
  const k = new Map<string, number>();
  const decisions: AuditedDecision[] = [];
  const unplaced: AdapterResult['unplaced'] = [];
  for (const { r, line } of rows) {
    if (!isStreet(r.street) || !VOLUNTARY_ACTIONS.has(r.action)) {
      unplaced.push({
        row: line,
        hand: r.hand_number,
        name: r.name,
        street: r.street,
        reason: 'not a voluntary decision',
      });
      continue;
    }
    const seat = Number(r.seat);
    const ks = `${r.hand_number}:${seat}:${r.street}`;
    const idx = k.get(ks) ?? 0;
    k.set(ks, idx + 1);
    const f = findings.get(`${r.hand_number}#${r.dec_idx}`);
    const v = f?.verdict ?? '';
    decisions.push({
      node: { hand: r.hand_number, seat, street: r.street, k: idx },
      source: 'woowoo',
      recorded: { action: r.action, amount: num(r.amount) },
      verdict: v,
      cls: WOOWOO_BAD.has(v) ? 'bad' : WOOWOO_OK.has(v) ? 'ok' : 'unjudged',
      finding: f?.finding_id,
    });
  }
  return { decisions, unplaced };
}

// ── PLO6 audit set (HVH48 auditor C, six-card Omaha) ───────────────────────
/**
 * The PLO6 audit set (HVH48 auditor C; docs/horse-option-authority.d/plo6FacingBetIsPriced.md) is three files,
 * read in their own layout:
 *
 *   decisions.csv  one row per audited Horse decision. Read: id ("d<n>"), hand (the hand_history id), street,
 *                  action, status (priced | unpriced), severity (CLEAR | LIKELY | DEBATABLE | empty), mistake (the
 *                  class word, e.g. POTODDS-FOLD, or empty; kept as the finding). It has no seat and no action
 *                  ordinal, and its `horse` column is a profile name that does not match the hand's players.
 *   meta.jsonl     one object per audited decision; the object with n = N is decision "dN". Read: n, hand,
 *                  street, act, seat, t (the action's timestamp).
 *   hands.jsonl    raw hand_history rows. Read: id, game_variant and actions[].{action, amount, origin, seat,
 *                  stage, timestamp}. The actions carry no ordinal.
 *
 * NO CARD IS READ OR KEPT. The csv's hole and board columns, meta's hole, board and humans, and the hands'
 * players[].cards, hole_cards and community_cards are never read: the parsed rows are dropped as soon as the
 * listed fields are taken, and nothing else enters a decision, a node, a report or a Replay row (the card
 * firewall of this programme: cards are for the audit's offline scoring, not here).
 *
 * Placement (each refusal is listed with its reason, never placed at a neighbour): for decision dN take meta
 * row N; it must exist and agree with the csv on hand, street and action; the hand must be in hands.jsonl and be
 * plo6; in its actions exactly one must have seat = meta.seat, stage = meta.street, timestamp = meta.t,
 * action = meta.act and origin horse_policy. The node is (hand id, seat, street, k), k counted as audit2 counts
 * it: the seat's 0-based index among its voluntary horse_policy actions on that street, in the actions' order.
 *
 * Verdict mapping (the coordinator's decision of 2026-11-20, not an inference of the scorer):
 *   priced, severity CLEAR or LIKELY             -> bad (the auditor flagged a mistake)
 *   priced, mistake empty and severity empty     -> ok  (the auditor priced it and found no mistake)
 *   priced, severity DEBATABLE                   -> unjudged
 *   unpriced                                     -> unjudged
 *   any other combination                        -> not placed, listed with its reason
 * Scoring is verdict-only, the WooWoo rule: a change away from a bad action is fixed, away from an ok action
 * newly wrong, anything else unjudged; no bb is claimed (the auditor's pricing is not ported as a judge).
 */
export const PLO6_AUDIT_COLUMNS = [
  'id',
  'hand',
  'street',
  'action',
  'status',
  'severity',
  'mistake',
] as const;

/** The class of one PLO6 audit row, or the reason it cannot be mapped. */
export function plo6VerdictClass(
  status: string,
  severity: string,
  mistake: string
): { cls: VerdictClass } | { refusal: string } {
  if (status === 'unpriced') return { cls: 'unjudged' };
  if (status !== 'priced') return { refusal: `status "${status}" is not priced or unpriced` };
  if (severity === 'CLEAR' || severity === 'LIKELY') return { cls: 'bad' };
  if (severity === 'DEBATABLE') return { cls: 'unjudged' };
  if (severity === '' && mistake === '') return { cls: 'ok' };
  return {
    refusal: `priced with severity "${severity}" and mistake "${mistake}" maps to no verdict`,
  };
}

interface Plo6Meta {
  hand: string;
  street: string;
  act: string;
  seat: number;
  t: string;
}
interface Plo6Action {
  action: string;
  amount: number | null;
  origin: string;
  seat: number;
  stage: string;
  timestamp: string;
}

const scalar = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : '';

export function plo6Decisions(
  decisionsCsv: string,
  metaJsonl: string,
  handsJsonl: string
): AdapterResult {
  const header = (decisionsCsv.split(/\r?\n/).find((l) => l.trim() !== '') ?? '').split(',');
  const missing = PLO6_AUDIT_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`plo6 decisions csv: the header lacks ${missing.join(', ')}`);

  // meta.jsonl: only n, hand, street, act, seat and t are taken from each object.
  const meta = new Map<number, Plo6Meta>();
  metaJsonl.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const o = JSON.parse(line) as Record<string, unknown>;
    const n = o.n;
    if (typeof n !== 'number' || !Number.isInteger(n))
      throw new Error(`plo6 meta line ${i + 1}: needs a whole-number n`);
    if (meta.has(n)) throw new Error(`plo6 meta line ${i + 1}: n ${n} is given twice`);
    meta.set(n, {
      hand: scalar(o.hand),
      street: scalar(o.street),
      act: scalar(o.act),
      seat: Number(o.seat),
      t: scalar(o.t),
    });
  });

  // hands.jsonl: only id, game_variant and the six action fields are taken.
  const hands = new Map<string, { variant: string; actions: Plo6Action[] }>();
  handsJsonl.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const o = JSON.parse(line) as Record<string, unknown>;
    const id = scalar(o.id);
    if (!id || !Array.isArray(o.actions))
      throw new Error(`plo6 hands line ${i + 1}: needs id and actions`);
    if (hands.has(id)) throw new Error(`plo6 hands line ${i + 1}: hand ${id} is given twice`);
    hands.set(id, {
      variant: scalar(o.game_variant),
      actions: (o.actions as Record<string, unknown>[]).map((a) => ({
        action: scalar(a.action),
        amount: num(scalar(a.amount)),
        origin: scalar(a.origin),
        seat: Number(a.seat),
        stage: scalar(a.stage),
        timestamp: scalar(a.timestamp),
      })),
    });
  });

  /** Per hand: actions array index -> k of a voluntary horse_policy action (counted as audit2 counts it). */
  const kOf = new Map<string, Map<number, number>>();
  const ksFor = (handId: string, actions: Plo6Action[]) => {
    let m = kOf.get(handId);
    if (m) return m;
    m = new Map();
    const next = new Map<string, number>();
    actions.forEach((a, idx) => {
      if (a.origin !== 'horse_policy' || !VOLUNTARY_ACTIONS.has(a.action) || !isStreet(a.stage))
        return;
      const key = `${a.seat}:${a.stage}`;
      const k = next.get(key) ?? 0;
      next.set(key, k + 1);
      m!.set(idx, k);
    });
    kOf.set(handId, m);
    return m;
  };

  const decisions: AuditedDecision[] = [];
  const unplaced: AdapterResult['unplaced'] = [];
  const taken = new Map<string, number>();
  parseCsv(decisionsCsv).forEach((full, i) => {
    // Take the listed columns and drop the parsed row: no other column (cards included) goes further.
    const r = {
      id: full.id.trim(),
      hand: full.hand.trim(),
      street: full.street,
      action: full.action,
      status: full.status,
      severity: full.severity,
      mistake: full.mistake,
    };
    const row = i + 2;
    const refuse = (reason: string) =>
      unplaced.push({ row, hand: r.hand, name: r.id, street: r.street, reason });
    const idm = /^d(\d+)$/.exec(r.id);
    if (!idm) return refuse(`id "${r.id}" is not d<n>`);
    const verdict = plo6VerdictClass(r.status, r.severity, r.mistake);
    if ('refusal' in verdict) return refuse(verdict.refusal);
    const m = meta.get(Number(idm[1]));
    if (!m) return refuse(`no meta row n = ${idm[1]}`);
    if (m.hand !== r.hand) return refuse(`meta hand ${m.hand} is not the csv hand`);
    if (m.street !== r.street)
      return refuse(`meta street ${m.street} is not the csv street ${r.street}`);
    if (m.act !== r.action) return refuse(`meta action ${m.act} is not the csv action ${r.action}`);
    if (!isStreet(r.street) || !VOLUNTARY_ACTIONS.has(r.action))
      return refuse(`${r.street} ${r.action} is not a voluntary decision on a street`);
    const hand = hands.get(r.hand);
    if (!hand) return refuse('hand not in hands file');
    if (hand.variant !== 'plo6')
      return refuse(`hand is not plo6 (game_variant ${hand.variant || 'not stated'})`);
    const matches: number[] = [];
    hand.actions.forEach((a, idx) => {
      if (
        a.origin === 'horse_policy' &&
        a.seat === m.seat &&
        a.stage === m.street &&
        a.timestamp === m.t &&
        a.action === m.act
      )
        matches.push(idx);
    });
    if (matches.length !== 1)
      return refuse(
        `${matches.length === 0 ? 'no' : matches.length} horse_policy actions match seat ${m.seat}, ${m.street}, ${m.act} at ${m.t}`
      );
    const actionIndex = matches[0];
    const k = ksFor(r.hand, hand.actions).get(actionIndex)!;
    const node: DecisionNode = { hand: r.hand, seat: m.seat, street: r.street, k };
    const key = nodeKey(node);
    const first = taken.get(key);
    if (first !== undefined) return refuse(`the node is already audited by row ${first}`);
    taken.set(key, row);
    decisions.push({
      node,
      source: 'plo6',
      at: { id: r.id, actionIndex },
      recorded: { action: r.action, amount: hand.actions[actionIndex].amount },
      verdict: [r.status, r.severity].filter(Boolean).join(' '),
      cls: verdict.cls,
      finding: r.mistake || undefined,
    });
  });
  return { decisions, unplaced };
}

// ── audited decisions already placed at their node ─────────────────────────
/**
 * placed: one JSON line per audited decision, {hand, seat, street, k, recorded: {action, amount}, verdict,
 * cls: 'bad' | 'ok' | 'unjudged', better?: [action kinds], finding?}. The tool that wrote the line placed the
 * audit's row at its node and states the class rule it used; a line that is not a node, repeats a node or
 * carries an unknown class is listed as not placed, never guessed.
 */
export function placedDecisions(nodesJsonl: string): AdapterResult {
  const decisions: AuditedDecision[] = [];
  const unplaced: AdapterResult['unplaced'] = [];
  const seen = new Set<string>();
  nodesJsonl.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const o = JSON.parse(line) as Record<string, unknown>;
    const rec = (o.recorded ?? {}) as { action?: unknown; amount?: unknown };
    const street = String(o.street ?? '');
    const refuse = (reason: string) =>
      unplaced.push({ row: i + 1, hand: String(o.hand ?? ''), name: '', street, reason });
    if (o.hand === undefined || typeof o.seat !== 'number' || typeof o.k !== 'number')
      return refuse('needs hand, seat and k');
    if (!isStreet(street)) return refuse('not a street');
    if (typeof rec.action !== 'string' || !VOLUNTARY_ACTIONS.has(rec.action))
      return refuse('not a voluntary decision');
    if (o.cls !== 'bad' && o.cls !== 'ok' && o.cls !== 'unjudged') return refuse('unknown class');
    const node = { hand: String(o.hand), seat: o.seat, street, k: o.k };
    if (seen.has(nodeKey(node))) return refuse('the node is given twice');
    seen.add(nodeKey(node));
    const better = Array.isArray(o.better) ? o.better.map(String) : [];
    let sizeBand: { min: number; max: number } | undefined;
    if (o.sizeBand !== undefined && o.sizeBand !== null) {
      const sb = o.sizeBand as { min?: unknown; max?: unknown };
      if (
        typeof sb.min !== 'number' ||
        typeof sb.max !== 'number' ||
        !Number.isFinite(sb.min) ||
        !Number.isFinite(sb.max) ||
        sb.min > sb.max
      )
        return refuse('sizeBand needs finite min <= max');
      if (rec.action !== 'bet' && rec.action !== 'raise')
        return refuse('sizeBand is for a recorded bet or raise only');
      sizeBand = { min: sb.min, max: sb.max };
    }
    const equivalent = Array.isArray(o.equivalent) ? o.equivalent.map(String) : [];
    if (equivalent.some((x) => !VOLUNTARY_ACTIONS.has(x)))
      return refuse('equivalent names an action kind that is not a voluntary decision');
    decisions.push({
      node,
      source: 'placed',
      recorded: { action: rec.action, amount: typeof rec.amount === 'number' ? rec.amount : null },
      verdict: String(o.verdict ?? ''),
      cls: o.cls,
      ...(typeof o.finding === 'string' ? { finding: o.finding } : {}),
      ...(better.length ? { better } : {}),
      ...(sizeBand ? { sizeBand } : {}),
      ...(equivalent.length ? { equivalent } : {}),
    });
  });
  return { decisions, unplaced };
}

// ── replay rows ────────────────────────────────────────────────────────────
/** Arm-wide facts a harness declares once, on a line `{"meta": {"arms": {"<arm>": {...}}}}`. */
export interface ReplayArmMeta {
  /** The option-switch set handed to the brain for this arm at every node (a row's own `options` wins). */
  options?: Readonly<Record<string, unknown>>;
  /** What the harness rewrote in the journaled sets, e.g. {"omahaX:on>off": 563}. Reported, never judged. */
  sanitized?: Readonly<Record<string, number>>;
}
export interface ReplayMeta {
  arms: Record<string, ReplayArmMeta>;
}
export interface ReplayFile {
  rows: ReplayRow[];
  meta: ReplayMeta;
}

export function parseReplayFile(text: string): ReplayFile {
  const rows: ReplayRow[] = [];
  const meta: ReplayMeta = { arms: {} };
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const o = JSON.parse(line) as Partial<ReplayRow> & { meta?: Partial<ReplayMeta> | null };
    if (o.meta !== undefined) {
      const arms = o.meta?.arms;
      if (!arms || typeof arms !== 'object' || Array.isArray(arms))
        throw new Error(`replay line ${i + 1}: a meta line needs arms`);
      for (const [arm, m] of Object.entries(arms)) meta.arms[arm] = { ...meta.arms[arm], ...m };
      return;
    }
    if (
      o.hand === undefined ||
      typeof o.seat !== 'number' ||
      typeof o.street !== 'string' ||
      !isStreet(o.street) ||
      typeof o.k !== 'number' ||
      !o.arms ||
      typeof o.arms !== 'object'
    )
      throw new Error(`replay line ${i + 1}: needs hand, seat, street, k and arms`);
    rows.push({ hand: String(o.hand), seat: o.seat, street: o.street, k: o.k, arms: o.arms });
  });
  return { rows, meta };
}
export function parseReplayJsonl(text: string): ReplayRow[] {
  return parseReplayFile(text).rows;
}

// ── scoring ────────────────────────────────────────────────────────────────
const RANK: Record<string, number> = { fold: 0, check: 1, call: 2, bet: 3, raise: 4, all_in: 5 };

export interface OutcomeCounts {
  changed: number;
  moreAggressive: number;
  morePassive: number;
  resized: number;
  /** Resizes judged against the audit's size band (counted in changed and in fixed / newly wrong / still wrong / ok to ok). */
  resizeJudged: number;
  illegal: number;
  refused: number;
  errors: number;
  fixed: number;
  newlyWrong: number;
  stillWrong: number;
  okToOk: number;
  changedUnjudged: number;
  unchangedBad: number;
  unchangedOk: number;
  /** Every compared decision the arm left at the base action (judged or not). */
  unchanged: number;
  evPriced: number;
  evSumBb: number;
  evMeanBb: number;
  evSeBb: number | null;
}
export interface ArmReport extends OutcomeCounts {
  arm: string;
  perReceipt: Record<string, OutcomeCounts>;
  fixedNodes: string[];
  newlyWrongNodes: string[];
}
export interface SourceReport {
  source: AuditSource;
  method: 'audit-judge' | 'verdict-only';
  audited: number;
  auditedBad: number;
  replayed: number;
  notReplayed: number;
  baseReproducesRecorded: number;
  baseDiffers: string[];
  /** audit2 only: the ported judge agrees with the audit's own verdict on this many recorded actions. */
  judgeAgreesWithAudit?: { agree: number; judged: number };
  arms: ArmReport[];
}
export interface ReplayReport {
  base: string;
  replayRows: number;
  replayRowsWithoutAudit: number;
  /** Per arm: decisions it changed at nodes no audit judged (not scored; shown so no change goes unseen). */
  changedWithoutAudit: Record<string, number>;
  duplicateReplayNodes: string[];
  sources: SourceReport[];
}

const emptyCounts = (): OutcomeCounts & { _ev: number[] } => ({
  changed: 0,
  moreAggressive: 0,
  morePassive: 0,
  resized: 0,
  resizeJudged: 0,
  illegal: 0,
  refused: 0,
  errors: 0,
  fixed: 0,
  newlyWrong: 0,
  stillWrong: 0,
  okToOk: 0,
  changedUnjudged: 0,
  unchangedBad: 0,
  unchangedOk: 0,
  unchanged: 0,
  evPriced: 0,
  evSumBb: 0,
  evMeanBb: 0,
  evSeBb: null,
  _ev: [],
});
const finish = (c: ReturnType<typeof emptyCounts>): OutcomeCounts => {
  const { _ev, ...rest } = c;
  const n = _ev.length;
  const sum = _ev.reduce((a, b) => a + b, 0);
  const mean = n ? sum / n : 0;
  const se = n > 1 ? Math.sqrt(_ev.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1) / n) : null;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    ...rest,
    evPriced: n,
    evSumBb: r2(sum),
    evMeanBb: Math.round(mean * 1000) / 1000,
    evSeBb: se === null ? null : Math.round(se * 1000) / 1000,
  };
};

const sameAmount = (a: number | null | undefined, b: number | null | undefined) =>
  a === b ||
  (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005) ||
  (a == null && b == null);

export function scoreReplay(
  audits: { source: AuditSource; decisions: AuditedDecision[] }[],
  replay: ReplayRow[],
  base = 'off'
): ReplayReport {
  const byNode = new Map<string, ReplayRow>();
  const duplicateReplayNodes: string[] = [];
  for (const r of replay) {
    const key = nodeKey(r);
    if (byNode.has(key)) duplicateReplayNodes.push(key);
    byNode.set(key, r);
  }
  const armNames = [...new Set(replay.flatMap((r) => Object.keys(r.arms)))].filter(
    (a) => a !== base
  );
  const auditedKeys = new Set<string>();
  const sources: SourceReport[] = audits.map(({ source, decisions }) => {
    const verdictOnly = source !== 'audit2';
    let replayed = 0;
    let reproduces = 0;
    const baseDiffers: string[] = [];
    let agree = 0;
    let judged = 0;
    const acc = new Map(
      armNames.map((a) => [
        a,
        {
          all: emptyCounts(),
          per: new Map<string, ReturnType<typeof emptyCounts>>(),
          fixedNodes: [] as string[],
          newlyWrongNodes: [] as string[],
        },
      ])
    );
    for (const d of decisions) {
      const key = nodeKey(d.node);
      auditedKeys.add(key);
      if (d.judge) {
        const j = judgeAudit2(d.judge, d.node.street, d.recorded.action, d.recorded.amount);
        if (j.cls !== 'unjudged' && d.cls !== 'unjudged') {
          judged++;
          if (j.cls === d.cls) agree++;
        }
      }
      const row = byNode.get(key);
      const b = row?.arms[base];
      if (!row || !b) continue;
      replayed++;
      const reproduced = !b.error && b.action === d.recorded.action;
      if (reproduced) reproduces++;
      else baseDiffers.push(key);
      const classify = (arm: ReplayArm): { cls: VerdictClass; evBb: number | null } =>
        d.judge
          ? judgeAudit2(d.judge, d.node.street, arm.action, arm.amount ?? null)
          : { cls: reproduced ? d.cls : 'unjudged', evBb: null };
      const baseJ = b.error ? { cls: 'unjudged' as VerdictClass, evBb: null } : classify(b);
      for (const armName of armNames) {
        const a = row.arms[armName];
        if (!a) continue;
        const slot = acc.get(armName)!;
        const buckets = [slot.all];
        const receipts = [...new Set(a.receipts ?? [])];
        const bucketFor = (r: string) => {
          let c = slot.per.get(r);
          if (!c) slot.per.set(r, (c = emptyCounts()));
          return c;
        };
        if (a.error || b.error) {
          for (const c of buckets) c.errors++;
          continue;
        }
        if (a.action !== b.action) {
          buckets.push(
            ...(receipts.length ? receipts.map(bucketFor) : [bucketFor('(no receipt)')])
          );
        } else {
          for (const r of receipts) buckets.push(bucketFor(r));
        }
        // Where the audit names the better action, only a change to it is a fix (placed sources).
        const toBetter = !d.better?.length || d.better.includes(a.action);
        // The audit prices the arm's action as the recorded one (e.g. a raise over an all-in = a call).
        const sameAsRecorded =
          reproduced && !!d.equivalent?.includes(a.action) && b.action === d.recorded.action;
        // A resize judged by the audit's size band: same kind as recorded, another amount (2026-11-27).
        const band = d.sizeBand;
        const inBand = (x: number | null | undefined) =>
          band !== undefined &&
          typeof x === 'number' &&
          x >= band.min - 0.005 &&
          x <= band.max + 0.005;
        const sizeJudged =
          band !== undefined &&
          reproduced &&
          a.action === b.action &&
          !sameAmount(a.amount, b.amount) &&
          typeof a.amount === 'number';
        if (sizeJudged) {
          // Both sides by the band: the band prices every size, the audit's verdict only its pot raise and the taken one.
          const baseCls: VerdictClass = inBand(b.amount) ? 'ok' : 'bad';
          const armCls: VerdictClass = inBand(a.amount) ? 'ok' : 'bad';
          for (const c of buckets) {
            if (a.legal === false) c.illegal++;
            if (a.refusal) c.refused++;
            c.resized++;
            c.resizeJudged++;
            c.changed++;
            if (baseCls === 'unjudged') c.changedUnjudged++;
            else if (baseCls === 'bad' && armCls === 'ok') c.fixed++;
            else if (baseCls === 'ok' && armCls === 'bad') c.newlyWrong++;
            else if (baseCls === 'bad') c.stillWrong++;
            else c.okToOk++;
          }
          if (baseCls === 'bad' && armCls === 'ok') slot.fixedNodes.push(key);
          if (baseCls === 'ok' && armCls === 'bad') slot.newlyWrongNodes.push(key);
          continue;
        }
        const newJ = verdictOnly
          ? {
              cls: (a.action === b.action ? baseJ.cls : 'unjudged') as VerdictClass,
              evBb: null,
            }
          : classify(a);
        for (const c of buckets) {
          if (a.legal === false) c.illegal++;
          if (a.refusal) c.refused++;
          if (a.action === b.action) {
            c.unchanged++;
            if (!sameAmount(a.amount, b.amount)) c.resized++;
            if (baseJ.cls === 'bad') c.unchangedBad++;
            if (baseJ.cls === 'ok') c.unchangedOk++;
            continue;
          }
          c.changed++;
          if ((RANK[a.action] ?? 0) > (RANK[b.action] ?? 0)) c.moreAggressive++;
          else c.morePassive++;
          if (verdictOnly && sameAsRecorded) {
            if (baseJ.cls === 'bad') c.stillWrong++;
            else if (baseJ.cls === 'ok') c.okToOk++;
            else c.changedUnjudged++;
          } else if (verdictOnly) {
            if (baseJ.cls === 'bad') {
              if (toBetter) c.fixed++;
              else c.stillWrong++;
            } else if (baseJ.cls === 'ok') c.newlyWrong++;
            else c.changedUnjudged++;
          } else if (baseJ.cls === 'unjudged' || newJ.cls === 'unjudged') c.changedUnjudged++;
          else if (baseJ.cls === 'bad' && newJ.cls === 'ok') c.fixed++;
          else if (baseJ.cls === 'ok' && newJ.cls === 'bad') c.newlyWrong++;
          else if (baseJ.cls === 'bad') c.stillWrong++;
          else c.okToOk++;
          if (baseJ.evBb !== null && newJ.evBb !== null) c._ev.push(newJ.evBb - baseJ.evBb);
        }
        if (a.action !== b.action) {
          const fixed = verdictOnly
            ? baseJ.cls === 'bad' && toBetter && !sameAsRecorded
            : baseJ.cls === 'bad' && newJ.cls === 'ok';
          const neww = verdictOnly
            ? baseJ.cls === 'ok' && !sameAsRecorded
            : baseJ.cls === 'ok' && newJ.cls === 'bad';
          if (fixed) slot.fixedNodes.push(key);
          if (neww) slot.newlyWrongNodes.push(key);
        }
      }
    }
    return {
      source,
      method: verdictOnly ? 'verdict-only' : 'audit-judge',
      audited: decisions.length,
      auditedBad: decisions.filter((d) => d.cls === 'bad').length,
      replayed,
      notReplayed: decisions.length - replayed,
      baseReproducesRecorded: reproduces,
      baseDiffers,
      ...(verdictOnly ? {} : { judgeAgreesWithAudit: { agree, judged } }),
      arms: armNames.map((arm) => {
        const s = acc.get(arm)!;
        return {
          arm,
          ...finish(s.all),
          perReceipt: Object.fromEntries(
            [...s.per.entries()].sort().map(([k, v]) => [k, finish(v)])
          ),
          fixedNodes: s.fixedNodes,
          newlyWrongNodes: s.newlyWrongNodes,
        };
      }),
    };
  });
  const unaudited = [...byNode.entries()].filter(([k]) => !auditedKeys.has(k)).map(([, r]) => r);
  const changedWithoutAudit = Object.fromEntries(
    armNames.map((arm) => [
      arm,
      unaudited.filter((r) => {
        const a = r.arms[arm];
        const b = r.arms[base];
        return !!a && !!b && !a.error && !b.error && a.action !== b.action;
      }).length,
    ])
  );
  return {
    base,
    replayRows: replay.length,
    replayRowsWithoutAudit: unaudited.length,
    changedWithoutAudit,
    duplicateReplayNodes,
    sources,
  };
}

/**
 * The replay line of an option authority file (docs/horse-option-authority.d/README.md): one sentence per
 * source for one arm, every count the reviewer needs and nothing the scorer did not measure.
 */
export function replayBarLine(report: ReplayReport, arm: string): string {
  return report.sources
    .map((s) => {
      const a = s.arms.find((x) => x.arm === arm);
      const head = `${s.source} (${s.method}; ${s.audited} audited decisions, ${s.auditedBad} judged bad; joined by node: ${s.replayed} replayed, ${s.notReplayed} not replayed, base reproduces the recorded action on ${s.baseReproducesRecorded})`;
      if (!a) return `${head}: arm ${arm} absent`;
      const ev =
        s.method === 'audit-judge'
          ? a.evPriced
            ? `; audit-model EV difference ${a.evSumBb >= 0 ? '+' : ''}${a.evSumBb} bb over ${a.evPriced} priced changes (mean ${a.evMeanBb}, se ${a.evSeBb ?? 'n/a'})`
            : '; no change the audit model prices'
          : '; no bb (the audit declares no EV model)';
      const receipts = Object.entries(a.perReceipt)
        .filter(([, c]) => c.changed > 0)
        .map(
          ([r, c]) => `${r} ${c.changed} changed / ${c.fixed} fixed / ${c.newlyWrong} newly wrong`
        )
        .join('; ');
      return `${head}: arm ${arm} changed ${a.changed} (${a.moreAggressive} more aggressive, ${a.morePassive} more passive${a.resizeJudged ? `, ${a.resizeJudged} resizes judged by the audit's size band` : ''}), resized ${a.resized}, illegal ${a.illegal}, refused ${a.refused}, errors ${a.errors}; fixed ${a.fixed}, newly wrong ${a.newlyWrong}, still wrong ${a.stillWrong}, ok to ok ${a.okToOk}, unjudged ${a.changedUnjudged}; judged bad left unchanged ${a.unchangedBad}${ev}${receipts ? `; per receipt: ${receipts}` : ''}.`;
    })
    .join(' ');
}

// ── replay validity: an arm must be the option set it is named for ─────────
export interface OptionSetProblem {
  option: string;
  state: string;
  problem: 'unregistered' | 'off-only' | 'unsupported state';
  detail: string;
}
/** Why the option registry refuses an option set as a whole; [] when it accepts it. */
export type OptionSetJudge = (set: Readonly<Record<string, unknown>>) => OptionSetProblem[];

/**
 * Today's registry (HorseOptionSwitch). The whole-set rule is optionSwitchStatesFrom's: one name that is not a
 * registered non-style option, or one state the option does not support (`on` for an off-only option), refuses
 * the set and every option then runs at its release default. This names the options that caused it.
 */
export const todaysOptionSetProblems: OptionSetJudge = (set) => {
  const out: OptionSetProblem[] = [];
  for (const [option, raw] of Object.entries(set)) {
    const state = typeof raw === 'string' ? raw : String(JSON.stringify(raw));
    if (!OPTION_SWITCH_PLAIN_NAMES.includes(option)) {
      out.push({
        option,
        state,
        problem: 'unregistered',
        detail: optionSwitchRefusal(option) ?? 'not a registered option of the live switch today',
      });
      continue;
    }
    const states: readonly string[] = optionSwitchStatesOf(option) ?? [];
    if (typeof raw === 'string' && states.includes(raw)) continue;
    const offOnly = optionSwitchOffOnly(option);
    if (raw === 'on' && offOnly)
      out.push({
        option,
        state,
        problem: 'off-only',
        detail: `${offOnly.status}: ${offOnly.source}`,
      });
    else
      out.push({
        option,
        state,
        problem: 'unsupported state',
        detail: `the option supports ${states.join(' / ')}`,
      });
  }
  // The live holder skips a row for a name the build does not know at all and keeps the rest (2026-11-20). A
  // replay arm is stricter on purpose: a name it cannot apply is a problem of the arm, never a silent skip.
  const refusedHere =
    optionSwitchStatesFrom(set) === null || optionSwitchUnknownNames(set).length > 0;
  if (refusedHere !== out.length > 0)
    throw new Error(
      'audited replay: the option-set diagnosis disagrees with HorseOptionSwitch.optionSwitchStatesFrom'
    );
  return out;
};

export interface ArmValidity {
  arm: string;
  isBase: boolean;
  /** The base arm every other arm is compared with. */
  base: string;
  rows: number;
  /** Rows whose option set is declared (on the row's arm or on the meta line). */
  rowsWithOptions: number;
  /** Rows whose declared set the registry refuses: nothing was switched there. */
  invalidRows: number;
  problems: (OptionSetProblem & { rows: number })[];
  /** Options named on in this arm at a node where the base arm does not name them on (what the arm tests). */
  switchedOn: string[];
  /** Options the base arm names on and this arm does not. */
  switchedOff: string[];
  comparedRows: number;
  /** Compared rows where the arm differs from the base in action, amount, legality, refusal, error or receipts. */
  differingRows: number;
  sanitized: Record<string, number>;
}

const sameDecision = (a: ReplayArm, b: ReplayArm): boolean =>
  a.action === b.action &&
  sameAmount(a.amount, b.amount) &&
  (a.legal === false) === (b.legal === false) &&
  !!a.refusal === !!b.refusal &&
  (a.error ?? null) === (b.error ?? null) &&
  [...new Set(a.receipts ?? [])].sort().join('\n') ===
    [...new Set(b.receipts ?? [])].sort().join('\n');

export function replayValidity(
  file: ReplayFile,
  base = 'off',
  judge: OptionSetJudge = todaysOptionSetProblems
): ArmValidity[] {
  const names = [
    ...new Set([
      base,
      ...file.rows.flatMap((r) => Object.keys(r.arms)),
      ...Object.keys(file.meta.arms),
    ]),
  ];
  const cache = new Map<string, OptionSetProblem[]>();
  const judged = (set: Readonly<Record<string, unknown>>) => {
    const key = JSON.stringify(set);
    let p = cache.get(key);
    if (!p) cache.set(key, (p = judge(set)));
    return p;
  };
  const setOf = (row: ReplayRow, arm: string) =>
    row.arms[arm]?.options ?? file.meta.arms[arm]?.options;
  return names.map((arm) => {
    const problems = new Map<string, OptionSetProblem & { rows: number }>();
    const on = new Set<string>();
    const off = new Set<string>();
    let rows = 0;
    let rowsWithOptions = 0;
    let invalidRows = 0;
    let comparedRows = 0;
    let differingRows = 0;
    for (const row of file.rows) {
      const a = row.arms[arm];
      if (!a) continue;
      rows++;
      const set = setOf(row, arm);
      if (set) {
        rowsWithOptions++;
        const found = judged(set);
        if (found.length) invalidRows++;
        for (const p of found) {
          const key = `${p.option}\n${p.state}`;
          const have = problems.get(key);
          if (have) have.rows++;
          else problems.set(key, { ...p, rows: 1 });
        }
        const baseSet = arm === base ? undefined : setOf(row, base);
        if (baseSet)
          for (const o of new Set([...Object.keys(set), ...Object.keys(baseSet)])) {
            if (set[o] === 'on' && baseSet[o] !== 'on') on.add(o);
            if (set[o] !== 'on' && baseSet[o] === 'on') off.add(o);
          }
      }
      const b = arm === base ? undefined : row.arms[base];
      if (b) {
        comparedRows++;
        if (!sameDecision(a, b)) differingRows++;
      }
    }
    return {
      arm,
      isBase: arm === base,
      base,
      rows,
      rowsWithOptions,
      invalidRows,
      problems: [...problems.values()],
      switchedOn: [...on].sort(),
      switchedOff: [...off].sort(),
      comparedRows,
      differingRows,
      sanitized: { ...file.meta.arms[arm]?.sanitized },
    };
  });
}

export interface ReplayRefusalOptions {
  /** Arms declared to change nothing on this set (a control arm, or an option out of scope on it). */
  allowUnchanged?: readonly string[];
  /** Arms whose option set must be declared on every row (the arms an authority Replay row is written from). */
  requireOptionsFor?: readonly string[];
}

/**
 * Why this replay must not be scored; [] when it may. Three refusals: an option set today's registry refuses (the
 * arm switched nothing: an off-only or unregistered journaled option), an arm identical to the base on every
 * compared row that was not declared so, and an authority row asked from an arm whose option set is not declared.
 */
export function replayRefusals(validity: ArmValidity[], o: ReplayRefusalOptions = {}): string[] {
  const allow = new Set(o.allowUnchanged ?? []);
  const need = new Set(o.requireOptionsFor ?? []);
  const out: string[] = [];
  for (const v of validity) {
    const who = v.isBase ? `base arm "${v.arm}"` : `arm "${v.arm}"`;
    if (v.rows === 0) {
      if (v.isBase || need.has(v.arm)) out.push(`${who} has no replay row`);
      continue;
    }
    if (v.invalidRows > 0) {
      const why = v.problems
        .map((p) => `${p.option} ${p.state}: ${p.problem} (${p.detail}), ${p.rows} rows`)
        .join('; ');
      out.push(
        `${who} is INERT on ${v.invalidRows} of ${v.rows} rows: today's option registry refuses its option set, so nothing in it was switched and the brain played its release defaults [${why}]. Sanitize the journaled set in the harness (an off-only option goes off, as production holds it today; an unregistered one is dropped), declare the rewrite under meta.arms.${v.arm}.sanitized, and replay again.`
      );
    }
    if (!v.isBase && v.comparedRows === 0)
      out.push(`${who} shares no row with the base arm "${v.base}"`);
    else if (!v.isBase && v.differingRows === 0 && !allow.has(v.arm))
      out.push(
        `${who} is identical to the base arm "${v.base}" on all ${v.comparedRows} compared rows (action, amount, legality, refusal, receipts): an inert arm. If the option is truly out of scope on this set, declare it with --allow-unchanged ${v.arm}.`
      );
    if (need.has(v.arm) && v.rowsWithOptions < v.rows)
      out.push(
        `${who} declares no option set on ${v.rows - v.rowsWithOptions} of ${v.rows} rows: the off-only / unregistered check cannot be made, so no authority Replay row is written from it. Have the harness declare the set it handed the brain (a line {"meta": {"arms": {"${v.arm}": {"options": {...}}}}}, or options on each row's arm).`
      );
  }
  return out;
}

// ── the machine-read Replay row of an option authority file ────────────────
/**
 * docs/horse-option-authority.d/<option>.md carries one or more lines `- Replay: ...`:
 *   - Replay: fixed 1; newlyWrong 4; changed 11; unchanged 552; unjudged 6; set <name>; scorer <commit>; ...
 *   - Replay: NOT RUN (<reason>)
 *   - Replay: LEGACY (<reason>)      a replay recorded in prose only, before this row existed
 * A run row needs fixed, newlyWrong, changed (whole numbers), set (the name of the audited decision set) and scorer
 * (the commit of this scorer, 7 to 40 hex characters); further `key value` fields are kept as written.
 */
export type ReplayBarRow =
  | {
      state: 'RUN';
      fixed: number;
      newlyWrong: number;
      changed: number;
      set: string;
      scorer: string;
      fields: Record<string, string>;
    }
  | { state: 'NOT RUN' | 'LEGACY'; reason: string };

export const REPLAY_BAR_ROW_PREFIX = '- Replay: ';

export function parseReplayBarRows(markdown: string): {
  rows: ReplayBarRow[];
  malformed: string[];
} {
  const rows: ReplayBarRow[] = [];
  const malformed: string[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith(REPLAY_BAR_ROW_PREFIX)) continue;
    const body = line.slice(REPLAY_BAR_ROW_PREFIX.length).trim();
    const not = /^(NOT RUN|LEGACY) \((.+)\)$/.exec(body);
    if (not) {
      if (not[2].trim().length < 10) malformed.push(`${line} [the reason is too short]`);
      else rows.push({ state: not[1] as 'NOT RUN' | 'LEGACY', reason: not[2].trim() });
      continue;
    }
    const fields: Record<string, string> = {};
    let bad = '';
    for (const part of body.split(';')) {
      const m = /^\s*([A-Za-z][A-Za-z-]*)\s+(\S.*?)\s*$/.exec(part);
      if (!m) bad = `"${part.trim()}" is not "key value"`;
      else if (Object.hasOwn(fields, m[1])) bad = `${m[1]} is given twice`;
      else fields[m[1]] = m[2];
    }
    for (const k of ['fixed', 'newlyWrong', 'changed'])
      if (!bad && !/^\d+$/.test(fields[k] ?? '')) bad = `${k} must be a whole number`;
    if (!bad && !fields.set) bad = 'set (the audited decision set) is missing';
    if (!bad && !/^[0-9a-f]{7,40}$/.test(fields.scorer ?? ''))
      bad = 'scorer must be the scorer commit (7 to 40 hex characters)';
    if (bad) malformed.push(`${line} [${bad}]`);
    else
      rows.push({
        state: 'RUN',
        fixed: Number(fields.fixed),
        newlyWrong: Number(fields.newlyWrong),
        changed: Number(fields.changed),
        set: fields.set,
        scorer: fields.scorer,
        fields,
      });
  }
  return { rows, malformed };
}

/** The Replay rows for one arm of a scored replay, one per audit source, as parseReplayBarRows reads them. */
export function replayBarRows(
  report: ReplayReport,
  arm: string,
  o: { set: string; scorer: string }
): string[] {
  if (!o.set.trim() || /[;\n]/.test(o.set))
    throw new Error('replay row: the set name is one phrase without ";"');
  if (!/^[0-9a-f]{7,40}$/.test(o.scorer))
    throw new Error('replay row: the scorer commit is 7 to 40 hex characters');
  const lines = report.sources.map((s) => {
    const a = s.arms.find((x) => x.arm === arm);
    if (!a) throw new Error(`replay row: arm ${arm} is absent from source ${s.source}`);
    return `${REPLAY_BAR_ROW_PREFIX}fixed ${a.fixed}; newlyWrong ${a.newlyWrong}; changed ${a.changed}; unchanged ${a.unchanged}; unjudged ${a.changedUnjudged}; set ${o.set.trim()}; scorer ${o.scorer}; source ${s.source} ${s.method}${a.resizeJudged ? ` size-aware; resizeJudged ${a.resizeJudged}` : ''}; arm ${arm} vs ${report.base}; replayed ${s.replayed} of ${s.audited}`;
  });
  for (const line of lines)
    if (parseReplayBarRows(line).rows.length !== 1)
      throw new Error(`replay row: not machine-readable: ${line}`);
  return lines;
}
