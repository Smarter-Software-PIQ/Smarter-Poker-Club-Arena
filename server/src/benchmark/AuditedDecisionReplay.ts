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
 *  - audit2 has an action-level judge (its analyze.py rules, ported below as
 *    judgeAudit2): the base and the replayed action are each judged, so a
 *    change is fixed (bad -> ok), newly wrong (ok -> bad), still wrong or
 *    ok -> ok, and the audit's EV model prices it in bb where it can.
 *    The WooWoo audit declares no EV ("No solver, no EV", its METHOD.md): it
 *    is scored verdict-only. A change away from an action it judged wrong or
 *    questionable counts as fixed (verdict-only), a change away from an action
 *    it judged correct or acceptable_close as newly wrong (verdict-only); no
 *    bb is claimed for it.
 *  - Every count is also split per rule receipt the replayed arm carried
 *    (the per-decision rule receipts of BrainTelemetry.noteDecisionRuleReceipt
 *    or the decision's fired receipt keys), so a reviewer sees which rule made
 *    each fix and each new mistake.
 *
 * It decides nothing and reads no production data by itself: the CLI
 * (server/scripts/audited-decision-replay.ts) is pointed at local evidence
 * files. Tests use synthetic, anonymized rows in the real formats.
 */

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
  source: 'audit2' | 'woowoo';
  recorded: { action: string; amount: number | null };
  /** The audit's verdict word as written, and its class. */
  verdict: string;
  cls: VerdictClass;
  finding?: string;
  judge?: Audit2JudgeInputs;
}

export interface ReplayArm {
  action: string;
  amount?: number | null;
  legal?: boolean;
  refusal?: boolean;
  receipts?: readonly string[];
  error?: string;
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
  /** Audit rows no node could be found for (hand missing from the hands file, or no matching action). */
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

// ── replay rows ────────────────────────────────────────────────────────────
export function parseReplayJsonl(text: string): ReplayRow[] {
  const out: ReplayRow[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const o = JSON.parse(line) as Partial<ReplayRow>;
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
    out.push({ hand: String(o.hand), seat: o.seat, street: o.street, k: o.k, arms: o.arms });
  });
  return out;
}

// ── scoring ────────────────────────────────────────────────────────────────
const RANK: Record<string, number> = { fold: 0, check: 1, call: 2, bet: 3, raise: 4, all_in: 5 };

export interface OutcomeCounts {
  changed: number;
  moreAggressive: number;
  morePassive: number;
  resized: number;
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
  source: 'audit2' | 'woowoo';
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
  audits: { source: 'audit2' | 'woowoo'; decisions: AuditedDecision[] }[],
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
            if (!sameAmount(a.amount, b.amount)) c.resized++;
            if (baseJ.cls === 'bad') c.unchangedBad++;
            if (baseJ.cls === 'ok') c.unchangedOk++;
            continue;
          }
          c.changed++;
          if ((RANK[a.action] ?? 0) > (RANK[b.action] ?? 0)) c.moreAggressive++;
          else c.morePassive++;
          if (verdictOnly) {
            if (baseJ.cls === 'bad') c.fixed++;
            else if (baseJ.cls === 'ok') c.newlyWrong++;
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
            ? baseJ.cls === 'bad'
            : baseJ.cls === 'bad' && newJ.cls === 'ok';
          const neww = verdictOnly ? baseJ.cls === 'ok' : baseJ.cls === 'ok' && newJ.cls === 'bad';
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
      return `${head}: arm ${arm} changed ${a.changed} (${a.moreAggressive} more aggressive, ${a.morePassive} more passive), resized ${a.resized}, illegal ${a.illegal}, refused ${a.refused}, errors ${a.errors}; fixed ${a.fixed}, newly wrong ${a.newlyWrong}, still wrong ${a.stillWrong}, ok to ok ${a.okToOk}, unjudged ${a.changedUnjudged}; judged bad left unchanged ${a.unchangedBad}${ev}${receipts ? `; per receipt: ${receipts}` : ''}.`;
    })
    .join(' ');
}
