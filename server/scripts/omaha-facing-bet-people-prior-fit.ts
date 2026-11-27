/**
 * Fits the PEOPLE-ONLY population of the PLO4/PLO5 cash facing-bet price
 * (server/src/engine/HorseOmahaFacingBetPeoplePrior.data.ts; option omahaFacingBetPriorIsPeopleMeasured).
 *
 * Owner order 2026-11-26: "the stats need to be used against human players, not horses." Every population number
 * the facing-bet price is fed is measured from PEOPLE's play only:
 *   - a bet or raise counts only when the BETTOR is a person (profiles.is_horse = false AND the action's origin is
 *     not a Horse policy); a Horse's bet never enters, whoever answers it;
 *   - a fold / call / continue counts only when the RESPONDER is a person;
 *   - cards are read only where a PERSON showed them at showdown (mucked = false); the export carries no other cards
 *     (omaha-facing-bet-people-prior-export.sql). The HUD '*' population rows (about 99.5% Horse play) are never read.
 * The law anOmahaFacingBetPriorIsPeopleMeasured checks this file keeps those three filters.
 *
 * Measured, PLO4 and PLO5 pooled, per street (turn, river), heads-up / multiway, size bucket (under40, mid, big,
 * over) and raise:
 *   bluff    of a person's bets of that cell that were SHOWN, the share whose shown holding lies in the price's OTHER
 *            region: on the turn outside the value region the price uses for that bet (the strongest
 *            OMAHA_EV_VALUE_SHARE x line factors of holdings on that board), on the river inside the weakest
 *            OMAHA_EV_BLUFF_POOL of holdings (a hand between the two counts as value: the conservative side).
 *            Showdown sample: only called bets are shown (stated in the authority doc).
 *   fold     of the times a person faced a bet of that cell (first answer on the street), the share that folded.
 *   caller   per street: 2 x the mean beat share (share of holdings that beat it on that board) of a person's shown
 *            holding after calling a bet: the width of a uniform top region with the same mean.
 * Every cell carries its n. Run from server/:
 *   npx tsx scripts/omaha-facing-bet-people-prior-fit.ts <out.data.ts> <export.json>...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Card } from '../src/types.js';
import { scoreOmahaHiPartial } from '../src/engine/HorseEval.js';
import { OMAHA_BET_READ_VALUE_BEATS } from '../src/engine/HorseOmahaBetRead.js';
import {
  OMAHA_FLOP_EV_LEAD,
  OMAHA_FLOP_EV_STAB,
  OMAHA_FLOP_EV_VALUE_SHARE,
} from '../src/engine/HorseOmahaFlopFacingBetEv.js';
import {
  OMAHA_EV_BLUFF_POOL,
  OMAHA_EV_VALUE_SHARE,
  omahaBetSizeBucket,
} from '../src/engine/HorseOmahaFacingBetEv.js';

type Act = {
  seat: number;
  stage: string;
  action: string;
  amount: number | null;
  origin: string | null;
  dead: boolean | null;
  pot: number | null;
  toCall: number | null;
};
type Hand = {
  id: string;
  gv: string;
  bb: number;
  cc: string[] | null;
  players: { seat: number; userId: string; isHorse: boolean }[];
  actions: Act[];
  shown: Record<string, Card[]> | null;
};

/** A person acted: the seat's profile is not a Horse AND the action did not come from a Horse policy. */
export function isPersonAction(p: { isHorse: boolean } | undefined, a: Act): boolean {
  return !!p && p.isHorse === false && a.origin !== 'horse_policy';
}

const SUIT_NAMES = ['hearts', 'spades', 'diamonds', 'clubs'];
const cardOf = (s: string): Card => ({ rank: s[0], suit: s.slice(1) }) as Card;
const RANKS = '23456789TJQKA';
const DECK: Card[] = [];
for (const r of RANKS) for (const s of SUIT_NAMES) DECK.push({ rank: r, suit: s } as Card);
const k = (c: Card): string => `${c.rank}${c.suit}`;

