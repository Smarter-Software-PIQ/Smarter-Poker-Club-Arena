/**
 * Decision-by-decision audit of Horse play in No-Limit Hold'em hands with people (read-only).
 * Method: docs/ops/horse-hand-audit-holdem.md. CLI: scripts/ops/horse-hand-audit-holdem.mjs.
 *
 * Three tiers:
 *   A exact  - a Horse decision whose hole cards were SHOWN at showdown: equity against each live opponent's measured
 *              line range (and, labelled hindsight, against the opponents' shown cards), every legal action priced,
 *              the action taken graded CORRECT / MISTAKE with its cost in bb.
 *   B range  - every Horse decision is counted in its node; nodes are graded by frequency against the price
 *              (fold vs s/(1+s), bet success vs s/(1+s)); unshown decisions carry their node's verdict.
 *   C results- per hand: people's and Horses' net bb, and the all-in equity adjustment where every live hand was shown.
 *
 * SHOWN-CARDS RULE: the SQL reads hole cards only through the showdown list, only for seats whose `mucked` is the
 * literal false, and never selects players[].cards, winners[].hand or summary (see buildHandsSql and its test).
 */
import { keysetSql } from './horse-audit-paged-read.mjs';
import {
  COMBO_A,
  COMBO_B,
  COMBO_CLASS,
  NC,
  NO_SHOWDOWN,
  className,
  ONE_PAIR,
  comboIndex,
  drawInfo,
  equityVector,
  equityVsRange,
  exactEquity,
  fullRange,
  handClass,
  keepBands,
  keepBands as keepBandsHard,
  keepTop,
  multiwayEquity,
  parseCard,
  preflopEquityVector,
  preflopStrength,
  rangeWeight,
  removeDead,
  streetTable,
  strengthVector,
} from './horse-hand-audit-holdem-eval.mjs';

export const EXIT_OK = 0;
export const EXIT_WORSE = 1;
export const EXIT_TOO_FEW = 2;
export const EXIT_USAGE = 64;
export const EXIT_FAILED = 70;
export const MODES = ['cash', 'tournament', 'all'];
export const STATEMENT_TIMEOUT_SECONDS = 60;
export const DEFAULT_RANGE_HOURS = 24;
export const MAX_RANGE_DAYS = 14;
export const CHUNK_HOURS = 6;
export const MIN_PERSON_HANDS = 50;
export const MIN_NODE_N = 15;
export const STREETS = ['preflop', 'flop', 'turn', 'river'];

/** Grading tolerance: an action within max(0.5 bb, 5% of the pot) of the best priced action is CORRECT. */
export const TOL_BB = 0.5;
export const TOL_POT = 0.05;
/** Realisation of equity on a non-final street (the share of raw equity a call or check is credited with). */
export const REALISATION = {
  preflop: { ip: 0.9, oop: 0.8 },
  flop: { ip: 0.92, oop: 0.85 },
  turn: { ip: 0.92, oop: 0.85 },
};

/** Switch and engine events (regimes). */
export const EVENTS = [
  {
    key: 'holdemValueAndCallsArePriced',
    on: '2026-11-22T23:25:25Z',
    off: '2026-11-24T06:07:29Z',
    scope: 'cash',
  },
  {
    key: 'holdemTournamentAllInCallIsPriced',
    on: '2026-11-23T01:25:29Z',
    off: null,
    scope: 'tournament',
  },
  { key: 'cashDefenceTrimColdCalls', on: '2026-11-24T08:17:54Z', off: null, scope: 'cash' },
];
export function regimeOf(tsMs, isTour) {
  if (isTour)
    return tsMs >= Date.parse(EVENTS[1].on)
      ? 'T1 all-in call priced'
      : 'T0 before all-in call priced';
  if (tsMs < Date.parse(EVENTS[0].on)) return 'A before value-and-calls priced';
  if (tsMs < Date.parse(EVENTS[0].off)) return 'B value-and-calls priced ON';
  if (tsMs < Date.parse(EVENTS[2].on)) return 'C rolled back';
  return 'D cold-call trim ON';
}

/**
 * Fitted population priors (heads-up), copied from server/src/engine/HorseHoldemLateStreetPriors.ts version
 * 2026-11-24.v3 on the local branch of the Hold'em late-street work (not on main when this was written).
 * Fold of the defender to the first wager of the street by the bettor's line and size bucket (<=1/3, <=2/3, <=pot,
 * over); fold to a raise of one's own bet; bet share of the player whose wager it is (first to act / checked to).
 */
export const PRIORS_VERSION = '2026-11-24.v3';
export const FOLD_PRIOR = {
  flop: {
    checkthrough: [0.2759, 0.4298, 0.5676, 0.4762],
    barrel: [0.3357, 0.4369, 0.5172, 0.6992],
    lead: [0.211, 0.197, 0.3333, 0.4839],
    other: [0.45, 0.45, 0.45, 0.45],
  },
  turn: {
    checkthrough: [0.3641, 0.4771, 0.6728, 0.8417],
    barrel: [0.21, 0.374, 0.5701, 0.7108],
    lead: [0.1656, 0.39, 0.4483, 0.4101],
    other: [0.45, 0.45, 0.45, 0.45],
  },
  river: {
    checkthrough: [0.4287, 0.6346, 0.7678, 0.8274],
    barrel: [0.3076, 0.5078, 0.6959, 0.7616],
    lead: [0.2465, 0.4941, 0.6935, 0.7601],
    other: [0.45, 0.45, 0.45, 0.45],
  },
};
export const FOLD_TO_RAISE_PRIOR = { flop: 0.5914, turn: 0.5061, river: 0.4636 };
export const BET_SHARE_PRIOR = {
  flop: {
    checkthrough: { first: 0.398, checkedTo: 0.4323 },
    barrel: { first: 0.5384, checkedTo: 0.6914 },
    lead: { first: 0.0068, checkedTo: 0.4496 },
    other: { first: 0.45, checkedTo: 0.45 },
  },
  turn: {
    checkthrough: { first: 0.5117, checkedTo: 0.4447 },
    barrel: { first: 0.6298, checkedTo: 0.5246 },
    lead: { first: 0.0235, checkedTo: 0.8327 },
    other: { first: 0.45, checkedTo: 0.45 },
  },
  river: {
    checkthrough: { first: 0.1355, checkedTo: 0.4406 },
    barrel: { first: 0.6325, checkedTo: 0.6153 },
    lead: { first: 0.1346, checkedTo: 0.3937 },
    other: { first: 0.45, checkedTo: 0.45 },
  },
};
export function sizeBucketIndex(s) {
  return s <= 0.34 ? 0 : s <= 0.67 ? 1 : s <= 1.01 ? 2 : 3;
}
export const SIZE_LABELS = ['<=1/3', '1/3-2/3', '2/3-pot', 'overbet'];
/** Equilibrium bluff share of a bet of s pots (the caller's indifference): s / (1 + 2s). */
export const bluffShare = (s) => Math.max(0, Math.min(0.45, s / (1 + 2 * s)));

