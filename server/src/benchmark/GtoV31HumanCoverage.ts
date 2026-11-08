/**
 * V31 human-coverage keying analysis (offline benchmark tooling only).
 *
 * Question it answers: if the V31 playbook were keyed differently (coarser
 * table sizes, depths, textures, pot types, node roles, or a multiway class),
 * what share of the turn/river (or flop) decisions Horses actually make
 * against live humans would a plan of N solved cells reach, and what would
 * that plan cost in solver time?
 *
 * Nothing here is read by the live engine. Records come from
 * `scripts/gtoV31HumanCoverage.ts classify`, which derives every field with
 * the engine's own state rebuild and V31 key functions; this module only
 * coarsens those fields and counts.
 *
 * Selection is honest about overfitting: cells are chosen from the decisions
 * before `splitAt` and coverage is measured on the decisions from `splitAt`
 * on, so a plan cannot score by memorising one-off spots.
 */

export type V31CoverageStreet = 'flop' | 'turn' | 'river';

export interface V31CoverageRecord {
  decisionId: string;
  handId: string;
  createdAt: string | null;
  street: V31CoverageStreet;
  /** 'keyed' (heads-up, engine-keyable), 'multiway', 'unkeyable', 'ineligible_*', ... */
  status: string;
  /** Unkeyable reasons from the classifier, when status is 'unkeyable'. */
  why?: string[];
  facesHuman: boolean;
  liveOpponents: number | null;
  tableSize: number | null;
  potType: string | null;
  heroPosition: string | null;
  /** Heads-up only. */
  opponentPosition: string | null;
  /** Effective flop-root stack in big blinds (multiway: hero vs deepest live opponent). */
  stackBB: number | null;
  /** Engine texture class of the board at the decision. */
  texture: string | null;
  nodeRole: string | null;
  facingKind: string | null;
  facingSizeBucket: string | null;
  /** Hero acts last postflop among the live players. */
  heroInPosition: boolean | null;
  /** 'hero', 'opponent' (someone else raised preflop) or 'none' (limped). */
  preflopAggressor: 'hero' | 'opponent' | 'none' | null;
  /** Multiway only: hero's postflop acting order among live players. */
  multiwayOrder: 'first' | 'middle' | 'last' | null;
  /**
   * Coarse role for decisions the engine's node classifier declines: a wager
   * to answer ('facing'), a bet by the previous street's aggressor
   * ('agg_bet'), a lead into that aggressor ('donk'), or a lead after a
   * checked-through street ('lead'). Null when hero already acted this street.
   */
  fallbackRole?: 'facing' | 'agg_bet' | 'donk' | 'lead' | null;
}

export interface V31KeyingScheme {
  name: string;
  /** exact seats | HU / 3-6 / 7-10 | HU / 3-10 | ignored */
  tableSize: 'exact' | 'band3' | 'band2' | 'any';
  /** exact position labels | in/out of position + preflop aggressor role */
  positions: 'exact' | 'relative';
  /**
   * engine's five buckets | {10}, {20}, {40, 80, 150} | ignored. The band
   * follows measured strategy distance: 40/80/150 differ little, while 10
   * and 20 differ from each other and from everything deeper.
   */
  depth: 'exact' | 'band3' | 'any';
  /** 64 engine classes | drop high card (16) | suit+pair (6) | ignored */
  texture: 'exact' | 'noHigh' | 'suitPair' | 'any';
  /** exact: lrp never keyed (today's engine) | lrp served by srp | lrp its own key */
  potType: 'exact' | 'lrpAsSrp' | 'lrpOwn';
  /**
   * exact roles | aggressor-continuation / lead / facing-bet / facing-raise /
   * all-in | merged plus a heads-up 'donk' role (a lead into the previous
   * street's aggressor, which the engine declines today)
   */
  nodeRole: 'exact' | 'merged' | 'mergedPlusDonk';
  facingSize: 'exact' | 'any';
  /** none: multiway never keyed | class: 3-way and 4+-way keyed by order and aggressor */
  multiway: 'none' | 'class';
}

export const V31_EXACT_SCHEME: V31KeyingScheme = {
  name: 'exact (engine today)',
  tableSize: 'exact',
  positions: 'exact',
  depth: 'exact',
  texture: 'exact',
  potType: 'exact',
  nodeRole: 'exact',
  facingSize: 'exact',
  multiway: 'none',
};