let seed = 12345;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};
/** The flop cells' own stream (omahaFlopPressureCapIsPriced): the turn and river cells keep theirs, unchanged. */
let flopSeed = 67890;
const rndFlop = (): number => {
  flopSeed = (flopSeed * 1103515245 + 12345) & 0x7fffffff;
  return flopSeed / 0x80000000;
};
/** Share of random holdings (same card count) that beat this holding on this board: 4000 seeded draws. */
function beatShare(hole: Card[], board: Card[], draw: () => number = rnd): number {
  const seen = new Set([...hole, ...board].map(k));
  const rest = DECK.filter((c) => !seen.has(k(c)));
  const me = scoreOmahaHiPartial(hole, board);
  let beat = 0;
  let tie = 0;
  const N = 4000;
  const n = hole.length;
  for (let t = 0; t < N; t++) {
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(draw() * (rest.length - i));
      const x = rest[i];
      rest[i] = rest[j];
      rest[j] = x;
    }
    const s = scoreOmahaHiPartial(rest.slice(0, n), board);
    if (s > me) beat++;
    else if (s === me) tie++;
  }
  return (beat + tie / 2) / N;
}

/** A shown hand is the record's value when it beats OMAHA_BET_READ_VALUE_BEATS of holdings: beat share <= 1 - that. */
const OMAHA_PEOPLE_RECORD_VALUE_BEAT_SHARE = 1 - OMAHA_BET_READ_VALUE_BEATS;
type Cell = { n: number; k: number };
const cell = (): Cell => ({ n: 0, k: 0 });
const BUCKETS = ['under40', 'mid', 'big', 'over', 'raise'] as const;
type Tab = Record<'turn' | 'river', Record<'hu' | 'mw', Record<(typeof BUCKETS)[number], Cell>>>;
const tab = (): Tab => {
  const o: any = {};
  for (const st of ['turn', 'river'])
    for (const w of ['hu', 'mw']) {
      o[st] ??= {};
      o[st][w] = {};
      for (const b of BUCKETS) o[st][w][b] = cell();
    }
  return o;
};
const bluff = tab();
const fold = tab();
/** Per cell: the share of a person's shown bets that do NOT beat 80% of holdings (beat share > 0.2): the unit the
 *  per-opponent record (HorseOmahaBetRead, OMAHA_BET_READ_VALUE_BEATS = 0.8) counts as not value. The record moves
 *  the prior by its ratio to this people share, so the two are compared in the same unit. */
const nonTop20 = tab();
/** River only: the shown bettor's region. core = inside the price's value region (beat share <= V), bottom = the
 *  weakest OMAHA_EV_BLUFF_POOL of holdings, middle = between. The river verdict prices each region separately. */
type Reg = { n: number; core: number; middle: number };
const regTab = (): Record<'hu' | 'mw', Record<(typeof BUCKETS)[number], Reg>> => {
  const o: any = { hu: {}, mw: {} };
  for (const w of ['hu', 'mw']) for (const b of BUCKETS) o[w][b] = { n: 0, core: 0, middle: 0 };
  return o;
};
const riverRegions = regTab();
const callerSum = { turn: { n: 0, s: 0 }, river: { n: 0, s: 0 } };
/** FLOP (omahaFlopPressureCapIsPriced): of a person's shown flop bets or raises, the share outside the flop
 *  verdict's value region for that bet (the strongest OMAHA_FLOP_EV_VALUE_SHARE x line of holdings on the flop: a
 *  lead into the preflop raiser OMAHA_FLOP_EV_LEAD, a bet after he checked OMAHA_FLOP_EV_STAB), and in the record's
 *  not-value unit (nonTop20). The answer may come from anyone (a heads-up flop bet answered by a person and shown is
 *  too thin to fit alone: answeredByAPerson counts it per cell). Own random stream: the turn and river cells above
 *  are byte-identical with or without the flop. */
