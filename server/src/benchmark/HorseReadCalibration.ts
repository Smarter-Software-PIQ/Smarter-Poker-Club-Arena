/**
 * READ CALIBRATION (2026-11-07). Do the reads horses keep on an opponent
 * predict what that opponent does next?
 *
 * A walk-forward replay of accepted hand logs through the engine's own read
 * code (HorseMind.observe / observeHandComplete and the exploit counters the
 * shared memory pools). Before a hand is observed, every read a horse would
 * have consulted about each target player is taken exactly as the accessor
 * returns it; the hand is then observed, and the counters the engine itself
 * adds for that player during the hand are the outcome. Nothing a later hand
 * contains can reach an earlier prediction.
 *
 * Measurement only: no decision, no write, no random draw. Run it inside a
 * HorseMind sandbox so the live process memory is never touched.
 */
import {
  HorseMind,
  readScopeOf,
  SCOPE_MIN_HANDS,
  type OpponentStats,
  type ReadScope,
} from '../engine/HorseMind.js';
import {
  EXPLOIT_STATS,
  exploitEnvelopeFor,
  exploitHandIncrements,
  statRead,
  type ExploitCounters,
  type ExploitStat,
} from '../engine/HorseOpponentExploit.js';
import { evaluateHand, evaluateOmahaHand } from '../engine/PokerEngine.js';
import type { MemoryMode } from '../engine/HorseOpponentMemory.js';
import type { ActionRecord, Card } from '../types.js';

/** One accepted hand log row (public.hand_history shape, the fields used). */
export interface CalibrationHand {
  id: string;
  table_id: string;
  tournament_id?: string | null;
  hand_number: number;
  started_at?: string | null;
  created_at: string;
  game_variant: string;
  big_blind: number;
  players: Array<{ seat: number; userId: string }>;
  actions: Array<Record<string, unknown>>;
  hole_cards?: Record<string, Card[]> | null;
  community_cards?: Card[] | null;
  board?: Card[] | null;
}

/**
 * The read families measured. `legacy:*` are the lifetime HorseMind
 * accessors (null below their own sample gate); `exploit:*` are the decayed,
 * prior-shrunk posterior means of the exploit counters the shared memory
 * pools (always defined). `calibrated:*` are the same accessors with the
 * read calibration options on (HorseMind DecisionReadOptions).
 */
export type CalibrationRead =
  | 'legacy:vpip'
  | 'legacy:pfr'
  | 'legacy:foldToCbet'
  | 'legacy:riverFold'
  | 'legacy:foldVsAggr'
  | 'legacy:foldVsAggrPostflop'
  | 'legacy:postflopAggression'
  | 'legacy:bigBetStrong'
  | 'calibrated:foldToCbet'
  | 'calibrated:riverFold'
  | 'calibrated:foldVsAggrPostflop'
  | `exploit:${ExploitStat}`;

export interface CalibrationEvent {
  /** hand start, ms since epoch */
  t: number;
  handId: string;
  userId: string;
  read: CalibrationRead;
  scope: ReadScope;
  variant: string;
  mode: MemoryMode;
  /** successes and opportunities the read was built from (decayed for exploit) */
  k: number;
  n: number;
  /** the value the accessor returned, null when it declined (below its gate) */
  pred: number | null;
  /** whether the scoped bucket answered (legacy reads) */
  scoped: boolean;
  /** legacy reads: the same counters in the scoped bucket and the pooled one */
  sk?: number;
  sn?: number;
  pk?: number;
  pn?: number;
  /** pooled hands this player had been observed in before this hand */
  hands: number;
  /** ms since this player was last observed (null on first sight) */
  gapMs: number | null;
  /** outcome: successes and opportunities this hand, by the engine's own counters */
  y: number;
  m: number;
}

const ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in', 'discard']);
const STAGES = new Set(['preflop', 'flop', 'pineapple_discard', 'turn', 'river', 'showdown']);
const FOLD_ORIGINS = new Set(['player', 'pre_action', 'horse_policy', 'unknown', 'horse_fallback']);

/**
 * The controller-action projection completedHandActionsForMind applies, but
 * tolerant of a missing legacy timestamp: the live observer saw those hands
 * action by action, so the replay must not drop them.
 */