export function v31TableBand(size: number, band: V31KeyingScheme['tableSize']): string {
  if (band === 'exact') return String(size);
  if (band === 'any') return '*';
  if (size <= 2) return 'hu';
  if (band === 'band2') return 'ring';
  return size <= 6 ? 'sh' : 'fr';
}

/** Engine depth bucket (10/20/40/80/150) to a coarser band. */
export function v31DepthBand(stackBB: number, band: V31KeyingScheme['depth']): string {
  if (band === 'any') return '*';
  // Same boundaries as snapDepthBucket in engine/GtoPostflop.ts.
  const bucket = !(stackBB > 0)
    ? 40
    : stackBB <= 12
      ? 10
      : stackBB <= 30
        ? 20
        : stackBB <= 60
          ? 40
          : stackBB <= 110
            ? 80
            : 150;
  if (band === 'exact' || bucket <= 20) return String(bucket);
  return '40+';
}

/** Coarsen an engine texture class `[ABML][mtr][pu][cd]`. */
export function v31TextureBand(texture: string, band: V31KeyingScheme['texture']): string {
  if (band === 'exact') return texture;
  if (band === 'any') return '*';
  if (band === 'noHigh') return texture.slice(1);
  return texture.slice(1, 3);
}

const AGGRESSOR_CONTINUE = new Set(['cbet', 'barrel', 'delayed_cbet']);
const LEAD = new Set(['open', 'probe']);
const FACING_RAISE = new Set(['facing_raise', 'check_raise', 'bet_raise']);

export function v31NodeRoleBand(role: string, band: V31KeyingScheme['nodeRole']): string {
  if (band === 'exact') return role;
  if (role === 'facing') return 'facing_bet';
  if (AGGRESSOR_CONTINUE.has(role)) return 'agg_bet';
  if (LEAD.has(role)) return 'lead';
  if (FACING_RAISE.has(role)) return 'facing_raise';
  return role;
}

function positionPart(r: V31CoverageRecord, scheme: V31KeyingScheme): string | null {
  if (scheme.positions === 'exact') {
    if (!r.heroPosition || !r.opponentPosition) return null;
    return `${r.heroPosition}v${r.opponentPosition}`;
  }
  if (r.heroInPosition === null || r.preflopAggressor === null) return null;
  return `${r.heroInPosition ? 'ip' : 'oop'}:${r.preflopAggressor}`;
}

/**
 * The cell this decision would read under `scheme`, or null when the scheme
 * cannot serve it. Exact scheme keys are a function of the engine key fields,
 * so two decisions share a key here exactly when they share an engine key.
 */
function roleFor(r: V31CoverageRecord, scheme: V31KeyingScheme): string | null {
  if (r.nodeRole) return v31NodeRoleBand(r.nodeRole, scheme.nodeRole);
  const fallback = r.fallbackRole ?? null;
  if (fallback === null || scheme.nodeRole === 'exact') return null;
  // The multiway class (and the heads-up-after-multiway class it brings) is
  // new keying, so it takes the coarse role directly.
  const fromMultiway =
    r.status === 'multiway' ||
    (Array.isArray(r.why) && r.why.includes('third_party_postflop_action'));
  if (fromMultiway) return scheme.multiway === 'class' ? v31NodeRoleBand(fallback, 'merged') : null;
  // Heads-up: only the donk role is added, and only when the scheme asks.
  return scheme.nodeRole === 'mergedPlusDonk' && fallback === 'donk' ? 'donk' : null;
}

const HUX_REASONS = new Set(['third_party_postflop_action', 'no_node_context']);