type FlopCell = { n: number; k: number; kTop20: number; answeredByAPerson: number };
const flopTab = (): Record<'hu' | 'mw', Record<(typeof BUCKETS)[number], FlopCell>> => {
  const o: any = { hu: {}, mw: {} };
  for (const w of ['hu', 'mw'])
    for (const b of BUCKETS) o[w][b] = { n: 0, k: 0, kTop20: 0, answeredByAPerson: 0 };
  return o;
};
const flopCells = flopTab();
/** HIDDEN BETS (omahaPeoplePriorCountsHiddenBets; lead-8 2026-11-27). A person's flop or turn bet whose cards are never
 *  shown although he did not win it uncontested: he folded later in the hand, or he reached the showdown and mucked.
 *  Public events only (a fold and a muck are public; no card is read). The shown sample never sees them, so it
 *  over-states value: of called person bets only 37-57% are shown on the flop and the turn (every called river bettor
 *  is shown). Split cells, per game: the flop by pot type (limped / single-raised / 3-bet or more: 3-bet pots are
 *  value-heavy and must not borrow single-raised bluffs), the turn by line (the flop checked through / he made the
 *  flop wager / another player did). Each cell keeps its shown counts (n, k, kTop20) and its hidden count h; the
 *  corrected share counts every hidden bet as non-value ((k + h) / (n + h)); a bet won with no showdown keeps the
 *  shown mix (not counted). Same people-only bettor filter as every cell above. */
type SplitCell = { n: number; k: number; kTop20: number; h: number };
const splitCells = new Map<string, SplitCell>();
const splitOf = (key: string): SplitCell => {
  let c = splitCells.get(key);
  if (!c) splitCells.set(key, (c = { n: 0, k: 0, kTop20: 0, h: 0 }));
  return c;
};