export function controllerActions(raw: ReadonlyArray<Record<string, unknown>>): ActionRecord[] {
  const out: ActionRecord[] = [];
  for (const a of raw) {
    if (!a || typeof a.action !== 'string' || !ACTIONS.has(a.action)) continue;
    if (typeof a.userId !== 'string' || !a.userId || typeof a.stage !== 'string') continue;
    if (!STAGES.has(a.stage)) continue;
    out.push({
      seat: Number(a.seat) || 0,
      userId: a.userId,
      action: a.action as ActionRecord['action'],
      amount: Number(a.amount) || 0,
      timestamp: Number.isFinite(a.timestamp) ? (a.timestamp as number) : 0,
      stage: a.stage as ActionRecord['stage'],
      ...(a.origin === 'forced' ||
      (a.action === 'fold' && typeof a.origin === 'string' && FOLD_ORIGINS.has(a.origin))
        ? { origin: a.origin as ActionRecord['origin'] }
        : {}),
      ...(typeof a.isFullRaise === 'boolean' ? { isFullRaise: a.isFullRaise } : {}),
    });
  }
  return out;
}

const RANK_NAMES = [
  '',
  'high card',
  'pair',
  'two pair',
  'three of a kind',
  'straight',
  'flush',
  'full house',
  'four of a kind',
  'straight flush',
  'royal flush',
];

/** Shown hands named the way settlement names them (category only). */
export function showdownOf(
  h: CalibrationHand
): Array<{ user_id: string; mucked: boolean; hand_name?: string }> | null {
  const shown = h.hole_cards ?? {};
  const board = (h.community_cards?.length ? h.community_cards : h.board) ?? [];
  const ids = Object.keys(shown);
  if (ids.length < 1 || board.length < 5) return null;
  const omaha = /^(plo|flo|omaha)/i.test(h.game_variant);
  const shortDeck = /short/i.test(h.game_variant);
  const out: Array<{ user_id: string; mucked: boolean; hand_name?: string }> = [];
  for (const id of ids) {
    const cards = shown[id];
    if (!Array.isArray(cards) || cards.length < 2) continue;
    try {
      const ev = omaha ? evaluateOmahaHand(cards, board) : evaluateHand(cards, board, shortDeck);
      out.push({ user_id: id, mucked: false, hand_name: RANK_NAMES[ev.ranking] ?? '' });
    } catch {
      /* an unreadable card leaves that player out, as a muck would */
    }
  }
  // A player still in the hand at showdown whose cards were not shown
  // mucked (settlement reports them mucked: true); a big bet that ends in a
  // muck is not value.
  const folded = new Set<string>();
  const acted = new Set<string>();
  for (const a of h.actions ?? []) {
    if (typeof a.userId !== 'string') continue;
    if (a.action === 'fold') folded.add(a.userId);
    else if (ACTIONS.has(String(a.action))) acted.add(a.userId);
  }
  for (const id of acted)
    if (!folded.has(id) && !(id in shown)) out.push({ user_id: id, mucked: true });
  return out.length >= 2 ? out : null;
}

const rate = (k: number, n: number, gate: number): number | null => (n >= gate ? k / n : null);

/** What a READ sees (HorseMind.readStats): the scoped bucket at SCOPE_MIN_HANDS, else pooled. */
function readBucket(
  userId: string,
  scope: ReadScope
): { s: OpponentStats | undefined; scoped: boolean } {
  const sc = HorseMind.getScopedStats(userId, scope);
  if (sc && sc.hands >= SCOPE_MIN_HANDS) return { s: sc, scoped: true };
  return { s: HorseMind.getStats(userId), scoped: false };
}

/** Postflop-only fold-vs-aggression outcome for one hand, same rule as observe(). */
export function postflopFacedAggression(
  actions: readonly ActionRecord[],
  userId: string
): { y: number; m: number } {
  let stage = 'preflop';
  let bettor: string | null = null;
  let y = 0;
  let m = 0;
  for (const a of actions) {
    if (a.origin === 'forced') continue;
    if (a.stage !== stage) {
      stage = a.stage;
      bettor = null;
    }
    const aggr =
      a.action === 'bet' ||
      a.action === 'raise' ||
      (a.action === 'all_in' && a.isFullRaise === true);
    if (stage !== 'preflop' && a.userId === userId && bettor !== null && bettor !== userId) {
      if (aggr || a.action === 'call') m++;
      else if (a.action === 'fold') {
        m++;
        y++;
      }
    }
    if (aggr) bettor = a.userId;
  }
  return { y, m };
}

const EXPLOIT_PAIRS: Record<ExploitStat, [keyof ExploitCounters, keyof ExploitCounters]> = {
  vpip: ['vpip', 'hands'],
  pfr: ['pfr', 'hands'],
  rfi: ['rfi', 'rfiOpp'],
  threeBet: ['threeBet', 'threeBetOpp'],
  foldTo3Bet: ['foldTo3Bet', 'foldTo3BetOpp'],
  betCheckedTo: ['betCheckedTo', 'betCheckedToOpp'],
  foldToBet: ['foldToBet', 'foldToBetOpp'],
  riverCall: ['riverCall', 'riverCallOpp'],
};