// ---------------------------------------------------------------------------------------------------
// CLI plan and SQL
// ---------------------------------------------------------------------------------------------------
export function parseInstant(flag, v) {
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(String(v)))
    throw new Error(`${flag} needs an instant with a zone, such as 2026-11-24T06:00:00Z`);
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new Error(`${flag}: not a valid instant: ${v}`);
  return t;
}
export function resolvePlan(o, nowMs) {
  if (!MODES.includes(o.mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  const until = o.until ?? nowMs;
  const since = o.since ?? until - DEFAULT_RANGE_HOURS * 3600_000;
  if (!(since < until)) throw new Error('--since must be before --until');
  if (until - since > MAX_RANGE_DAYS * 86400_000)
    throw new Error(`the range may span at most ${MAX_RANGE_DAYS} days`);
  const splitAt = o.splitAt ?? null;
  if (splitAt !== null && !(splitAt > since && splitAt < until))
    throw new Error('--split-at must lie inside --since/--until');
  // Comparison window: before --split-at when given, else the same length immediately before --since.
  const compare =
    splitAt !== null ? { since, until: splitAt } : { since: since - (until - since), until: since };
  const current = splitAt !== null ? { since: splitAt, until } : { since, until };
  return {
    since: Math.min(since, compare.since),
    until,
    mode: o.mode,
    peopleOnly: o.peopleOnly !== false,
    splitAt,
    compare,
    current,
  };
}
export function chunks(since, until, hours = CHUNK_HOURS) {
  const out = [];
  for (let t = since; t < until; t += hours * 3600_000)
    out.push([t, Math.min(until, t + hours * 3600_000)]);
  return out;
}
const iso = (ms) => new Date(ms).toISOString();

/** The one read-only SELECT for one time chunk. Hole cards only through the showdown list, never for mucked seats. */
/**
 * A player's profile id as a uuid the profiles primary key can be looked up by (2026-11-26). The join was
 * `pr.id::text = p->>'userId'`, which no index serves: every player of every hand scanned profiles (about 4 million
 * buffer reads and 6.7 s for one 1,500-hand tournament page, against 0.9 s this way). A userId that is not a
 * lower-case uuid matched no profile before (id::text is lower case) and matches none now (NULL).
 */
export const PLAYER_PROFILE_ID = (v) =>
  `(CASE WHEN ${v}->>'userId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (${v}->>'userId')::uuid END)`;

export function buildHandsSql({
  since,
  until,
  mode,
  peopleOnly,
  showdownOnly = false,
  after = null,
  limit = null,
}) {
  // a keyset page (horse-audit-paged-read.mjs) when a limit is given: rows after the cursor, at most `limit`
  const page = limit === null ? null : keysetSql(after, { limit });
  const modeSql =
    mode === 'cash'
      ? 'AND h.tournament_id IS NULL'
      : mode === 'tournament'
        ? 'AND h.tournament_id IS NOT NULL'
        : '';
  const peopleSql = peopleOnly
    ? `AND EXISTS (SELECT 1 FROM jsonb_array_elements(h.players) p JOIN public.profiles pr ON pr.id = ${PLAYER_PROFILE_ID('p')} WHERE pr.is_horse IS NOT TRUE)`
    : '';
  return `WITH hh AS (
  SELECT h.id, h.created_at, h.tournament_id, h.big_blind, h.small_blind, h.button_seat, h.board, h.engine_build,
         h.rake_amount, h.bbj_amount, h.players, h.showdown, h.winners, h.pots, h.actions, h.hole_cards
  FROM public.hand_history h
  WHERE h.created_at >= '${iso(since)}'::timestamptz AND h.created_at < '${iso(until)}'::timestamptz
    AND h.game_variant = 'nlh'
    AND (h.bomb_pot IS NULL OR jsonb_typeof(h.bomb_pot) = 'null')
    ${modeSql}
    ${peopleSql}
    ${showdownOnly ? "AND jsonb_array_length(coalesce(h.showdown, '[]'::jsonb)) >= 2" : ''}
    ${page ? `${page.where}\n  ${page.order}` : ''}
)
SELECT jsonb_build_object(
  'id', hh.id, 'ts', hh.created_at, 'tid', hh.tournament_id, 'bb', hh.big_blind, 'sb', hh.small_blind,
  'btn', hh.button_seat, 'board', hh.board, 'build', left(hh.engine_build, 12), 'rake', hh.rake_amount, 'bbj', hh.bbj_amount,
  'tt', t.tournament_type, 'tmax', t.max_players, 'tbuy', coalesce(t.buy_in_amount, 0) + coalesce(t.buy_in_fee, 0),
  'taof', t.all_in_or_fold, 'tname', t.name,
  'pl', (SELECT jsonb_agg(jsonb_build_array((p->>'seat')::int, p->>'userId', p->>'username', (p->>'stack')::float8, coalesce(pr.is_horse, false)))
         FROM jsonb_array_elements(hh.players) p LEFT JOIN public.profiles pr ON pr.id = ${PLAYER_PROFILE_ID('p')}),
  'sd', (SELECT jsonb_agg(jsonb_build_array((s->>'seat')::int, s->>'user_id', s->>'mucked'))
         FROM jsonb_array_elements(coalesce(hh.showdown, '[]'::jsonb)) s),
  'shown', (SELECT jsonb_object_agg(s->>'user_id', hh.hole_cards -> (s->>'user_id'))
            FROM jsonb_array_elements(coalesce(hh.showdown, '[]'::jsonb)) s
            WHERE s->>'mucked' = 'false' AND hh.hole_cards ? (s->>'user_id')),
  'win', (SELECT jsonb_agg(jsonb_build_array(w->>'userId', (w->>'amount')::float8))
          FROM jsonb_array_elements(coalesce(hh.winners, '[]'::jsonb)) w),
  'pots', (SELECT jsonb_agg(jsonb_build_array((x->>'amount')::float8, x->'eligible'))
           FROM jsonb_array_elements(coalesce(hh.pots, '[]'::jsonb)) x),
  'stage', (SELECT a->'publicNode'->'tournamentStage' FROM jsonb_array_elements(hh.actions) WITH ORDINALITY q(a, o)
            WHERE a ? 'publicNode' ORDER BY o LIMIT 1),
  'acts', (SELECT jsonb_agg(jsonb_build_array(a->>'seat', a->>'stage', a->>'action', (a->>'amount')::float8, a->>'origin',
                  (a->'publicNode'->>'pot')::float8, (a->'publicNode'->>'toCall')::float8, (a->'publicNode'->>'currentBet')::float8,
                  a->'publicNode'->'seats', a->'publicNode'->>'allInOrFold') ORDER BY o)
           FROM jsonb_array_elements(hh.actions) WITH ORDINALITY q(a, o))
) AS hand
FROM hh LEFT JOIN public.tournaments t ON t.id = hh.tournament_id
ORDER BY hh.created_at${page ? ', hh.id' : ''}`;
}

/** People's entries, finishing places and prizes in the given tournaments (ids from the window's hands; no cards). */
export function buildTournamentSql({ since, until, tids = null }) {
  if (Array.isArray(tids)) {
    const ids = tids.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
    if (!ids.length) return null;
    return `SELECT jsonb_build_object('tid', tp.tournament_id, 'uid', tp.user_id, 'name', tp.username, 'status', tp.status,
  'pos', tp.position, 'prize', tp.prize, 'rebuys', tp.rebuys, 'tt', t.tournament_type, 'tmax', t.max_players,
  'tstatus', t.status, 'taof', t.all_in_or_fold, 'buy', coalesce(t.buy_in_amount, 0) + coalesce(t.buy_in_fee, 0),
  'field', (SELECT count(*) FROM public.tournament_players x WHERE x.tournament_id = tp.tournament_id),
  'paid', (SELECT count(*) FROM public.tournament_players x WHERE x.tournament_id = tp.tournament_id AND coalesce(x.prize, 0) > 0)) AS entry
FROM public.tournament_players tp
JOIN public.tournaments t ON t.id = tp.tournament_id
JOIN public.profiles pr ON pr.id = tp.user_id AND pr.is_horse IS NOT TRUE
WHERE tp.tournament_id = ANY('{${ids.join(',')}}'::uuid[])`;
  }
  return `WITH tids AS (
  SELECT DISTINCT h.tournament_id FROM public.hand_history h
  WHERE h.created_at >= '${iso(since)}'::timestamptz AND h.created_at < '${iso(until)}'::timestamptz
    AND h.game_variant = 'nlh' AND h.tournament_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(h.players) p JOIN public.profiles pr ON pr.id = ${PLAYER_PROFILE_ID('p')} WHERE pr.is_horse IS NOT TRUE)
)
SELECT jsonb_build_object('tid', tp.tournament_id, 'uid', tp.user_id, 'name', tp.username, 'status', tp.status,
  'pos', tp.position, 'prize', tp.prize, 'rebuys', tp.rebuys, 'tt', t.tournament_type, 'tmax', t.max_players,
  'tstatus', t.status, 'taof', t.all_in_or_fold, 'buy', coalesce(t.buy_in_amount, 0) + coalesce(t.buy_in_fee, 0),
  'field', (SELECT count(*) FROM public.tournament_players x WHERE x.tournament_id = tp.tournament_id),
  'paid', (SELECT count(*) FROM public.tournament_players x WHERE x.tournament_id = tp.tournament_id AND coalesce(x.prize, 0) > 0)) AS entry
FROM public.tournament_players tp
JOIN public.tournaments t ON t.id = tp.tournament_id
JOIN public.profiles pr ON pr.id = tp.user_id AND pr.is_horse IS NOT TRUE
WHERE tp.tournament_id IN (SELECT tournament_id FROM tids)`;
}

// ---------------------------------------------------------------------------------------------------
// Parsing and replay
// ---------------------------------------------------------------------------------------------------
const FORCED = new Set(['sb', 'bb', 'ante', 'straddle', 'post', 'dead', 'posted']);
export function formatOf(h) {
  if (!h.tid) return 'cash';
  const tt = String(h.tt || '').toUpperCase();
  if (tt === 'SPIN') return 'spin';
  if (tt === 'SNG') return Number(h.tmax) === 2 ? 'hu' : 'sng';
  if (h.taof) return 'mtt-aof';
  return 'mtt';
}
export const isTourFormat = (f) => f !== 'cash';

/** Parse one SQL row into a hand with a replayed decision list. Returns null when the hand cannot be replayed. */
export function parseHand(raw) {
  const h = raw.hand ?? raw;
  if (!h || !Array.isArray(h.acts) || !Array.isArray(h.pl)) return null;
  const bb = Number(h.bb);
  if (!(bb > 0)) return null;
  const seats = new Map();
  for (const [seat, uid, name, stack, horse] of h.pl)
    seats.set(Number(seat), {
      seat: Number(seat),
      uid,
      name,
      horse: !!horse,
      stack0: Number(stack) || 0,
    });
  const board = (Array.isArray(h.board) ? h.board : []).map(parseCard).filter((c) => c >= 0);
  const shown = new Map();
  for (const [uid, cs] of Object.entries(h.shown || {})) {
    if (!Array.isArray(cs) || cs.length !== 2) continue;
    const cards = cs.map(parseCard);
    if (cards.every((c) => c >= 0) && cards[0] !== cards[1]) shown.set(uid, cards);
  }
  const fmt = formatOf(h);
  const ts = Date.parse(String(h.ts).replace(' ', 'T').replace(/\+00$/, 'Z'));
  const H = {
    id: h.id,
    ts,
    fmt,
    tour: isTourFormat(fmt),
    bb,
    sbv: Number(h.sb) || bb / 2,
    btn: Number(h.btn),
    board,
    build: h.build || 'unknown',
    rake: Number(h.rake) || 0,
    bbj: Number(h.bbj) || 0,
    seats,
    shown,
    tname: h.tname || null,
    tid: h.tid || null,
    tbuy: Number(h.tbuy) || 0,
    stage: h.stage || null,
    sd: new Map(),
    win: new Map(),
    pots: h.pots || [],
    decisions: [],
    invested: new Map(),
    returned: new Map(),
    streetsSeen: 1,
  };
  for (const [seat, uid, mucked] of h.sd || [])
    H.sd.set(Number(seat), { uid, mucked: String(mucked) !== 'false' });
  for (const [uid, amt] of h.win || []) H.win.set(uid, (H.win.get(uid) || 0) + (Number(amt) || 0));
  replay(H, h.acts);
  return H;
}
const posKey = (seat, btn) => (seat <= btn ? seat + 100 : seat);

function replay(H, acts) {
  const st = new Map(); // seat -> {inHand, allIn, streetBet}
  for (const s of H.seats.keys()) st.set(s, { inHand: true, allIn: false, streetBet: 0 });
  let street = 'preflop';
  let lastAggr = null; // seat of last wager on the current street
  const streetAggr = { preflop: null, flop: null, turn: null, river: null };
  let raisesThisStreet = 0;
  let checkedThisStreet = new Set();
  let actedThisStreet = new Set();
  let sbSeat = null;
  let bbSeat = null;
  let preflopRaiser = null;
  let limpers = 0;
  for (const a of acts) {
    const [seatS, stage, action, amountRaw, origin, pot, toCall, currentBet, snap, aof] = a;
    const seat = seatS === null || seatS === undefined ? null : Number(seatS);
    const amount = Number(amountRaw) || 0;
    if (action === 'return') {
      if (seat !== null) H.returned.set(seat, (H.returned.get(seat) || 0) + amount);
      continue;
    }
    if (!STREETS.includes(stage)) continue;
    if (stage !== street) {
      street = stage;
      H.streetsSeen = Math.max(H.streetsSeen, STREETS.indexOf(stage) + 1);
      for (const v of st.values()) v.streetBet = 0;
      lastAggr = null;
      raisesThisStreet = 0;
      checkedThisStreet = new Set();
      actedThisStreet = new Set();
    }
    const S = st.get(seat);
    if (FORCED.has(action) || origin === 'forced') {
      if (seat === null || !S) continue;
      H.invested.set(seat, (H.invested.get(seat) || 0) + amount);
      if (action === 'ante') H.anteTotal = (H.anteTotal || 0) + amount;
      if (action !== 'ante' && action !== 'dead') S.streetBet += amount;
      if (action === 'sb') sbSeat = seat;
      if (action === 'bb') bbSeat = seat;
      continue;
    }
    if (!S || !Array.isArray(snap)) continue;
    const row = snap.find((x) => Number(x[0]) === seat);
    if (!row) continue;
    const stackBefore = Number(row[1]) || 0;
    const sbBefore = Number(row[2]) || 0;
    const P = Number(pot) || 0;
    const C = Number(toCall) || 0;
    const CB = Number(currentBet) || 0;
    let kind = action;
    let inc = 0;
    let to = sbBefore;
    if (action === 'fold') kind = 'fold';
    else if (action === 'check') kind = 'check';
    else if (action === 'call') {
      inc = amount;
      to = sbBefore + inc;
    } else if (action === 'bet') {
      inc = Math.max(0, amount - sbBefore);
      to = sbBefore + inc;
    } else if (action === 'raise') {
      inc = Math.max(0, amount - sbBefore);
      to = amount;
      kind = CB <= 0 ? 'bet' : 'raise';
    } else if (action === 'all_in') {
      inc = stackBefore;
      to = sbBefore + stackBefore;
      kind = to <= CB + 1e-9 ? 'call' : CB <= 0 ? 'bet' : 'raise';
    } else continue;
    const allInAfter = inc > 0 && inc >= stackBefore - 1e-9;
    // opponents still in (not folded) at the decision, from the replay
    const live = [...st.entries()].filter(([s2, v]) => s2 !== seat && v.inHand).map(([s2]) => s2);
    const snapBy = new Map(snap.map((x) => [Number(x[0]), x]));
    const opp = live.map((s2) => {
      const r = snapBy.get(s2) || [];
      return {
        seat: s2,
        vol: actedThisStreet.has(s2),
        stack: Number(r[1]) || 0,
        streetBet: Number(r[2]) || 0,
        allIn: st.get(s2).allIn,
        toAct: !actedThisStreet.has(s2) || (Number(r[2]) || 0) < Math.max(CB, to),
      };
    });
    // node type
    let node;
    if (street === 'preflop') {
      const bigBet = H.bb;
      if (raisesThisStreet === 0)
        node = CB > bigBet + 1e-9 ? 'vsOpen' : limpers > 0 ? 'vsLimp' : 'unopened';
      else node = raisesThisStreet === 1 ? 'vsOpen' : raisesThisStreet === 2 ? 'vs3bet' : 'vs4bet+';
      if (raisesThisStreet >= 2 && !actedThisStreet.has(seat)) node += '-cold';
      if (C > 0 && lastAggr !== null && st.get(lastAggr)?.allIn && raisesThisStreet >= 1)
        node = 'vsJam';
    } else {
      node =
        C > 0
          ? raisesThisStreet >= 2
            ? 'vsRaise'
            : 'vsBet'
          : checkedThisStreet.size > 0
            ? 'checkedTo'
            : 'first';
    }
    const order = [...st.entries()]
      .filter(([, v]) => v.inHand)
      .map(([s2]) => s2)
      .sort((x, y) => posKey(x, H.btn) - posKey(y, H.btn));
    const ip = order[order.length - 1] === seat;
    const d = {
      i: H.decisions.length,
      seat,
      street,
      node,
      kind,
      origin,
      P,
      C,
      CB,
      to,
      inc,
      stack: stackBefore,
      streetBet: sbBefore,
      allInAfter,
      ip,
      hu: live.length === 1,
      nLive: live.length + 1,
      opp,
      aggr: lastAggr,
      raisesBefore: raisesThisStreet,
      checkedBefore: checkedThisStreet.size,
      prevStreetAggr:
        street === 'preflop' ? null : streetAggr[STREETS[STREETS.indexOf(street) - 1]],
      preflopRaiser,
      aof: aof === 'true',
      sbSeat,
      bbSeat,
      limpers,
    };
    H.decisions.push(d);
    // apply
    if (inc > 0) H.invested.set(seat, (H.invested.get(seat) || 0) + inc);
    S.streetBet = to;
    if (kind === 'fold') S.inHand = false;
    if (allInAfter) S.allIn = true;
    if (kind === 'bet' || kind === 'raise') {
      lastAggr = seat;
      streetAggr[street] = seat;
      raisesThisStreet++;
      if (street === 'preflop') preflopRaiser = seat;
    }
    if (kind === 'call' && street === 'preflop' && raisesThisStreet === 0) limpers++;
    if (kind === 'check') checkedThisStreet.add(seat);
    actedThisStreet.add(seat);
  }
  H.sbSeat = sbSeat;
  H.bbSeat = bbSeat;
  H.final = st;
}

/** Players still to act behind a seat that opens preflop (the engine's count: SB 1, BB 0, UTG at n-handed n-1). */
export function playersBehind(H, seat) {
  const order = [...H.seats.keys()].sort((x, y) => posKey(x, H.btn) - posKey(y, H.btn));
  const n = order.length;
  const idx = order.indexOf(seat);
  if (n === 2) return seat === H.btn ? 1 : 0;
  if (idx === 0) return 1;
  if (idx === 1) return 0;
  return n - 1 - idx + 2;
}

/** Position group preflop: SB, BB, BTN, CO, HJ, then EP. */
export function posGroup(H, seat) {
  if (seat === H.sbSeat && H.seats.size > 2) return 'SB';
  if (seat === H.bbSeat) return 'BB';
  if (seat === H.btn) return H.seats.size === 2 ? 'SB' : 'BTN';
  const order = [...H.seats.keys()].sort((x, y) => posKey(x, H.btn) - posKey(y, H.btn)); // SB first ... BTN last
  const i = order.indexOf(seat);
  const fromBtn = order.length - 1 - i;
  if (fromBtn === 1) return 'CO';
  if (fromBtn === 2) return 'HJ';
  return 'EP';
}
export function stackBucket(fmt, bbs) {
  if (isTourFormat(fmt)) return bbs < 10 ? '<10' : bbs < 20 ? '10-20' : bbs < 40 ? '20-40' : '40+';
  return bbs < 40 ? '<40' : bbs < 100 ? '40-100' : '100+';
}
export function sizeLabel(d) {
  if (d.C <= 0) return '-';
  const aggrAllIn = d.aggr !== null && d.opp.find((o) => o.seat === d.aggr)?.allIn;
  if (aggrAllIn) return 'all-in';
  const s = d.C / Math.max(1e-9, d.P - d.C);
  return SIZE_LABELS[sizeBucketIndex(s)];
}
export function lineOf(d, bettorSeat) {
  if (d.street === 'preflop') return '-';
  if (d.street === 'flop')
    return d.preflopRaiser === null
      ? 'checkthrough'
      : d.preflopRaiser === bettorSeat
        ? 'barrel'
        : 'lead';
  if (d.prevStreetAggr === null) return 'checkthrough';
  return d.prevStreetAggr === bettorSeat ? 'barrel' : 'lead';
}

// ---------------------------------------------------------------------------------------------------
// Net results per seat (results tier)
// ---------------------------------------------------------------------------------------------------
export function seatNets(H) {
  const out = new Map();
  for (const [seat, s] of H.seats) {
    const inv = H.invested.get(seat) || 0;
    const ret = H.returned.get(seat) || 0;
    const won = H.win.get(s.uid) || 0;
    out.set(seat, won + ret - inv);
  }
  return out;
}
/** Conservation: invested - returned - winners - rake - jackpot fee, in bb (data-quality check). */
export function conservationGap(H) {
  let inv = 0;
  let ret = 0;
  let won = 0;
  for (const v of H.invested.values()) inv += v;
  for (const v of H.returned.values()) ret += v;
  for (const v of H.win.values()) won += v;
  return (inv - ret - won - H.rake - (H.bbj || 0)) / H.bb;
}

/**
 * All-in equity adjustment: when, after the last decision, at least two players are live, at most one is not all in,
 * and every live player's cards were shown, each pot is re-split by exact equity on the board as it stood.
 * Returns Map seat -> luck in chips (actual won minus equity won), or null.
 */
export function allInLuck(H) {
  const live = [...H.final.entries()].filter(([, v]) => v.inHand).map(([s]) => s);
  if (live.length < 2) return null;
  const notAllIn = live.filter((s) => !H.final.get(s).allIn);
  if (notAllIn.length > 1) return null;
  const hands = live.map((s) => H.shown.get(H.seats.get(s).uid));
  if (hands.some((x) => !x)) return null;
  const lastStreet = H.decisions.length ? H.decisions[H.decisions.length - 1].street : 'preflop';
  // the board at the moment the money went in: cards dealt through the street of the last decision
  let k = { preflop: 0, flop: 3, turn: 4, river: 5 }[lastStreet];
  if (k >= 5) return null; // nothing left to come
  if (H.board.length < 5) return null;
  const board = H.board.slice(0, k);
  const pots = (H.pots || []).filter((p) => Array.isArray(p) && Number(p[0]) > 0);
  const totalWon = [...H.win.values()].reduce((a, b) => a + b, 0);
  const potSum = pots.reduce((a, p) => a + Number(p[0]), 0) || totalWon;
  const scale = potSum > 0 ? totalWon / potSum : 1;
  const ev = new Map(live.map((s) => [s, 0]));
  const potList = pots.length ? pots : [[totalWon, live.map((s) => H.seats.get(s).uid)]];
  for (const [amt, elig] of potList) {
    const el = live.filter((s) => (Array.isArray(elig) ? elig.includes(H.seats.get(s).uid) : true));
    if (!el.length) continue;
    if (el.length === 1) {
      ev.set(el[0], ev.get(el[0]) + Number(amt) * scale);
      continue;
    }
    const eq = exactEquity(
      el.map((s) => H.shown.get(H.seats.get(s).uid)),
      board
    );
    el.forEach((s, i) => ev.set(s, ev.get(s) + eq[i] * Number(amt) * scale));
  }
  const luck = new Map();
  for (const s of live) luck.set(s, (H.win.get(H.seats.get(s).uid) || 0) - ev.get(s));
  return { luck, street: lastStreet };
}

// ---------------------------------------------------------------------------------------------------
// Measured frequencies (from the window's own decisions, every player) for the range model and fold equity
// ---------------------------------------------------------------------------------------------------
function freqKeyPre(H, d) {
  const stk =
    Math.min(d.stack + d.streetBet, ...d.opp.map((o) => o.stack + o.streetBet).concat([Infinity])) /
    H.bb;
  const sb = isTourFormat(H.fmt) ? (stk < 12 ? 's' : stk < 25 ? 'm' : 'd') : 'd';
  return [H.tour ? 'T' : 'C', d.node, posGroup(H, d.seat), sb];
}
function freqKeyPost(H, d) {
  return [
    H.tour ? 'T' : 'C',
    d.street,
    d.node === 'checkedTo' ? 'first' : d.node,
    d.hu ? 'hu' : 'mw',
    d.C > 0 ? sizeLabel(d) : '-',
  ];
}
function bump(map, key, kind) {
  const k = key.join('|');
  const v = map.get(k) || { n: 0, fold: 0, call: 0, raise: 0, check: 0 };
  v.n++;
  if (kind === 'fold') v.fold++;
  else if (kind === 'call') v.call++;
  else if (kind === 'check') v.check++;
  else v.raise++;
  map.set(k, v);
}
export function measureFrequencies(hands) {
  const pre = new Map();
  const post = new Map();
  const personFold = new Map();
  for (const H of hands)
    for (const d of H.decisions) {
      if (
        d.street !== 'preflop' &&
        d.hu &&
        d.C > 0 &&
        !H.seats.get(d.seat)?.horse &&
        (d.node === 'vsBet' || d.node === 'vsRaise')
      ) {
        const s = d.C / Math.max(1e-9, d.P - d.C);
        const k =
          d.node === 'vsRaise'
            ? `${H.tour ? 'T' : 'C'}|${d.street}|raise`
            : `${H.tour ? 'T' : 'C'}|${d.street}|${lineOf(d, d.aggr)}|${sizeBucketIndex(s)}`;
        const v = personFold.get(k) || { n: 0, f: 0 };
        v.n++;
        if (d.kind === 'fold') v.f++;
        personFold.set(k, v);
      }
      if (d.street === 'preflop') {
        const k = freqKeyPre(H, d);
        for (let cut = 4; cut >= 2; cut--) bump(pre, k.slice(0, cut), d.kind);
      } else {
        const k = freqKeyPost(H, d);
        for (let cut = 5; cut >= 3; cut--) bump(post, k.slice(0, cut), d.kind);
      }
    }
  return { pre, post, personFold };
}
/** Heads-up postflop fold of a PERSON (measurement only): his population's record shrunk 20 toward the fitted prior. */
export function personFoldRate(F, tour, street, line, bucket, prior, raise = false) {
  const v =
    F && F.personFold
      ? F.personFold.get(
          raise
            ? `${tour ? 'T' : 'C'}|${street}|raise`
            : `${tour ? 'T' : 'C'}|${street}|${line}|${bucket}`
        )
      : null;
  return v ? (v.f + 20 * prior) / (v.n + 20) : prior;
}
function lookup(map, key, minN = 30) {
  for (let cut = key.length; cut >= 2; cut--) {
    const v = map.get(key.slice(0, cut).join('|'));
    if (v && v.n >= minN) return v;
  }
  return null;
}
/** Shares of an action class at the decision's node: { fold, call, raise, check } (each 0..1). */
export function nodeShares(F, H, d) {
  const v =
    d.street === 'preflop' ? lookup(F.pre, freqKeyPre(H, d)) : lookup(F.post, freqKeyPost(H, d));
  if (!v)
    return d.C > 0
      ? { fold: 0.5, call: 0.4, raise: 0.1, check: 0 }
      : { fold: 0, call: 0, raise: 0.4, check: 0.6 };
  return { fold: v.fold / v.n, call: v.call / v.n, raise: v.raise / v.n, check: v.check / v.n };
}

// ---------------------------------------------------------------------------------------------------
// Measured bluff share of wagers (shown at showdown only), people and Horses apart for measurement
// ---------------------------------------------------------------------------------------------------
/** A shown wager is a bluff when the bettor's made-hand class on that street has no showdown value
 * (no pair, ace high, or plays the board); on the flop and turn draws without a pair count as bluffs.
 * A bettor who reached showdown and MUCKED (cards never read) is counted apart (m): he lost, so he was a bluff or
 * weaker value; the estimate counts each such wager as half a bluff, and the bounds are k/(n+m) and (k+m)/(n+m). */
export function measureBluffShares(hands) {
  const cells = new Map();
  const add = (key, bluff) => {
    const k = key.join('|');
    const v = cells.get(k) || { n: 0, k: 0, m: 0 };
    if (bluff === null) v.m++;
    else {
      v.n++;
      if (bluff) v.k++;
    }
    cells.set(k, v);
  };
  for (const H of hands)
    for (const d of H.decisions) {
      if (d.street === 'preflop' || !(d.kind === 'bet' || d.kind === 'raise')) continue;
      const me = H.seats.get(d.seat);
      const hole = me && H.shown.get(me.uid);
      const muckedAtShowdown = !hole && H.sd.get(d.seat)?.mucked === true && H.sd.size >= 2;
      if (!hole && !muckedAtShowdown) continue;
      const board = H.board.slice(0, { flop: 3, turn: 4, river: 5 }[d.street]);
      if (board.length < 3) continue;
      const bluff = hole ? NO_SHOWDOWN.has(handClass(hole, board)) : null;
      const who = me.horse ? 'horse' : 'person';
      const s = d.inc / Math.max(1e-9, d.P);
      const fc = H.tour ? 'T' : 'C';
      const line = d.kind === 'raise' ? 'raise' : lineOf(d, d.seat);
      add([fc, who, d.street, line, sizeBucketIndex(s)], bluff);
      add([fc, who, d.street, line], bluff);
      add([fc, who, d.street], bluff);
      add([fc, d.street], bluff);
    }
  return cells;
}
/** Bluff share of a wager by format class, bettor kind, street, line and size: each level shrunk 10 spots toward the
 * level above it; the top level shrinks toward the equilibrium s/(1+2s). */
export function bluffShareOf(B, { tour, who, street, line, s }) {
  if (!B) return bluffShare(s);
  const fc = tour ? 'T' : 'C';
  const keys = [
    [fc, street],
    [fc, who, street],
    [fc, who, street, line],
    [fc, who, street, line, sizeBucketIndex(s)],
  ];
  let est = bluffShare(s);
  for (const k of keys) {
    const v = B.get(k.join('|'));
    if (v) est = (v.k + 0.5 * (v.m || 0) + 10 * est) / (v.n + (v.m || 0) + 10);
  }
  return Math.max(0, Math.min(0.6, est));
}

// ---------------------------------------------------------------------------------------------------
// Range model (per hand, public actions only) and exact-tier grading
// ---------------------------------------------------------------------------------------------------
/** Context of the preflop matrix and strength (shared by every hand). */
export function makeModel({ matrix, freqs, bluffs = null, nash = null }) {
  return {
    M: matrix,
    preS: preflopStrength(matrix),
    F: freqs,
    B: bluffs,
    N: nash ? nashTables(nash) : null,
  };
}

/**
 * Tournament jams are read against equilibrium push/fold (the anchor holdemTournamentAllInCallIsPriced uses):
 * the Nash V2 open-jam range by players behind, depth and dead ante (horse-hand-audit-holdem-nash.json, generated
 * from server/src/engine/HorseNashPushFoldV2.data.ts and checked against it by the unit test), a re-jam the top
 * 18% (8 bb or less) to 6% (25 bb) and a jam over two raises the top 5% to 3.5%, in the engine's strength order.
 * Measured raise shares are NOT used for a jam: at short stacks they mix min-raises with jams and gave a jam range
 * about 0.6 of the width real jams show at showdown (trace of 2026-11-24).
 */
export const REJAM_WIDTH = [0.18, 0.06];
export const OVER_THREE_BET_JAM_WIDTH = [0.05, 0.035];
const lerpW = (x, x0, x1, y0, y1) =>
  x <= x0 ? y0 : x >= x1 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
function nashTables(N) {
  const mine = new Map();
  for (let k = 0; k < 169; k++) mine.set(className(k), k);
  const toMine = N.classes.map((c) => mine.get(c));
  if (toMine.some((x) => x === undefined)) throw new Error('nash table class names do not match');
  const orderMine = N.strengthOrder.map((i) => toMine[i]);
  const comboOf = new Array(169).fill(0);
  for (let k = 0; k < NC; k++) comboOf[COMBO_CLASS[k]]++;
  const clsToCombo = (cls) => {
    const out = new Float64Array(NC);
    for (let k = 0; k < NC; k++) out[k] = cls[COMBO_CLASS[k]];
    return out;
  };
  const fromUpTo = (key, depth, ante) => {
    const a = Math.max(0, Math.min(2, ante));
    const a0 = Math.floor(a) === 2 ? 1 : Math.floor(a);
    const w = a - a0;
    const t0 = key(a0);
    const t1 = key(a0 + 1);
    const dep = Math.max(1.5, Math.min(25, depth));
    const cls = new Float64Array(169);
    N.classes.forEach((_, i) => {
      const up = t0[i] * (1 - w) + t1[i] * w;
      cls[toMine[i]] =
        up >= N.gridMax ? 1 : Math.max(0, Math.min(1, (up + N.gridStep - dep) / N.gridStep));
    });
    return clsToCombo(cls);
  };
  const jamRange = (behind, depth, ante) => {
    const b = Math.max(1, Math.min(9, Math.round(behind)));
    return fromUpTo((a) => N.upTo[`${b}|${a}`], depth, ante);
  };
  /** The Nash first-caller range against an open-jam, capped at 25% of hands (the engine's CALLER_WIDTH_CAP). */
  const callRange = (jammerBehind, kind, depth, ante) => {
    const b = Math.max(1, Math.min(9, Math.round(jammerBehind)));
    const k = b === 1 ? 'bb' : b === 2 && kind === 'open' ? 'sb' : kind;
    const r = fromUpTo((a) => N.callUpTo[`${b}|${k}|${a}`], depth, ante);
    let w = 0;
    for (let c = 0; c < NC; c++) w += r[c];
    return w / NC > 0.25 ? topWidth(0.25) : r;
  };
  const topWidth = (width) => {
    const cls = new Float64Array(169);
    let left = Math.max(0, Math.min(1, width)) * NC;
    for (const k of orderMine) {
      if (left <= 0) break;
      cls[k] = Math.min(1, left / comboOf[k]);
      left -= comboOf[k];
    }
    return clsToCombo(cls);
  };
  return { jamRange, callRange, topWidth };
}
/**
 * Facing a tournament preflop jam, a player still to act behind continues (overcalls) with the top half of the range he
 * would call the jam with (Nash first-caller range for an open-jam, the re-jam width otherwise), as the engine's priced
 * call does. Returns { width, range } or null outside that spot.
 */
export function tournamentOvercall(model, H, d, o) {
  if (!model.N || !H.tour || d.street !== 'preflop' || d.aggr === null) return null;
  const jam = H.decisions.find(
    (x) =>
      x.seat === d.aggr &&
      x.street === 'preflop' &&
      x.allInAfter &&
      (x.kind === 'raise' || x.kind === 'bet') &&
      x.i < d.i
  );
  if (!jam) return null;
  const depth =
    Math.min(jam.stack + jam.streetBet, Math.max(0, ...jam.opp.map((q) => q.stack + q.streetBet))) /
    H.bb;
  if (depth > 25) return null;
  let base;
  if (jam.raisesBefore === 0) {
    const ob = playersBehind(H, o.seat);
    base = model.N.callRange(
      playersBehind(H, jam.seat),
      ob === 0 ? 'bb' : ob === 1 ? 'sb' : 'open',
      depth,
      (H.anteTotal || 0) / H.bb
    );
  } else base = model.N.topWidth(lerpW(depth, 8, 25, REJAM_WIDTH[0], REJAM_WIDTH[1]));
  const w = rangeWeight(base) / NC;
  return { width: w * 0.5, range: model.N.topWidth(w * 0.5) };
}
/** True when the bet the decision faces is a jam (the last aggressor is all in). */
const facingJam = (d) => d.aggr !== null && d.opp.some((o) => o.seat === d.aggr && o.allIn);

/** The equilibrium range of a tournament preflop jam, or null when the decision is not one (or no table). */
export function tournamentJamRange(model, H, d) {
  if (
    !model.N ||
    !H.tour ||
    d.street !== 'preflop' ||
    !d.allInAfter ||
    !(d.kind === 'raise' || d.kind === 'bet')
  )
    return null;
  const others = d.opp.map((o) => o.stack + o.streetBet);
  const depth = Math.min(d.stack + d.streetBet, Math.max(0, ...others)) / H.bb;
  if (depth > 25) return null;
  if (d.raisesBefore === 0)
    return model.N.jamRange(playersBehind(H, d.seat), depth, (H.anteTotal || 0) / H.bb);
  if (d.raisesBefore === 1)
    return model.N.topWidth(lerpW(depth, 8, 25, REJAM_WIDTH[0], REJAM_WIDTH[1]));
  return model.N.topWidth(
    lerpW(depth, 12, 25, OVER_THREE_BET_JAM_WIDTH[0], OVER_THREE_BET_JAM_WIDTH[1])
  );
}
const bettorBluff = (model, H, d, seat, s, kind) =>
  bluffShareOf(model.B, {
    tour: H.tour,
    who: H.seats.get(seat)?.horse ? 'horse' : 'person',
    street: d.street,
    line: kind === 'raise' ? 'raise' : lineOf(d, seat),
    s,
  });

/**
 * Narrow a player's range by the action he took at decision d (public information only).
 *   preflop: raise keeps the top r of the current range, call the band [r, r + c], check all but the top r;
 *   postflop facing none: bet keeps top q(1-beta) plus bottom q*beta (q the fitted bet share heads-up, measured
 *   multiway; beta = s/(1+2s)), check keeps the rest; facing a bet: raise keeps top rho(1-beta) plus the band just
 *   above the fold line, call keeps the band from rho(1-beta) to (1 - f - rho*beta), f the fitted fold prior.
 */
export const NARROW_FLOOR = { preflop: 0.05, postflop: 0.1 };
export function narrow(model, H, d, range, S) {
  const k = d.kind;
  const keepBands = (r, st, bands) =>
    keepBandsHard(
      r,
      st,
      bands,
      d.street === 'preflop' ? NARROW_FLOOR.preflop : NARROW_FLOOR.postflop
    );
  const keepTop = (r, st, q) => keepBands(r, st, [[0, Math.max(0, Math.min(1, q))]]);
  if (k === 'fold') return range;
  if (d.street === 'preflop') {
    const sh = nodeShares(model.F, H, d);
    const r = Math.max(0.005, sh.raise);
    const c = Math.max(0.005, d.C > 0 ? sh.call : sh.check);
    const jam = tournamentJamRange(model, H, d);
    if (jam) {
      const out = new Float64Array(NC);
      for (let c = 0; c < NC; c++) out[c] = range[c] * jam[c];
      return out;
    }
    if (k === 'raise' || k === 'bet') return keepTop(range, S, r);
    if (k === 'call') return keepBands(range, S, [[Math.min(r, 0.9), Math.min(1, r + c)]]);
    return keepBands(range, S, [[Math.min(r, 0.95), 1]]);
  }
  if (d.C <= 0) {
    const line = lineOf(d, d.seat);
    const q = d.hu
      ? BET_SHARE_PRIOR[d.street][line][d.checkedBefore > 0 ? 'checkedTo' : 'first']
      : Math.max(0.05, nodeShares(model.F, H, d).raise);
    const s = d.inc / Math.max(1e-9, d.P);
    const beta = bettorBluff(model, H, d, d.seat, s || 0.66, 'bet');
    const bands = [
      [0, q * (1 - beta)],
      [1 - q * beta, 1],
    ];
    if (k === 'bet' || k === 'raise') return keepBands(range, S, bands);
    return keepBands(range, S, [[q * (1 - beta), 1 - q * beta]]);
  }
  const sh = nodeShares(model.F, H, d);
  const s = d.C / Math.max(1e-9, d.P - d.C);
  let f = sh.fold;
  if (d.hu && d.node === 'vsBet') f = FOLD_PRIOR[d.street][lineOf(d, d.aggr)][sizeBucketIndex(s)];
  else if (d.hu && d.node === 'vsRaise') f = FOLD_TO_RAISE_PRIOR[d.street];
  const rho = Math.max(0.02, sh.raise);
  const beta = bettorBluff(
    model,
    H,
    d,
    d.seat,
    (d.to - d.CB) / Math.max(1e-9, d.P + (d.to - d.CB)) || s,
    'raise'
  );
  if (k === 'raise' || k === 'bet')
    return keepBands(range, S, [
      [0, rho * (1 - beta)],
      [Math.max(0, 1 - f - rho * beta), Math.max(0, 1 - f)],
    ]);
  return keepBands(range, S, [
    [rho * (1 - beta), Math.max(rho * (1 - beta) + 0.02, 1 - f - rho * beta)],
  ]);
}

/** Probability that opponent o folds to a wager of the hero making the opponent face `toCallO` into `potAfter`. */
function foldProb(model, H, d, o, kindAfter, sPot) {
  if (o.allIn) return 0;
  if (d.street === 'preflop') {
    const fake = {
      ...d,
      seat: o.seat,
      node: kindAfter,
      C: 1,
      stack: o.stack,
      streetBet: o.streetBet,
      opp: [],
    };
    const v = lookup(model.F.pre, freqKeyPre(H, fake));
    return v ? v.fold / v.n : 0.6;
  }
  if (d.hu) {
    const person = !H.seats.get(o.seat)?.horse;
    if (d.C > 0)
      return person
        ? personFoldRate(model.F, H.tour, d.street, null, null, FOLD_TO_RAISE_PRIOR[d.street], true)
        : FOLD_TO_RAISE_PRIOR[d.street];
    const pr = FOLD_PRIOR[d.street][lineOf(d, d.seat)][sizeBucketIndex(sPot)];
    return person
      ? personFoldRate(model.F, H.tour, d.street, lineOf(d, d.seat), sizeBucketIndex(sPot), pr)
      : pr;
  }
  const fake = { ...d, node: d.C > 0 ? 'vsRaise' : 'vsBet', C: sPot, P: 1 + sPot, hu: false };
  const v = lookup(model.F.post, freqKeyPost(H, fake));
  return v ? v.fold / v.n : 0.5;
}

/** Options priced at a hero decision, all in chips relative to folding now. */
export function priceDecision(model, H, d, ctx) {
  const { eqOf, eqTopOf } = ctx; // eqOf(o) equity vs o's range; eqTopOf(o, q) equity vs the top q of o's range
  const bb = H.bb;
  const final = d.street === 'river';
  const R0 = final ? 1 : REALISATION[d.street][d.ip ? 'ip' : 'oop'];
  const opps = d.opp;
  const eqAll = multiwayEquity(opps.map((o) => eqOf(o)));
  // an opponent still to act who has not matched the current bet folds with f, else continues with his top 1 - f
  const pending = (o) => !o.allIn && o.toAct && o.streetBet < d.CB - 1e-9 && o.seat !== d.aggr;
  const levelNode = d.street === 'preflop' ? d.node : d.raisesBefore >= 2 ? 'vsRaise' : 'vsBet';
  const fixed = opps.filter((o) => !pending(o)).map((o) => eqOf(o));
  const pend = opps.filter(pending).map((o) => {
    const oc = tournamentOvercall(model, H, d, o);
    if (oc && ctx.eqVsRange) return { f: 1 - oc.width, e: ctx.eqVsRange(oc.range) };
    const base = levelNode.replace('-cold', '');
    const ln = base + ((base === 'vs3bet' || base === 'vs4bet+') && !o.vol ? '-cold' : '');
    const f = Math.min(
      0.97,
      Math.max(0, foldProb(model, H, { ...d, hu: false }, o, ln, d.C / Math.max(1e-9, d.P - d.C)))
    );
    return { f, e: eqTopOf(o, 1 - f) };
  });
  let eqVsField = 0;
  const pm = Math.min(pend.length, 8);
  for (let mask = 0; mask < 1 << pm; mask++) {
    let p = 1;
    const es = [...fixed];
    for (let i = 0; i < pm; i++) {
      if ((mask >> i) & 1) {
        p *= 1 - pend[i].f;
        es.push(pend[i].e);
      } else p *= pend[i].f;
    }
    eqVsField += p * multiwayEquity(es);
  }
  const heroMax = d.stack + d.streetBet;
  const options = [];
  const allOppAllIn = opps.every((o) => o.allIn);
  if (d.C <= 0) options.push({ a: 'check', ev: R0 * eqAll * d.P });
  else {
    options.push({ a: 'fold', ev: 0 });
    const callInc = Math.min(d.C, d.stack);
    const heroTo = d.streetBet + callInc;
    let excess = 0;
    for (const o of opps) excess += Math.max(0, o.streetBet - heroTo);
    const heroAllIn = callInc >= d.stack - 1e-9;
    const othersToAct = opps.some((o) => !o.allIn && o.toAct && o.seat !== d.aggr);
    // facing a jam nobody bets again between the jammer and the caller: no realisation discount
    const R =
      heroAllIn ||
      (allOppAllIn && !othersToAct) ||
      (d.street === 'preflop' && H.tour && facingJam(d))
        ? 1
        : R0;
    options.push({ a: 'call', ev: R * eqVsField * (d.P - excess + callInc) - callInc });
  }
  // wager sizes ("raise to" street totals)
  const tos = new Set();
  const pfUnopened = d.street === 'preflop' && d.CB <= bb + 1e-9;
  if (d.kind === 'bet' || d.kind === 'raise') tos.add(d.to);
  const canWager = d.stack > d.C + 1e-9 && !allOppAllIn;
  if (canWager) {
    if (d.street === 'preflop') {
      tos.add(pfUnopened ? bb * 2.5 + d.limpers * bb : d.CB * 3);
      if (heroMax / bb <= 25) tos.add(heroMax);
    } else if (d.C <= 0) {
      for (const f of [0.33, 0.66, 1.0]) tos.add(d.P * f);
    } else tos.add(d.CB * 3);
  }
  for (let T of tos) {
    if (!(T > d.CB)) continue;
    if (T > heroMax * 0.6 && d.street === 'preflop') T = heroMax; // large preflop raises become a jam
    if (T > heroMax) T = heroMax;
    const A = T - d.streetBet;
    if (A <= d.C) continue;
    const jam = T >= heroMax - 1e-9;
    const potBefore = d.P;
    const sPot = A / Math.max(1e-9, potBefore);
    const resp = opps.map((o) => {
      const need = Math.min(T - o.streetBet, o.stack);
      const kindAfter = jam
        ? 'vsJam'
        : d.raisesBefore === 0
          ? 'vsOpen'
          : (d.raisesBefore === 1 ? 'vs3bet' : 'vs4bet+') + (o.vol ? '' : '-cold');
      const f = Math.min(
        0.97,
        Math.max(
          0,
          foldProb(
            model,
            H,
            d,
            o,
            kindAfter,
            d.C > 0 ? (T - d.CB) / Math.max(1e-9, potBefore + (T - d.CB)) : sPot
          )
        )
      );
      return { o, need: Math.max(0, need), f, eqc: o.allIn ? eqOf(o) : eqTopOf(o, 1 - f) };
    });
    let ev = 0;
    const m = resp.length;
    for (let mask = 0; mask < 1 << m; mask++) {
      let p = 1;
      const eqs = [];
      let callers = 0;
      let maxReach = 0;
      for (let i = 0; i < m; i++) {
        const r = resp[i];
        const cont = (mask >> i) & 1;
        if (r.o.allIn && !cont) {
          p = 0;
          break;
        }
        if (cont) {
          p *= r.o.allIn ? 1 : 1 - r.f;
          eqs.push(r.eqc);
          callers++;
          maxReach = Math.max(maxReach, r.o.streetBet + r.need);
        } else p *= r.f;
      }
      if (p <= 0) continue;
      if (callers === 0) {
        ev += p * potBefore;
        continue;
      }
      const risk = Math.min(A, maxReach - d.streetBet);
      let add = 0;
      for (let i = 0; i < m; i++)
        if ((mask >> i) & 1)
          add += Math.max(
            0,
            Math.min(resp[i].o.streetBet + resp[i].need, d.streetBet + risk) - resp[i].o.streetBet
          );
      const allDone =
        jam || resp.every((r, i) => !((mask >> i) & 1) || r.o.allIn || r.need >= r.o.stack - 1e-9);
      const R = final || allDone ? 1 : R0;
      ev += p * (R * multiwayEquity(eqs) * (potBefore + risk + add) - risk);
    }
    options.push({
      a: d.C > 0 || d.CB > 0 ? 'raise' : 'bet',
      to: T,
      jam,
      ev,
      fold: resp.length === 1 ? resp[0].f : resp.reduce((q, r) => q * r.f, 1),
      sPot,
    });
  }
  return { options, eqAll: d.C > 0 ? eqVsField : eqAll, R: R0 };
}

/** Which option is the action taken. */
export function takenOption(d, options) {
  if (d.kind === 'fold' || d.kind === 'check' || d.kind === 'call')
    return options.find((o) => o.a === d.kind) || null;
  let best = null;
  for (const o of options)
    if (
      (o.a === 'bet' || o.a === 'raise') &&
      (best === null || Math.abs(o.to - d.to) < Math.abs(best.to - d.to))
    )
      best = o;
  return best;
}

export function mistakeType(H, d, taken, best, info) {
  const st = d.street;
  const bbs = (d.stack + d.streetBet) / H.bb;
  const effBb = Math.min(
    bbs,
    ...d.opp.map((o) => (o.stack + o.streetBet) / H.bb).concat([Infinity])
  );
  const ta = taken.a;
  const ba = best.a;
  const pg = posGroup(H, d.seat);
  if (st === 'preflop') {
    if (
      H.tour &&
      effBb <= 20 &&
      (d.node === 'unopened' || d.node === 'vsLimp' || d.node === 'vsJam') &&
      (taken.jam || best.jam || ta === 'fold' || ta === 'call')
    )
      return 'short-stack push/fold error (chip-EV vs measured ranges)';
    if (ta === 'fold' && d.C > 0 && d.node !== 'vsJam' && effBb <= 25)
      return 'fold to a non-all-in raise at a short stack';
    if (ta === 'fold' && (pg === 'SB' || pg === 'BB') && d.node === 'vsOpen')
      return 'over-fold of blinds to a steal';
    if (ta === 'raise' && d.node === 'vsOpen' && info.foldedTo4bet)
      return '3-bet that folds to a 4-bet';
    if (ta === 'call' && /-cold$/.test(d.node) && ba === 'fold') return 'loose cold-call';
    if (ta === 'call' && (d.node === 'vs3bet' || d.node === 'vs4bet+') && !d.ip)
      return 'call of 3-bet or 4-bet out of position';
    if (ta === 'call' && d.node === 'vsOpen' && pg !== 'BB' && pg !== 'SB' && ba === 'fold')
      return 'loose cold-call';
    if (ta === 'fold') return 'preflop fold too strong';
    if (ta === 'call' && ba === 'fold') return 'preflop call too light';
    if ((ta === 'raise' || ta === 'bet') && ba !== 'raise' && ba !== 'bet')
      return 'preflop raise without value';
    if ((ta === 'raise' || ta === 'bet') && (ba === 'raise' || ba === 'bet'))
      return 'preflop raise size wrong';
    return 'preflop missed raise';
  }
  const cls = info.cls;
  const dr = info.draw;
  if (ta === 'fold') return 'folded too strong';
  if (ta === 'call' && ba === 'fold') {
    if (ONE_PAIR.has(cls) && effBb >= 60 && d.C + d.streetBet >= 0.4 * (d.stack + d.streetBet))
      return 'stacked off with one pair deep';
    if (info.valueOnlyLine) return 'paid off a value-only line';
    return 'called too light';
  }
  if (ta === 'raise') {
    if (
      (st === 'turn' || st === 'river') &&
      (NO_SHOWDOWN.has(cls) || cls === 'weak pair') &&
      !(dr.outs >= 8 && st === 'turn')
    )
      return 'bluff-raised turn or river without value';
    if (st !== 'river' && dr.outs >= 8 && !d.ip && !(cls && !NO_SHOWDOWN.has(cls)))
      return 'raised a draw out of position';
    if (ONE_PAIR.has(cls) && effBb >= 60) return 'stacked off with one pair deep';
    if (ba === 'raise') return 'bet size wrong for the range';
    return 'raise without value';
  }
  if (ta === 'bet') {
    if (ba === 'bet') return 'bet size wrong for the range';
    if (NO_SHOWDOWN.has(cls) && dr.outs < 8) return 'random or unpriced bluff';
    if (ONE_PAIR.has(cls) && effBb >= 60 && taken.jam) return 'stacked off with one pair deep';
    return 'bet into a stronger range (thin value)';
  }
  if (ta === 'check' && (ba === 'bet' || ba === 'raise')) {
    if (st !== 'river' && info.eqAll >= 0.75 && info.checkedThrough)
      return 'slow-play gave a free card';
    if (info.eqAll < 0.4) return 'missed profitable bluff';
    if (info.eqAll < 0.65) return 'missed thin value bet';
    return 'missed value bet';
  }
  if (ta === 'call' && ba === 'raise')
    return info.eqAll < 0.4 ? 'missed profitable bluff-raise' : 'missed value raise';
  return 'other';
}

/**
 * Grade every Horse decision of one hand whose cards were shown (exact tier), with the range model replayed over
 * the public actions. Returns rows (one per graded decision).
 */
export function gradeExactHand(model, H) {
  const heroSeats = [...H.seats.values()]
    .filter((s) => s.horse && H.shown.has(s.uid))
    .map((s) => s.seat);
  if (!heroSeats.length) return [];
  const rows = [];
  const tables = {};
  const strength = (street) => {
    if (street === 'preflop') return model.preS;
    if (!tables[street]) {
      const k = { flop: 3, turn: 4, river: 5 }[street];
      if (H.board.length < k) return null;
      const t = streetTable(H.board.slice(0, k));
      tables[street] = { t, S: strengthVector(t), eq: new Map() };
    }
    return tables[street].S;
  };
  const eqVec = (street, combo) => {
    if (street === 'preflop') {
      if (!tables.pre) tables.pre = new Map();
      if (!tables.pre.has(combo)) tables.pre.set(combo, preflopEquityVector(model.M, combo));
      return tables.pre.get(combo);
    }
    strength(street);
    const T = tables[street];
    if (!T.eq.has(combo)) T.eq.set(combo, equityVector(T.t, combo));
    return T.eq.get(combo);
  };
  // ranges of every seat, replayed street by street
  const ranges = new Map([...H.seats.keys()].map((s) => [s, fullRange()]));
  let curStreet = 'preflop';
  const foldedTo4bet = new Set();
  for (const d of H.decisions)
    if (d.street === 'preflop' && d.node === 'vs4bet+' && d.kind === 'fold')
      foldedTo4bet.add(d.seat);
  for (const d of H.decisions) {
    if (d.street !== curStreet) {
      curStreet = d.street;
      const k = { flop: 3, turn: 4, river: 5 }[curStreet];
      if (H.board.length < k) break;
      for (const [s, r] of ranges) ranges.set(s, removeDead(r, H.board.slice(0, k)));
    }
    const S = strength(d.street);
    if (!S) break;
    const me = H.seats.get(d.seat);
    if (heroSeats.includes(d.seat) && d.opp.length > 0) {
      const hole = H.shown.get(me.uid);
      const combo = comboIndex(hole[0], hole[1]);
      const E = eqVec(d.street, combo);
      const dead = [
        ...hole,
        ...H.board.slice(0, { preflop: 0, flop: 3, turn: 4, river: 5 }[d.street]),
      ];
      const rOf = (o) => removeDead(ranges.get(o.seat), dead);
      const cacheEq = new Map();
      const eqOf = (o) => {
        if (!cacheEq.has(o.seat)) {
          const e = equityVsRange(E, rOf(o));
          cacheEq.set(o.seat, Number.isFinite(e) ? e : 0.5);
        }
        return cacheEq.get(o.seat);
      };
      const eqTopOf = (o, q) => {
        const e = equityVsRange(E, keepTop(rOf(o), S, Math.max(0.02, q)));
        return Number.isFinite(e) ? e : eqOf(o);
      };
      const eqVsRange = (r) => {
        const e = equityVsRange(E, removeDead(r, dead));
        return Number.isFinite(e) ? e : 0.5;
      };
      const priced = priceDecision(model, H, d, { eqOf, eqTopOf, eqVsRange });
      // hindsight: the opponents' shown cards, exact enumeration on the current board
      let hind = null;
      const oppShown = d.opp.map((o) => H.shown.get(H.seats.get(o.seat).uid));
      if (oppShown.some(Boolean)) {
        const boardNow = H.board.slice(0, { preflop: 0, flop: 3, turn: 4, river: 5 }[d.street]);
        const known = d.opp.filter((o, i) => oppShown[i]);
        let eqH = 1;
        try {
          eqH = exactEquity(
            [hole, ...known.map((o) => H.shown.get(H.seats.get(o.seat).uid))],
            boardNow
          )[0];
        } catch {
          eqH = NaN;
        }
        const unshown = d.opp
          .filter((o) => !H.shown.get(H.seats.get(o.seat).uid))
          .map((o) => eqOf(o));
        if (unshown.length) eqH = multiwayEquity([eqH, ...unshown]);
        if (Number.isFinite(eqH)) {
          const shownEq = (o) => {
            const c = H.shown.get(H.seats.get(o.seat).uid);
            if (!c) return eqOf(o);
            const e = E[comboIndex(c[0], c[1])];
            return Number.isFinite(e) ? e : eqH;
          };
          hind = priceDecision(model, H, d, { eqOf: shownEq, eqTopOf: (o) => shownEq(o) });
          hind.eqAll = eqH;
        }
      }
      const taken = takenOption(d, priced.options);
      if (taken) {
        const best = priced.options.reduce((a, b) => (b.ev > a.ev ? b : a));
        const potBb = d.P / H.bb;
        const tol = Math.max(TOL_BB, TOL_POT * potBb);
        const gap = (best.ev - taken.ev) / H.bb;
        const passive = priced.options.find((o) => o.a === (d.C > 0 ? 'fold' : 'check'));
        const boardNow = H.board.slice(0, { preflop: 0, flop: 3, turn: 4, river: 5 }[d.street]);
        const cls = d.street === 'preflop' ? null : handClass(hole, boardNow);
        const lastOppAggrLine = H.decisions.filter(
          (x) =>
            x.seat === d.aggr &&
            x.i < d.i &&
            (x.kind === 'raise' ||
              (x.kind === 'bet' && x.street === 'river' && x.inc >= x.P * 0.9)) &&
            (x.street === 'turn' || x.street === 'river')
        );
        const info = {
          cls,
          draw: d.street === 'preflop' ? { outs: 0 } : drawInfo(hole, boardNow),
          eqAll: priced.eqAll,
          foldedTo4bet: foldedTo4bet.has(d.seat),
          valueOnlyLine: lastOppAggrLine.length > 0,
          checkedThrough:
            H.decisions.some(
              (x) => x.street === d.street && x.i > d.i && x.kind === 'check' && x.seat !== d.seat
            ) &&
            !H.decisions.some(
              (x) => x.street === d.street && x.i > d.i && (x.kind === 'bet' || x.kind === 'raise')
            ),
        };
        // a size-only difference (both wagers) is model-sensitive: it needs max(1 bb, 15% of the pot)
        const sizeOnly =
          (taken.a === 'bet' || taken.a === 'raise') && (best.a === 'bet' || best.a === 'raise');
        // preflop call-versus-raise (both continue) is priced without postflop play: it needs max(2 bb, 20% of the pot)
        const pfContinue =
          d.street === 'preflop' && taken.a !== 'fold' && best.a !== 'fold' && taken.a !== best.a;
        const tolUsed = pfContinue
          ? Math.max(2, 0.2 * potBb)
          : sizeOnly
            ? Math.max(1, 0.15 * potBb)
            : tol;
        let verdict = gap <= tolUsed ? 'CORRECT' : 'MISTAKE';
        let mtype = verdict === 'MISTAKE' ? mistakeType(H, d, taken, best, info) : '';
        let hv = '';
        let hc = 0;
        if (hind) {
          const ht = takenOption(d, hind.options);
          const hb = hind.options.reduce((a, b) => (b.ev > a.ev ? b : a));
          hc = ht ? (hb.ev - ht.ev) / H.bb : 0;
          hv = hc <= tol ? 'CORRECT' : 'MISTAKE';
        }
        rows.push({
          hand: H.id,
          seat: d.seat,
          horse: me.name,
          d,
          tier: 'exact',
          verdict,
          type: mtype,
          cost: verdict === 'MISTAKE' ? gap : 0,
          gain: verdict === 'CORRECT' && passive ? Math.max(0, (taken.ev - passive.ev) / H.bb) : 0,
          evTaken: taken.ev / H.bb,
          evBest: best.ev / H.bb,
          best: best.a + (best.to ? `:${(best.to / H.bb).toFixed(1)}bb` : ''),
          eq: priced.eqAll,
          hindEq: hind ? hind.eqAll : null,
          hindVerdict: hv,
          hindCost: hv === 'MISTAKE' ? hc : 0,
          cls: cls || '',
          hole: hole,
        });
      }
    }
    ranges.set(d.seat, narrow(model, H, d, ranges.get(d.seat), S));
    if (rangeWeight(ranges.get(d.seat)) <= 0) ranges.set(d.seat, removeDead(fullRange(), H.board));
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------
// Range tier: nodes
// ---------------------------------------------------------------------------------------------------
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export function fmtClass(fmt) {
  return fmt === 'cash' ? 'cash' : 'tournament';
}
/** The node of a Horse decision: street x node x line x position x size x HU/MW x stack bucket x opponent kind. */
export function nodeOf(H, d) {
  const pos = d.street === 'preflop' ? posGroup(H, d.seat) : d.ip ? 'IP' : 'OOP';
  const line = d.street === 'preflop' ? '-' : d.C > 0 ? lineOf(d, d.aggr) : lineOf(d, d.seat);
  const eff =
    Math.min(d.stack + d.streetBet, ...d.opp.map((o) => o.stack + o.streetBet).concat([Infinity])) /
    H.bb;
  const oppPerson =
    d.C > 0 && d.aggr !== null
      ? !H.seats.get(d.aggr)?.horse
      : d.opp.some((o) => !H.seats.get(o.seat)?.horse);
  return {
    fc: fmtClass(H.fmt),
    street: d.street,
    node: d.node === 'checkedTo' ? 'checkedTo' : d.node,
    line,
    pos,
    size: sizeLabel(d),
    hu: d.hu ? 'HU' : 'MW',
    stack: isTourFormat(H.fmt) ? stackBucket(H.fmt, eff) : stackBucket(H.fmt, eff),
    opp: oppPerson ? 'person' : 'horse',
  };
}
export const nodeKey = (n) =>
  [
    n.fc,
    n.street,
    n.node,
    n.line,
    n.pos,
    n.size,
    n.hu,
    n.fc === 'tournament' ? n.stack : '-',
    n.opp,
  ].join(' | ');
/** Coarser parent used when a node has too few spots: preflop drops the stack bucket, postflop drops line and position. */
export const parentKey = (n) =>
  n.street === 'preflop'
    ? [n.fc, n.street, n.node, '*', n.pos, n.size, n.hu, '*', n.opp].join(' | ')
    : [
        n.fc,
        n.street,
        n.node,
        '*',
        '*',
        n.size,
        n.hu,
        n.fc === 'tournament' ? n.stack : '-',
        n.opp,
      ].join(' | ');

/** Did every opponent fold to this wager on this street (the bet "worked")? */
function wagerWorked(H, d) {
  for (const x of H.decisions) {
    if (x.i <= d.i || x.street !== d.street) continue;
    if (x.seat === d.seat) return false;
    if (x.kind !== 'fold') return false;
  }
  // nobody acted after: everyone else must have been all in or folded already
  return H.decisions.some((x) => x.i > d.i && x.street === d.street) || d.opp.every((o) => o.allIn);
}

export function collectNodes(hands, exactByDecision, model = null, kappa = null) {
  const nodes = new Map();
  const where = [];
  for (const H of hands)
    for (const d of H.decisions) {
      const me = H.seats.get(d.seat);
      if (!me?.horse || d.opp.length === 0) continue;
      const n = nodeOf(H, d);
      for (const k of [nodeKey(n), parentKey(n)]) {
        let v = nodes.get(k);
        if (!v) {
          v = {
            key: k,
            n0: n,
            n: 0,
            fold: 0,
            call: 0,
            raise: 0,
            check: 0,
            bet: 0,
            worked: 0,
            potBb: 0,
            be: 0,
            toCallBb: 0,
            betPotBb: 0,
            betS: 0,
            shown: 0,
            pfCost: 0,
            pfN: 0,
            ex: [],
            parent: k !== nodeKey(n),
          };
          nodes.set(k, v);
        }
        v.n++;
        v.potBb += d.P / H.bb;
        if (d.C > 0) {
          v.be += d.C / Math.max(1e-9, d.P);
          v.toCallBb += d.C / H.bb;
          if (d.kind === 'fold') v.fold++;
          else if (d.kind === 'call') v.call++;
          else v.raise++;
        } else if (d.kind === 'check') v.check++;
        else {
          v.bet++;
          const s = d.inc / Math.max(1e-9, d.P);
          v.betS += s;
          v.betPotBb += (d.P + d.inc) / H.bb;
          if (wagerWorked(H, d)) v.worked++;
        }
        if (exactByDecision.has(`${H.id}:${d.i}`)) v.shown++;
        if (v.ex.length < 12) v.ex.push(H.id);
        where.push([H, d, v]);
      }
    }
  // preflop: the chips the folded part of the range would have won by calling (equity vs the raiser's line range)
  if (model) {
    for (const [H, d, v] of where) {
      if (d.street !== 'preflop' || d.C <= 0) continue;
      const facing = v.fold + v.call + v.raise;
      const f = facing ? v.fold / facing : 0;
      const c = preflopFoldBandValue(model, H, d, f);
      if (c !== null) {
        v.pfCost += c;
        v.pfN++;
      }
    }
  }
  for (const v of nodes.values()) gradeNode(v, model, kappa);
  return nodes;
}

/** Line range of a seat preflop from its own earlier preflop actions (public). */
function preflopLineRange(model, H, seat, beforeI) {
  let r = fullRange();
  for (const x of H.decisions) {
    if (x.i >= beforeI || x.street !== 'preflop') continue;
    if (x.seat === seat) r = narrow(model, H, x, r, model.preS);
  }
  return r;
}
/**
 * Expected chips (bb) per occurrence that the folded part of the defender's range would have won by calling:
 * the defender's line range ordered by preflop strength; its weakest share f folds; each folded combo's call is
 * worth R x eq(combo vs the raiser's line range) x (pot + call) - call; positive values are summed, weighted.
 */
export function preflopFoldBandValue(model, H, d, f) {
  if (d.aggr === null || f <= 0) return null;
  const R = REALISATION.preflop[d.ip ? 'ip' : 'oop'];
  const def = preflopLineRange(model, H, d.seat, d.i);
  const agg = preflopLineRange(model, H, d.aggr, d.i);
  const aggCls = new Float64Array(169);
  for (let k = 0; k < NC; k++) aggCls[COMBO_CLASS[k]] += agg[k];
  let tot = 0;
  for (let j = 0; j < 169; j++) tot += aggCls[j];
  if (tot <= 0) return null;
  const eqCls = new Float64Array(169);
  for (let i = 0; i < 169; i++) {
    let s = 0;
    for (let j = 0; j < 169; j++) s += aggCls[j] * model.M[i * 169 + j];
    eqCls[i] = s / tot;
  }
  // players who already matched the bet (callers, all-in players other than the raiser) share the pot: their line
  // ranges enter the multiway equity
  const others = d.opp.filter((o) => o.seat !== d.aggr && (o.allIn || o.streetBet >= d.CB - 1e-9));
  const otherCls = others.map((o) => {
    const r = preflopLineRange(model, H, o.seat, d.i);
    const c = new Float64Array(169);
    let t = 0;
    for (let k = 0; k < NC; k++) {
      c[COMBO_CLASS[k]] += r[k];
      t += r[k];
    }
    const e = new Float64Array(169);
    for (let i = 0; i < 169; i++) {
      let x = 0;
      for (let j = 0; j < 169; j++) x += c[j] * model.M[i * 169 + j];
      e[i] = t > 0 ? x / t : 0.5;
    }
    return e;
  });
  const folded = keepBands(def, model.preS, [[Math.max(0, 1 - f), 1]]);
  const wDef = rangeWeight(def);
  if (wDef <= 0) return null;
  const callInc = Math.min(d.C, d.stack);
  const R2 = callInc >= d.stack - 1e-9 || (H.tour && facingJam(d)) ? 1 : R;
  // players still to act behind who have not matched the bet: only the share of cases where every one of them folds is
  // counted (a lower bound: when anyone behind enters, the call is valued at 0)
  let behindFold = 1;
  for (const o of d.opp) {
    if (o.allIn || !o.toAct || o.streetBet >= d.CB - 1e-9 || o.seat === d.aggr) continue;
    const oc = tournamentOvercall(model, H, d, o);
    if (oc) {
      behindFold *= 1 - oc.width;
      continue;
    }
    const base = d.node.replace('-cold', '');
    const fake = {
      ...d,
      seat: o.seat,
      node: base === 'vs3bet' || base === 'vs4bet+' ? base + (o.vol ? '' : '-cold') : base,
      C: 1,
      stack: o.stack,
      streetBet: o.streetBet,
      opp: [],
    };
    const v = lookup(model.F.pre, freqKeyPre(H, fake));
    behindFold *= v ? v.fold / v.n : 0.8;
  }
  let val = 0;
  for (let k = 0; k < NC; k++) {
    if (folded[k] <= 0) continue;
    const ci = COMBO_CLASS[k];
    const eq = otherCls.length
      ? multiwayEquity([eqCls[ci], ...otherCls.map((e) => e[ci])])
      : eqCls[ci];
    const ev = R2 * eq * (d.P + callInc) - callInc;
    if (ev > 0) val += (folded[k] / wDef) * ev;
  }
  return (behindFold * val) / H.bb;
}

/**
 * Node verdict. Two costs are kept apart:
 *  THEORETICAL exploitability (what a bettor could take with pure bluffs): facing a wager, fold f against the
 *    bluffer's break-even be = toCall/pot: pot x (f - be) per spot when f is above be.
 *  ACTUAL cost against the bettors as they really bet (the leak ranking uses this one):
 *    postflop facing a wager: the bettors' measured bluff share beta for this street, line, size and bettor kind
 *    (people and Horses measured apart, from their wagers shown at showdown); a bluff-catcher's call is worth
 *    EVbc = beta x (pot + toCall) - toCall. Folds beyond be cost (f - be) x EVbc only when EVbc > 0; when EVbc < 0
 *    the calls are below the price and cost kappa x (-EVbc) per call (kappa = share of shown calls on that street the
 *    exact tier graded as called-too-light or paid-off).
 *    preflop facing a raise: the value the folded part of the range would have won by calling (preflopFoldBandValue).
 *  Horse wagers (success w = all fold vs be = s/(1+s)): over-bluff when w's interval is below be - 0.02 (the measured
 *    Horse bluff share of the bets loses (pot + bet) x (be - w)); "bets print" (a strength) above be + 0.02.
 */
export function gradeNode(v, model = null, kappa = null) {
  const facing = v.fold + v.call + v.raise;
  v.verdict = 'insufficient';
  v.edge = 0;
  v.theory = 0;
  v.perDecisionCost = 0;
  v.perDecisionTheory = 0;
  v.leakAction = null;
  const n0 = v.n0 || {};
  if (facing >= MIN_NODE_N) {
    const f = v.fold / facing;
    const be = v.be / facing;
    const pot = v.potBb / v.n;
    const toc = v.toCallBb / facing;
    const [lo, hi] = wilson(v.fold, facing);
    v.f = f;
    v.beAvg = be;
    v.ci = [lo, hi];
    // theoretical (pure-bluff) exploitability is a postflop measure: a preflop fold is priced by its folded hands
    if (lo > be + 0.02 && n0.street !== 'preflop') {
      v.theory = pot * (f - be);
      v.perDecisionTheory = v.theory / Math.max(1e-9, f);
    }
    if (n0.street === 'preflop') {
      const val = v.pfN ? v.pfCost / v.pfN : 0;
      v.edge = val;
      if (val > 0.05 && lo > be + 0.02) {
        v.verdict = 'over-fold';
        v.leakAction = 'fold';
        v.perDecisionCost = val / Math.max(1e-9, f);
      } else v.verdict = lo > be + 0.02 ? 'over-fold (theoretical only)' : 'fine';
      return v;
    }
    const s = toc / Math.max(1e-9, pot - toc);
    const beta = model
      ? bluffShareOf(model.B, {
          tour: n0.fc === 'tournament',
          who: n0.opp === 'person' ? 'person' : 'horse',
          street: n0.street,
          line: n0.node === 'vsRaise' ? 'raise' : n0.line,
          s,
        })
      : bluffShare(s);
    v.beta = beta;
    const evbc = beta * (pot + toc) - toc;
    v.evbc = evbc;
    if (f > be && evbc > 0 && lo > be + 0.02) {
      v.verdict = 'over-fold';
      v.edge = (f - be) * evbc;
      v.leakAction = 'fold';
      v.perDecisionCost = v.edge / Math.max(1e-9, f);
    } else if (evbc < 0 && facing - v.fold > 0) {
      const kp = kappa ? (kappa.get(`${n0.fc}|${n0.street}`) ?? 0.3) : 0.3;
      const callShare = (facing - v.fold) / facing;
      v.edge = callShare * kp * -evbc;
      if (v.edge > 0.05) {
        v.verdict = 'calls below the price';
        v.leakAction = 'call';
        v.perDecisionCost = kp * -evbc;
      } else v.verdict = lo > be + 0.02 ? 'over-fold (theoretical only)' : 'fine';
    } else v.verdict = lo > be + 0.02 ? 'over-fold (theoretical only)' : 'fine';
  } else if (v.bet >= MIN_NODE_N) {
    const w = v.worked / v.bet;
    const s = v.betS / v.bet;
    const be = s / (1 + s);
    const potAfter = v.betPotBb / v.bet;
    const [lo, hi] = wilson(v.worked, v.bet);
    const beta =
      model && n0.street !== 'preflop'
        ? bluffShareOf(model.B, {
            tour: n0.fc === 'tournament',
            who: 'horse',
            street: n0.street,
            line: n0.line,
            s,
          })
        : bluffShare(s);
    v.w = w;
    v.beAvg = be;
    v.ci = [lo, hi];
    v.beta = beta;
    v.betFreq = v.bet / (v.bet + v.check);
    if (hi < be - 0.02) {
      v.verdict = 'over-bluff';
      v.perDecisionCost = potAfter * (be - w) * beta;
      v.edge = v.perDecisionCost * (v.bet / v.n);
      v.leakAction = 'bet';
    } else if (lo > be + 0.02) {
      v.verdict = 'bets print';
      v.perDecisionGain = potAfter * (w - be) * Math.max(beta, 0.05);
      v.edge = -v.perDecisionGain * (v.bet / v.n);
    } else v.verdict = 'fine';
  }
  return v;
}

// ---------------------------------------------------------------------------------------------------
// The whole audit
// ---------------------------------------------------------------------------------------------------
export function dayOf(ts) {
  // America/Chicago, UTC-6 in late November (no DST change inside the audit ranges this tool targets)
  return new Date(ts - 6 * 3600_000).toISOString().slice(0, 10);
}

export function audit(rawHands, { model, window = null, onProgress = null } = {}) {
  const hands = [];
  let skipped = 0;
  for (const r of rawHands) {
    const H = parseHand(r);
    if (H && (!window || (H.ts >= window.since && H.ts < window.until))) hands.push(H);
    else if (!H) skipped++;
  }
  const exact = [];
  let i = 0;
  for (const H of hands) {
    i++;
    if (onProgress && i % 100 === 0) onProgress(i, hands.length);
    try {
      for (const row of gradeExactHand(model, H)) exact.push(row);
    } catch (e) {
      H.gradeError = String(e && e.message ? e.message : e);
    }
  }
  const exactByDecision = new Map(exact.map((r) => [`${r.hand}:${r.d.i}`, r]));
  // kappa: share of shown calls per format class and street that were graded called-too-light / paid-off
  const kc = new Map();
  const byId = new Map(hands.map((x) => [x.id, x]));
  for (const r of exact) {
    if (r.d.kind !== 'call' || r.d.C <= 0) continue;
    const H = byId.get(r.hand);
    const k = `${fmtClass(H.fmt)}|${r.d.street}`;
    const v = kc.get(k) || [0, 0];
    v[1]++;
    if (
      r.verdict === 'MISTAKE' &&
      /called too light|paid off|call too light|stacked off/.test(r.type)
    )
      v[0]++;
    kc.set(k, v);
  }
  const kappa = new Map([...kc.entries()].map(([k, [a, n]]) => [k, (a + 1) / (n + 3)]));
  const nodes = collectNodes(hands, exactByDecision, model, kappa);
  // range-tier rows: every Horse decision not graded exactly
  const rangeRows = [];
  for (const H of hands)
    for (const d of H.decisions) {
      const me = H.seats.get(d.seat);
      if (!me?.horse || d.opp.length === 0) continue;
      if (exactByDecision.has(`${H.id}:${d.i}`)) continue;
      const nd = nodeOf(H, d);
      let v = nodes.get(nodeKey(nd));
      if (v.verdict === 'insufficient') v = nodes.get(parentKey(nd)) || v;
      const act =
        d.C > 0
          ? d.kind === 'fold'
            ? 'fold'
            : d.kind === 'call'
              ? 'call'
              : 'raise'
          : d.kind === 'check'
            ? 'check'
            : 'bet';
      const leaky =
        v.leakAction && (v.leakAction === act || (v.leakAction === 'call' && act === 'raise'));
      rangeRows.push({
        hand: H.id,
        seat: d.seat,
        horse: me.name,
        d,
        tier: 'range',
        verdict: leaky ? v.verdict : v.verdict === 'insufficient' ? 'insufficient' : 'fine',
        type: leaky ? v.verdict : '',
        cost: leaky ? v.perDecisionCost : 0,
        theory: v.perDecisionTheory && act === 'fold' ? v.perDecisionTheory : 0,
        gain: v.verdict === 'bets print' && act === 'bet' ? v.perDecisionGain || 0 : 0,
        node: v.key,
      });
    }
  // results tier
  const exactBy = new Map();
  for (const r of exact) (exactBy.get(r.hand) || exactBy.set(r.hand, []).get(r.hand)).push(r);
  const rangeBy = new Map();
  for (const r of rangeRows) (rangeBy.get(r.hand) || rangeBy.set(r.hand, []).get(r.hand)).push(r);
  const handRows = [];
  const conservation = [];
  for (const H of hands) {
    const nets = seatNets(H);
    let luck = null;
    try {
      luck = allInLuck(H);
    } catch {
      luck = null;
    }
    conservation.push(conservationGap(H));
    const persons = [...H.seats.values()].filter((s) => !s.horse);
    const horses = [...H.seats.values()].filter((s) => s.horse);
    const sum = (list, f) => list.reduce((a, s) => a + f(s), 0);
    const pNet = sum(persons, (s) => nets.get(s.seat)) / H.bb;
    const hNet = sum(horses, (s) => nets.get(s.seat)) / H.bb;
    const pAdj = luck ? pNet - sum(persons, (s) => luck.luck.get(s.seat) || 0) / H.bb : pNet;
    const hAdj = luck ? hNet - sum(horses, (s) => luck.luck.get(s.seat) || 0) / H.bb : hNet;
    const ex = exactBy.get(H.id) || [];
    const rg = rangeBy.get(H.id) || [];
    handRows.push({
      H,
      persons,
      horses,
      nets,
      luck: luck ? luck.luck : null,
      pNet,
      hNet,
      pAdj,
      hAdj,
      allInAdj: !!luck,
      allInStreet: luck ? luck.street : '',
      exact: ex,
      range: rg,
      showdown: H.sd.size >= 2,
    });
  }
  return { hands, exact, rangeRows, nodes, handRows, skipped, conservation, kappa };
}