export function v31CoverageKey(r: V31CoverageRecord, scheme: V31KeyingScheme): string | null {
  const role = roleFor(r, scheme);
  if (
    r.tableSize === null ||
    r.potType === null ||
    r.stackBB === null ||
    !r.texture ||
    role === null
  ) {
    return null;
  }
  let potType = r.potType;
  if (potType === 'lrp') {
    if (scheme.potType === 'exact') return null;
    if (scheme.potType === 'lrpAsSrp') potType = 'srp';
  }
  const common = [
    r.street,
    v31TableBand(r.tableSize, scheme.tableSize),
    potType,
    v31DepthBand(r.stackBB, scheme.depth),
    v31TextureBand(r.texture, scheme.texture),
    role,
    scheme.facingSize === 'exact' ? (r.facingSizeBucket ?? 'none') : '*',
  ];
  const why = Array.isArray(r.why) ? r.why : [];
  const huDonk =
    r.status === 'unkeyable' && why.length === 1 && why[0] === 'no_node_context' && role === 'donk';
  if (r.status === 'keyed' || huDonk) {
    const pos = positionPart(r, scheme);
    return pos === null ? null : ['hu', pos, ...common].join('|');
  }
  if (scheme.multiway !== 'class') return null;
  if (r.status === 'multiway') {
    if (
      r.liveOpponents === null ||
      r.liveOpponents < 2 ||
      !r.multiwayOrder ||
      !r.preflopAggressor
    ) {
      return null;
    }
    const players = r.liveOpponents + 1 >= 4 ? '4+' : '3';
    return ['mw', players, r.multiwayOrder, r.preflopAggressor, ...common].join('|');
  }
  // Heads-up now, but a third player acted postflop before folding: a
  // heads-up solve from this street's root is an approximation, keyed apart.
  if (
    r.status === 'unkeyable' &&
    why.includes('third_party_postflop_action') &&
    why.every((w) => HUX_REASONS.has(w))
  ) {
    const pos = positionPart(r, { ...scheme, positions: 'relative' });
    return pos === null ? null : ['hux', pos, ...common].join('|');
  }
  return null;
}

export interface V31CoverageOptions {
  streets: V31CoverageStreet[];
  /** Cell budgets to evaluate (number of solved cells). */
  budgets: number[];
  /** ISO timestamp: cells are selected before it and measured from it on. */
  splitAt: string;
  /** Solver scenarios per cell (R7 recipe: 57 M1 boards + 8 M2 boards). */
  scenariosPerCell?: number;
  /** Solver scenarios per machine-hour (R7 measured about 1,000 on M1/M2). */
  scenariosPerMachineHour?: number;
}

export interface V31CoveragePoint {
  cells: number;
  machineHours: number;
  /** Held-out share of human-facing decisions the selected cells serve. */
  heldOutCoveragePct: number;
  /** Same cells, measured on the selection period (optimistic). */
  inSampleCoveragePct: number;
}

export interface V31CoverageReport {
  scheme: string;
  streets: V31CoverageStreet[];
  decisions: number;
  selectionDecisions: number;
  heldOutDecisions: number;
  /** Share of all decisions that have any key under the scheme. */
  ceilingPct: number;
  distinctKeys: number;
  /** Keys seen at least twice / five times in the whole sample. */
  keysWith2Plus: number;
  keysWith5Plus: number;
  curve: V31CoveragePoint[];
  topKeys: Array<{ key: string; n: number }>;
}

function pct(a: number, b: number): number {
  return b > 0 ? Math.round((10000 * a) / b) / 100 : 0;
}

/** Human-facing decisions on the requested streets. */
export function v31HumanFacing(
  records: V31CoverageRecord[],
  streets: V31CoverageStreet[]
): V31CoverageRecord[] {
  const s = new Set(streets);
  return records.filter((r) => r.facesHuman && s.has(r.street));
}

function rankKeys(keys: Array<string | null>): string[] {
  const counts = new Map<string, number>();
  for (const k of keys) if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k]) => k);
}

export function v31CoverageReport(
  records: V31CoverageRecord[],
  scheme: V31KeyingScheme,
  options: V31CoverageOptions
): V31CoverageReport {
  const scenariosPerCell = options.scenariosPerCell ?? 65;
  const perHour = options.scenariosPerMachineHour ?? 1000;
  const universe = v31HumanFacing(records, options.streets);
  const keyOf = universe.map((r) => v31CoverageKey(r, scheme));
  const isSelection = universe.map((r) => (r.createdAt ?? '') < options.splitAt);
  const selKeys = keyOf.filter((_, i) => isSelection[i]);
  const testKeys = keyOf.filter((_, i) => !isSelection[i]);
  const rankedSelection = rankKeys(selKeys);
  const rankedAll = rankKeys(keyOf);
  const allCounts = new Map<string, number>();
  for (const k of keyOf) if (k !== null) allCounts.set(k, (allCounts.get(k) ?? 0) + 1);
  const curve = options.budgets.map((cells) => {
    const chosen = new Set(rankedSelection.slice(0, cells));
    const chosenAll = new Set(rankedAll.slice(0, cells));
    return {
      cells,
      machineHours: Math.round(((cells * scenariosPerCell) / perHour) * 10) / 10,
      heldOutCoveragePct: pct(
        testKeys.filter((k) => k !== null && chosen.has(k)).length,
        testKeys.length
      ),
      inSampleCoveragePct: pct(
        keyOf.filter((k) => k !== null && chosenAll.has(k)).length,
        keyOf.length
      ),
    };
  });
  return {
    scheme: scheme.name,
    streets: options.streets,
    decisions: universe.length,
    selectionDecisions: selKeys.length,
    heldOutDecisions: testKeys.length,
    ceilingPct: pct(keyOf.filter((k) => k !== null).length, keyOf.length),
    distinctKeys: allCounts.size,
    keysWith2Plus: [...allCounts.values()].filter((n) => n >= 2).length,
    keysWith5Plus: [...allCounts.values()].filter((n) => n >= 5).length,
    curve,
    topKeys: rankedAll.slice(0, 15).map((key) => ({ key, n: allCounts.get(key) ?? 0 })),
  };
}