const [out, ...files] = process.argv.slice(2);
let hands = 0;
let used = 0;
let usedFlop = 0;
const ids = new Set<string>();
for (const f of files) {
  const rows: Hand[] = JSON.parse(readFileSync(f, 'utf8'));
  for (const h of rows) {
    if (!h || ids.has(h.id)) continue;
    ids.add(h.id);
    if (h.gv !== 'plo4' && h.gv !== 'plo5') continue;
    hands++;
    const board = (h.cc ?? []).map(cardOf);
    const P = new Map(h.players.map((p) => [p.seat, p]));
    const shown = h.shown ?? {};
    const folded = new Set<number>();
    // voluntary give-ups (lead ruling 2026-11-27): he checked a street and then folded to a bet on it; a fold facing a
    // raise of his own wager is NOT one (a value hand can be outdrawn or priced out)
    const giveUp = new Set<number>();
    let checkedHere = new Set<number>();
    let st = '';
    let sc = new Map<number, number>();
    const aggrOn: Record<string, Set<number>> = {
      flop: new Set(),
      turn: new Set(),
      river: new Set(),
    };
    const callOn: Record<string, Set<number>> = {
      flop: new Set(),
      turn: new Set(),
      river: new Set(),
    };
    const answered = new Set<string>();
    // the flop line: the last preflop raiser, the flop wagers so far, whether he checked before the first one
    let preLevel = 0;
    let preAggressor: number | null = null;
    let flopWagers = 0;
    let aggressorChecked = false;
    const pendingFlop: {
      seat: number;
      cell: FlopCell;
      V: number;
      byPerson: boolean;
      split: SplitCell;
    }[] = [];
    let preRaises = 0;
    const pending: {
      seat: number;
      street: 'turn' | 'river';
      cell: Cell;
      V: number;
      reg: Reg;
      nt: Cell;
      split: SplitCell | null;
    }[] = [];
    const calls: { seat: number; street: 'turn' | 'river' }[] = [];
    let ok = true;
    for (const a of h.actions ?? []) {
      if (a.stage !== st && ['preflop', 'flop', 'turn', 'river'].includes(a.stage)) {
        st = a.stage;
        sc = new Map();
        checkedHere = new Set();
      }
      const amt = Number(a.amount) || 0;
      if (['sb', 'bb', 'post'].includes(a.action) && !a.dead) {
        sc.set(a.seat, (sc.get(a.seat) ?? 0) + amt);
        continue;
      }
      if (!['fold', 'check', 'call', 'bet', 'raise', 'all_in'].includes(a.action)) continue;
      const mine = sc.get(a.seat) ?? 0;
      const cur = Math.max(0, ...sc.values());
      const toCall = cur - mine;
      const pot = Number(a.pot);
      const active = h.players.filter((p) => !folded.has(p.seat)).length;
      let act = a.action;
      let to = mine;
      if (act === 'all_in') {
        to = amt;
        act = cur === 0 && st !== 'preflop' ? 'bet' : to > cur + 1e-9 ? 'raise' : 'call';
      } else if (act === 'raise' || act === 'bet') to = amt;
      else if (act === 'call') to = mine + amt;
      const street = st as 'turn' | 'river';
      const late = st === 'turn' || st === 'river';
      const person = isPersonAction(P.get(a.seat), a);
      if (late && person && toCall > 0 && (act === 'fold' || act === 'call' || act === 'raise')) {
        const key = `${st}:${a.seat}`;
        if (!answered.has(key) && Number.isFinite(pot) && pot - toCall > 0) {
          answered.add(key);
          const frac = toCall / (pot - toCall);
          const c = fold[street][active > 2 ? 'mw' : 'hu'][omahaBetSizeBucket(frac)];
          c.n++;
          if (act === 'fold') c.k++;
        }
        if (act === 'call') calls.push({ seat: a.seat, street });
      }
      if (late && person && (act === 'bet' || act === 'raise') && Number.isFinite(pot) && pot > 0) {
        const isRaise = act === 'raise';
        const frac = isRaise ? (to - cur) / (pot + toCall) : (to - mine) / pot;
        if (Number.isFinite(frac) && frac > 0) {
          const bucket = isRaise ? 'raise' : omahaBetSizeBucket(frac);
          const earlier = st === 'turn' ? ['flop'] : ['flop', 'turn'];
          const ag = earlier.filter((e) => aggrOn[e].has(a.seat)).length;
          const ca = earlier.filter((e) => !aggrOn[e].has(a.seat) && callOn[e].has(a.seat)).length;
          const V = OMAHA_EV_VALUE_SHARE[street][bucket as 'raise'] * 0.8 ** ag * 0.9 ** ca;
          pending.push({
            seat: a.seat,
            street,
            cell: bluff[street][active > 2 ? 'mw' : 'hu'][bucket],
            V,
            reg: riverRegions[active > 2 ? 'mw' : 'hu'][bucket],
            nt: nonTop20[street][active > 2 ? 'mw' : 'hu'][bucket],
            split:
              street === 'turn'
                ? splitOf(
                    `turn|${h.gv}|${active > 2 ? 'mw' : 'hu'}|${bucket}|${
                      aggrOn.flop.has(a.seat) ? 'b' : flopWagers > 0 ? 'c' : 'x'
                    }`
                  )
                : null,
          });
        }
      }
      if (st === 'preflop' && (act === 'bet' || act === 'raise') && to > preLevel + 1e-9) {
        preRaises++;
        preLevel = to;
        preAggressor = a.seat;
      }
      if (st === 'flop') {
        if (act === 'check' && a.seat === preAggressor && flopWagers === 0) aggressorChecked = true;
        if (
          (act === 'bet' || act === 'raise') &&
          to > cur + 1e-9 &&
          Number.isFinite(pot) &&
          pot > 0
        ) {
          flopWagers++;
          const isRaise = flopWagers >= 2;
          const frac = isRaise ? (to - cur) / (pot + toCall) : (to - mine) / pot;
          if (person && Number.isFinite(frac) && frac > 0) {
            const bucket = isRaise ? 'raise' : omahaBetSizeBucket(frac);
            const into =
              !isRaise &&
              preAggressor !== null &&
              preAggressor !== a.seat &&
              !folded.has(preAggressor);
            const line = into ? (aggressorChecked ? OMAHA_FLOP_EV_STAB : OMAHA_FLOP_EV_LEAD) : 1;
            const others = h.players.filter((p) => p.seat !== a.seat && !folded.has(p.seat));
            pendingFlop.push({
              seat: a.seat,
              cell: flopCells[active > 2 ? 'mw' : 'hu'][bucket],
              V: OMAHA_FLOP_EV_VALUE_SHARE[bucket] * line,
              byPerson: others.length === 1 && others[0].isHorse === false,
              split: splitOf(
                `flop|${h.gv}|${active > 2 ? 'mw' : 'hu'}|${bucket}|${
                  preRaises === 0 ? 'limped' : preRaises === 1 ? 'single' : 'reraised'
                }`
              ),
            });
          }
        }
      }
      if (st === 'flop' || late) {
        if (act === 'bet' || act === 'raise') aggrOn[st].add(a.seat);
        if (act === 'call') callOn[st].add(a.seat);
      }
      if (act === 'fold' && checkedHere.has(a.seat)) giveUp.add(a.seat);
      if (act === 'check') checkedHere.add(a.seat);
      if (act === 'fold') folded.add(a.seat);
      sc.set(a.seat, Math.max(mine, to));
      if (!Number.isFinite(pot)) ok = false;
    }
    if (!ok || board.length < 5) continue;
    // hidden: not shown, and a voluntary give-up (checked, then folded to a bet) or a muck at the showdown (he never
    // folded and two or more players reached it; the river's wager-maker is always shown, so a muck is a showdown he
    // did not lead). A fold facing a raise of his own wager is not counted.
    const liveAtEnd = h.players.filter((p) => !folded.has(p.seat)).length;
    const shownBy = (seat: number): boolean => {
      const p = P.get(seat);
      const cards = p ? shown[p.userId] : undefined;
      return !!p && Array.isArray(cards) && cards.length === (h.gv === 'plo4' ? 4 : 5);
    };
    const hiddenOf = (seat: number): boolean =>
      P.get(seat)?.isHorse === false &&
      !shownBy(seat) &&
      (giveUp.has(seat) || (!folded.has(seat) && liveAtEnd >= 2));
    for (const b of pendingFlop) if (!shownBy(b.seat) && hiddenOf(b.seat)) b.split.h++;
    for (const b of pending) if (b.split && !shownBy(b.seat) && hiddenOf(b.seat)) b.split.h++;
    let any = false;
    const bs = new Map<string, number>();
    const strength = (seat: number, street: 'turn' | 'river'): number | null => {
      const p = P.get(seat);
      const cards = p ? shown[p.userId] : undefined;
      if (
        !p ||
        p.isHorse !== false ||
        !Array.isArray(cards) ||
        cards.length !== (h.gv === 'plo4' ? 4 : 5)
      )
        return null;
      const key = `${seat}:${street}`;
      if (!bs.has(key)) bs.set(key, beatShare(cards, board.slice(0, street === 'turn' ? 4 : 5)));
      return bs.get(key)!;
    };
    let anyFlop = false;
    for (const b of pendingFlop) {
      const p = P.get(b.seat);
      const cards = p ? shown[p.userId] : undefined;
      if (
        !p ||
        p.isHorse !== false ||
        !Array.isArray(cards) ||
        cards.length !== (h.gv === 'plo4' ? 4 : 5)
      )
        continue;
      const s = beatShare(cards, board.slice(0, 3), rndFlop);
      b.cell.n++;
      if (s > b.V) b.cell.k++;
      if (s > OMAHA_PEOPLE_RECORD_VALUE_BEAT_SHARE) b.cell.kTop20++;
      b.split.n++;
      if (s > b.V) b.split.k++;
      if (s > OMAHA_PEOPLE_RECORD_VALUE_BEAT_SHARE) b.split.kTop20++;
      if (b.byPerson) b.cell.answeredByAPerson++;
      anyFlop = true;
    }
    for (const b of pending) {
      const s = strength(b.seat, b.street);
      if (s === null) continue;
      b.cell.n++;
      // the price's other region: turn, every non-value holding; river, the weakest OMAHA_EV_BLUFF_POOL of holdings
      // (a shown hand between the value edge and that pool is counted as value: the conservative side)
      if (s > (b.street === 'river' ? Math.max(b.V, 1 - OMAHA_EV_BLUFF_POOL) : b.V)) b.cell.k++;
      b.nt.n++;
      if (s > OMAHA_PEOPLE_RECORD_VALUE_BEAT_SHARE) b.nt.k++;
      if (b.split) {
        b.split.n++;
        if (s > b.V) b.split.k++;
        if (s > OMAHA_PEOPLE_RECORD_VALUE_BEAT_SHARE) b.split.kTop20++;
      }
      if (b.street === 'river') {
        b.reg.n++;
        if (s <= b.V) b.reg.core++;
        else if (s <= 1 - OMAHA_EV_BLUFF_POOL) b.reg.middle++;
      }
      any = true;
    }
    for (const c of calls) {
      const s = strength(c.seat, c.street);
      if (s === null) continue;
      callerSum[c.street].n++;
      callerSum[c.street].s += s;
      any = true;
    }
    if (any) used++;
    if (anyFlop) usedFlop++;
  }
}
const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const shape = (t: Tab) => {
  const o: any = {};
  for (const st of ['turn', 'river'] as const)
    for (const w of ['hu', 'mw'] as const) {
      o[st] ??= {};
      o[st][w] = {};
      for (const b of BUCKETS) {
        const c = t[st][w][b];
        o[st][w][b] = { n: c.n, share: c.n > 0 ? r3(c.k / c.n) : null };
      }
    }
  return o;
};
const callerOf = (c: { n: number; s: number }) => ({
  n: c.n,
  share: c.n ? r3(Math.min(0.95, (2 * c.s) / c.n)) : null,
});
const data = {
  source: 'people-only',
  filters: {
    bettor: 'profiles.is_horse = false and origin <> horse_policy',
    responder: 'profiles.is_horse = false and origin <> horse_policy',
    cards: 'shown at showdown by a person (mucked = false)',
    hudPopulationRows: 'not read',
  },
  hands,
  handsWithAShownPersonRead: used,
  handsWithAShownPersonFlopRead: usedFlop,
  bluff: shape(bluff),
  fold: shape(fold),
  nonTop20: shape(nonTop20),
  flop: Object.fromEntries(
    (['hu', 'mw'] as const).map((w) => [
      w,
      Object.fromEntries(
        BUCKETS.map((b) => {
          const c = flopCells[w][b];
          return [
            b,
            {
              n: c.n,
              share: c.n > 0 ? r3(c.k / c.n) : null,
              nonTop20: c.n > 0 ? r3(c.kTop20 / c.n) : null,
              answeredByAPerson: c.answeredByAPerson,
            },
          ];
        })
      ),
    ])
  ),
  caller: { turn: callerOf(callerSum.turn), river: callerOf(callerSum.river) },
  riverRegions: Object.fromEntries(
    (['hu', 'mw'] as const).map((w) => [
      w,
      Object.fromEntries(
        BUCKETS.map((b) => {
          const r = riverRegions[w][b];
          return [
            b,
            r.n > 0
              ? {
                  n: r.n,
                  core: r3(r.core / r.n),
                  middle: r3(r.middle / r.n),
                  bottom: r3((r.n - r.core - r.middle) / r.n),
                }
              : { n: 0, core: null, middle: null, bottom: null },
          ];
        })
      ),
    ])
  ),
};
const ts = `/**
 * GENERATED by server/scripts/omaha-facing-bet-people-prior-fit.ts from omaha-facing-bet-people-prior-export.sql
 * (PLO4/PLO5 cash, people only: bettor and responder are people, cards shown by people at showdown, no HUD
 * population rows, no Horse play). Do not edit by hand: re-run the fit. Read by HorseOmahaFacingBetPeoplePrior.ts.
 */
export const OMAHA_FACING_BET_PEOPLE_PRIOR_DATA = ${JSON.stringify(data, null, 2)} as const;
`;
writeFileSync(out, ts);
// omahaPeoplePriorCountsHiddenBets: the split cells, in their own generated file beside the data file
// the same split pooled over the two games (key game 'all'): the people cell a thin per-game cell shrinks toward
for (const [key, c] of [...splitCells.entries()]) {
  const parts = key.split('|');
  parts[1] = 'all';
  const all = splitOf(parts.join('|'));
  all.n += c.n;
  all.k += c.k;
  all.kTop20 += c.kTop20;
  all.h += c.h;
}
const hiddenCells = Object.fromEntries(
  [...splitCells.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, c]) => {
      // RE-RAISED FLOP POTS keep the shown-only share (hidden bets reported, not counted): the public evidence does not
      // separate their give-ups and mucks from value (they are deep, SPR 4+, like single-raised pots, so the low-SPR
      // stack-off reading is refuted), the serving engine already folds there under the pure-bluff break-even
      // (PLO5 30.7% vs 46.1%), and the calls the correction added there lost (OFC: -40.6 +/- 17.2 bb, n 5).
      // l8-ofa/BUILD.md "re-raised pots". A fit decision on the counts, not a bound on the output.
      const count = !key.endsWith('|reraised');
      const h = count ? c.h : 0;
      return [
        key,
        {
          shown: c.n,
          hidden: c.h,
          hiddenCounted: count,
          share: c.n + h > 0 ? r3((c.k + h) / (c.n + h)) : null,
          nonTop20: c.n + h > 0 ? r3((c.kTop20 + h) / (c.n + h)) : null,
          shownShare: c.n > 0 ? r3(c.k / c.n) : null,
        },
      ];
    })
);
const cellsOut = out.replace(/[^/]*$/, 'HorseOmahaPeoplePriorHidden.data.ts');
writeFileSync(
  cellsOut,
  `/**
 * GENERATED by server/scripts/omaha-facing-bet-people-prior-fit.ts (the same people-only export and filters as
 * HorseOmahaFacingBetPeoplePrior.data.ts). Do not edit by hand: re-run the fit. Read by HorseOmahaPeoplePriorHidden.ts
 * (omahaPeoplePriorCountsHiddenBets). Key: street|game (plo4, plo5, or all = both games pooled)|hu or mw|size bucket|split (flop: limped / single / reraised
 * pot; turn: x the flop checked through, b he made the flop wager, c another player did). shown / hidden: the bets
 * counted; hiddenCounted: whether the cell counts them (re-raised flop pots do not); share / nonTop20: non-value shares
 * (hidden bets as non-value where counted); shownShare: shown only.
 */
export const OMAHA_PEOPLE_PRIOR_HIDDEN_DATA: Readonly<
  Record<
    string,
    {
      shown: number;
      hidden: number;
      hiddenCounted: boolean;
      share: number | null;
      nonTop20: number | null;
      shownShare: number | null;
    }
  >
> = ${JSON.stringify(hiddenCells, null, 2)};
`
);
console.log(JSON.stringify(data));