/**
 * Replay `hands` (already in chronological order) and report one event per
 * (target player, read) with an outcome opportunity in that hand. Call it
 * inside HorseMind.runInSandbox; it never touches live memory itself.
 */
export function walkForwardReadCalibration(
  hands: Iterable<CalibrationHand>,
  isTarget: (userId: string) => boolean,
  onEvent: (e: CalibrationEvent) => void
): { hands: number; skipped: number } {
  const lastSeen = new Map<string, number>();
  let count = 0;
  let skipped = 0;
  for (const h of hands) {
    const actions = controllerActions(h.actions ?? []);
    const dealt = (h.players ?? []).length;
    if (actions.length === 0 || dealt < 2) {
      skipped++;
      continue;
    }
    count++;
    const t = Date.parse(h.started_at || h.created_at);
    const scope = readScopeOf(h.game_variant, dealt);
    const mode: MemoryMode = h.tournament_id ? 'tournament' : 'cash';
    const variant = h.game_variant;
    const targets = [...new Set(actions.map((a) => a.userId))].filter(isTarget);

    // Predictions, before this hand is observed.
    HorseMind.setDecisionScope(scope, variant, mode);
    const before = new Map<
      string,
      {
        pooled: OpponentStats | undefined;
        read: OpponentStats | undefined;
        scopedRow: OpponentStats | undefined;
        scoped: boolean;
        ex: ExploitCounters | undefined;
        legacy: {
          foldToCbet: number | null;
          riverFold: number | null;
          bigBet: number | null;
          foldVsAggr: number | null;
        };
        calibrated: {
          foldToCbet: number | null;
          riverFold: number | null;
          foldVsAggr: number | null;
        };
      }
    >();
    try {
      for (const id of targets) {
        HorseMind.setDecisionReadOptions({});
        const legacy = {
          foldToCbet: HorseMind.foldToCbetOf(id),
          riverFold: HorseMind.riverFoldRate(id),
          bigBet: HorseMind.bigBetValueTendency(id),
          foldVsAggr: HorseMind.foldVsAggressionRate(id),
        };
        HorseMind.setDecisionReadOptions({ postflopFoldRate: true, shrinkResponseReads: true });
        const calibrated = {
          foldToCbet: HorseMind.foldToCbetOf(id),
          riverFold: HorseMind.riverFoldRate(id),
          foldVsAggr: HorseMind.foldVsAggressionRate(id),
        };
        HorseMind.setDecisionReadOptions({});
        const pooled = HorseMind.getStats(id);
        const { s, scoped } = readBucket(id, scope);
        const ex = HorseMind.getExploitCounters(id, scope);
        before.set(id, {
          pooled: pooled ? { ...pooled } : undefined,
          read: s ? { ...s } : undefined,
          scopedRow: HorseMind.getScopedStats(id, scope)
            ? { ...HorseMind.getScopedStats(id, scope)! }
            : undefined,
          scoped,
          ex: ex ? { ...ex } : undefined,
          legacy,
          calibrated,
        });
      }
    } finally {
      HorseMind.setDecisionScope(null);
    }

    // Observe exactly as the completed-hand learner does.
    const identity = {
      version: 1 as const,
      tableId: h.table_id,
      handNumber: Number(h.hand_number),
    };
    HorseMind.setDecisionScope(scope);
    try {
      HorseMind.observe(actions, [], identity, dealt);
    } finally {
      HorseMind.setDecisionScope(null);
    }
    HorseMind.observeHandComplete(
      `${h.table_id}:${h.hand_number}`,
      h.actions as never,
      Number(h.big_blind) || 1,
      showdownOf(h),
      scope,
      false,
      { variant, boardCount: 1 }
    );
    const increments = exploitHandIncrements(actions, true);
    const env = exploitEnvelopeFor(scope, variant);

    // Outcomes: what the engine itself added for this player.
    for (const id of targets) {
      const b = before.get(id)!;
      const after = HorseMind.getStats(id);
      if (!after) continue;
      const prior = (b.pooled ?? {}) as Partial<Record<keyof OpponentStats, unknown>>;
      const d = (f: keyof OpponentStats): number => Number(after[f] ?? 0) - Number(prior[f] ?? 0);
      const r = b.read;
      const base = {
        t,
        handId: h.id,
        userId: id,
        scope,
        variant,
        mode,
        scoped: b.scoped,
        hands: Number(prior.hands ?? 0),
        gapMs: lastSeen.has(id) ? t - lastSeen.get(id)! : null,
      };
      const emit = (
        read: CalibrationRead,
        k: number,
        n: number,
        pred: number | null,
        y: number,
        m: number,
        fields?: [keyof OpponentStats, keyof OpponentStats]
      ): void => {
        if (m <= 0) return;
        const alt = fields
          ? {
              sk: Number(b.scopedRow?.[fields[0]] ?? 0),
              sn: Number(b.scopedRow?.[fields[1]] ?? 0),
              pk: Number(b.pooled?.[fields[0]] ?? 0),
              pn: Number(b.pooled?.[fields[1]] ?? 0),
            }
          : {};
        onEvent({ ...base, read, k, n, pred, y, m, ...alt });
      };
      const hands = r?.hands ?? 0;
      if (d('hands') > 0) {
        emit(
          'legacy:vpip',
          r?.vpip ?? 0,
          hands,
          rate(r?.vpip ?? 0, hands, 1),
          d('vpip') > 0 ? 1 : 0,
          1
        );
        emit(
          'legacy:pfr',
          r?.pfr ?? 0,
          hands,
          rate(r?.pfr ?? 0, hands, 1),
          d('pfr') > 0 ? 1 : 0,
          1
        );
      }
      emit(
        'legacy:foldToCbet',
        r?.cbetFolds ?? 0,
        r?.cbetOpps ?? 0,
        b.legacy.foldToCbet,
        d('cbetFolds'),
        d('cbetOpps'),
        ['cbetFolds', 'cbetOpps']
      );
      emit(
        'legacy:riverFold',
        r?.riverBetFolds ?? 0,
        r?.riverBetOpps ?? 0,
        b.legacy.riverFold,
        d('riverBetFolds'),
        d('riverBetOpps'),
        ['riverBetFolds', 'riverBetOpps']
      );
      emit(
        'legacy:bigBetStrong',
        r?.bigBetSDStrong ?? 0,
        r?.bigBetSD ?? 0,
        b.legacy.bigBet,
        d('bigBetSDStrong'),
        d('bigBetSD')
      );
      // legacyExploit's fold rate (lifetime folds / faced aggression, gate 8),
      // scored on its own counters and on postflop spots only, which is where
      // its bluffMod is spent.
      const fvaPred = b.legacy.foldVsAggr;
      emit(
        'legacy:foldVsAggr',
        r?.folds ?? 0,
        r?.facedAggr ?? 0,
        fvaPred,
        d('folds'),
        d('facedAggr')
      );
      const pf = postflopFacedAggression(actions, id);
      emit('legacy:foldVsAggrPostflop', r?.folds ?? 0, r?.facedAggr ?? 0, fvaPred, pf.y, pf.m, [
        'folds',
        'facedAggr',
      ]);
      const fb = b.ex;
      emit(
        'calibrated:foldVsAggrPostflop',
        Number(fb?.foldToBet ?? 0),
        Number(fb?.foldToBetOpp ?? 0),
        b.calibrated.foldVsAggr,
        pf.y,
        pf.m
      );
      emit(
        'calibrated:foldToCbet',
        r?.cbetFolds ?? 0,
        r?.cbetOpps ?? 0,
        b.calibrated.foldToCbet,
        d('cbetFolds'),
        d('cbetOpps')
      );
      emit(
        'calibrated:riverFold',
        r?.riverBetFolds ?? 0,
        r?.riverBetOpps ?? 0,
        b.calibrated.riverFold,
        d('riverBetFolds'),
        d('riverBetOpps')
      );
      // Postflop aggression share (AF = p / (1 - p)), gate as legacyExploit.
      const pa = r?.postAggr ?? 0;
      const pp = r?.postPassive ?? 0;
      emit(
        'legacy:postflopAggression',
        pa,
        pa + pp,
        rate(pa, pa + pp, 10),
        d('postAggr'),
        d('postAggr') + d('postPassive')
      );

      // Exploit counters: the posterior the read is built from.
      const inc = increments.get(id);
      if (inc && env) {
        for (const stat of EXPLOIT_STATS) {
          const [sk, nk] = EXPLOIT_PAIRS[stat];
          const k = Number(b.ex?.[sk] ?? 0);
          const n = Number(b.ex?.[nk] ?? 0);
          emit(
            `exploit:${stat}`,
            k,
            n,
            statRead(k, n, env[stat]).mean,
            Number(inc[sk] ?? 0),
            Number(inc[nk] ?? 0)
          );
        }
      }
      lastSeen.set(id, t);
    }
    for (const a of actions) if (!isTarget(a.userId)) lastSeen.set(a.userId, t);
  }
  return { hands: count, skipped };
}