const STRUCTURAL: V31KeyingScheme = {
  name: 'R9 structural (band3 table, relative positions, lrp own key, merged roles + donk)',
  tableSize: 'band3',
  positions: 'relative',
  depth: 'exact',
  texture: 'exact',
  potType: 'lrpOwn',
  nodeRole: 'mergedPlusDonk',
  facingSize: 'any',
  multiway: 'none',
};

/** The schemes the R9 design compares, from today's exact key to fully pooled. */
export const V31_R9_CANDIDATE_SCHEMES: V31KeyingScheme[] = [
  V31_EXACT_SCHEME,
  { ...V31_EXACT_SCHEME, name: 'table band3', tableSize: 'band3' },
  { ...V31_EXACT_SCHEME, name: 'relative positions', positions: 'relative' },
  {
    ...V31_EXACT_SCHEME,
    name: 'table band3 + relative positions',
    tableSize: 'band3',
    positions: 'relative',
  },
  { ...V31_EXACT_SCHEME, name: 'depth band3', depth: 'band3' },
  { ...V31_EXACT_SCHEME, name: 'texture noHigh', texture: 'noHigh' },
  { ...V31_EXACT_SCHEME, name: 'texture suitPair', texture: 'suitPair' },
  { ...V31_EXACT_SCHEME, name: 'lrp own key', potType: 'lrpOwn' },
  { ...V31_EXACT_SCHEME, name: 'node roles merged', nodeRole: 'merged', facingSize: 'any' },
  {
    ...V31_EXACT_SCHEME,
    name: 'node roles merged + donk',
    nodeRole: 'mergedPlusDonk',
    facingSize: 'any',
  },
  STRUCTURAL,
  { ...STRUCTURAL, name: 'R9 structural, facing size kept', facingSize: 'exact' },
  { ...STRUCTURAL, name: 'R9 structural + texture noHigh', texture: 'noHigh' },
  { ...STRUCTURAL, name: 'R9 structural + texture suitPair', texture: 'suitPair' },
  {
    ...STRUCTURAL,
    name: 'R9 structural + texture noHigh + depth band3',
    texture: 'noHigh',
    depth: 'band3',
  },
  {
    ...STRUCTURAL,
    name: 'R9 structural + texture suitPair + depth band3',
    texture: 'suitPair',
    depth: 'band3',
  },
  {
    ...STRUCTURAL,
    name: 'R9 structural + texture noHigh + multiway class',
    texture: 'noHigh',
    multiway: 'class',
  },
  {
    ...STRUCTURAL,
    name: 'R9 structural + texture suitPair + multiway class',
    texture: 'suitPair',
    multiway: 'class',
  },
  {
    ...STRUCTURAL,
    name: 'R9 structural + texture suitPair + depth band3 + multiway class',
    texture: 'suitPair',
    depth: 'band3',
    multiway: 'class',
  },
  {
    ...STRUCTURAL,
    name: 'R9 recommended, heads-up (suitPair texture, depth 10/20/40+, facing size kept)',
    texture: 'suitPair',
    depth: 'band3',
    facingSize: 'exact',
  },
  {
    ...STRUCTURAL,
    name: 'R9 recommended + multiway class',
    texture: 'suitPair',
    depth: 'band3',
    facingSize: 'exact',
    multiway: 'class',
  },
  {
    ...STRUCTURAL,
    name: 'texture only (everything else pooled; upper bound for one context model)',
    tableSize: 'any',
    depth: 'any',
    multiway: 'class',
  },
];
