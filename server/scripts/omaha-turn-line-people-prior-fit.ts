/**
 * Fits the PEOPLE-ONLY turn cells split by the FLOP LINE for omahaTurnFacingBetPriorIsLineSplit
 * (server/src/engine/HorseOmahaTurnLinePeoplePrior.data.ts). Lane OFB, lead-8 2026-11-27.
 *
 * Owner order 2026-11-26: "the stats need to be used against human players, not horses." Same three filters as
 * omaha-facing-bet-people-prior-fit.ts (the law anOmahaFacingBetPriorIsPeopleMeasured holds for both files):
 *   - a bet counts only when the BETTOR is a person (profiles.is_horse = false AND the action's origin is not a Horse
 *     policy); a Horse's bet never enters, whoever answers it;
 *   - cards are read only where a PERSON showed them at showdown (mucked = false); the export carries no other cards
 *     (omaha-facing-bet-people-prior-export.sql). The HUD '*' population rows (about 99.5% Horse play) are never read.
 *
 * Measured, PLO4 and PLO5 pooled, a person's FIRST wager of the turn (never a raise), by the flop line
 *   checked  = nobody wagered on the flop (the flop checked through): the turn bet is a stab / probe;
 *   led      = somebody wagered on the flop;
 * (A further split by whether the turn was checked to him was measured and not kept: big heads-up stabs after a
 *  check 0.556 non-value, n 18, against leads 0.514, n 35: no difference the data can carry.)
 * heads-up / multiway and size bucket (under40, mid, big, over), in the same two units as the street fit:
 *   share     of the shown bets, the share outside the price's value region (the strongest OMAHA_EV_VALUE_SHARE x
 *             line factors of holdings on that board: the street fit's definition, byte for byte);
 *   nonTop20  of the shown bets, the share that does not beat OMAHA_BET_READ_VALUE_BEATS of holdings (the record unit);
 *   hidden    the bets whose cards are never shown although the bettor did not win uncontested: he folded later in
 *             the hand, or he reached a showdown and mucked (public events only; no card is read). The shown sample
 *             never sees them (lead-8 OFA finding); hiddenShare / hiddenNonTop20 count each as non-value:
 *             (k + h) / (n + h). Which of the two the price reads is the caller's flag (omahaPeoplePriorCountsHiddenBets).
 * Run from server/:  npx tsx scripts/omaha-turn-line-people-prior-fit.ts <out.data.ts> <export.json>...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Card } from '../src/types.js';
import { scoreOmahaHiPartial } from '../src/engine/HorseEval.js';
import { OMAHA_BET_READ_VALUE_BEATS } from '../src/engine/HorseOmahaBetRead.js';
import { OMAHA_EV_VALUE_SHARE, omahaBetSizeBucket } from '../src/engine/HorseOmahaFacingBetEv.js';

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
const key = (c: Card): string => `${c.rank}${c.suit}`;
let seed = 24680;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};
/** Share of random holdings (same card count) that beat this holding on this board: 4000 seeded draws. */
function beatShare(hole: Card[], board: Card[]): number {
  const seen = new Set([...hole, ...board].map(key));
  const rest = DECK.filter((c) => !seen.has(key(c)));
  const me = scoreOmahaHiPartial(hole, board);
  let beat = 0;
  let tie = 0;
  const N = 4000;
  const n = hole.length;
  for (let t = 0; t < N; t++) {
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rnd() * (rest.length - i));
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

const LINES = ['checked', 'led'] as const;
const WAYS = ['hu', 'mw'] as const;
const BUCKETS = ['under40', 'mid', 'big', 'over'] as const;
type C = { n: number; k: number; kTop20: number; hidden: number };
const cells: Record<string, C> = {};
for (const l of LINES)
  for (const w of WAYS)
    for (const b of BUCKETS) cells[`${l}.${w}.${b}`] = { n: 0, k: 0, kTop20: 0, hidden: 0 };
const NOT_TOP20 = 1 - OMAHA_BET_READ_VALUE_BEATS;

const [out, ...files] = process.argv.slice(2);
let hands = 0;
let used = 0;
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
    let flopWagers = 0;
    let turnWagered = false;
    const pending: { seat: number; cell: C; V: number }[] = [];
    let ok = true;
    for (const a of h.actions ?? []) {
      if (a.stage !== st && ['preflop', 'flop', 'turn', 'river'].includes(a.stage)) {
        st = a.stage;
        sc = new Map();
      }
      const amt = Number(a.amount) || 0;
      if (['sb', 'bb', 'post'].includes(a.action) && !a.dead) {
        sc.set(a.seat, (sc.get(a.seat) ?? 0) + amt);
        continue;
      }
      if (!['fold', 'check', 'call', 'bet', 'raise', 'all_in'].includes(a.action)) continue;
      const mine = sc.get(a.seat) ?? 0;
      const cur = Math.max(0, ...sc.values());
      const pot = Number(a.pot);
      const active = h.players.filter((p) => !folded.has(p.seat)).length;
      let act = a.action;
      let to = mine;
      if (act === 'all_in') {
        to = amt;
        act = cur === 0 && st !== 'preflop' ? 'bet' : to > cur + 1e-9 ? 'raise' : 'call';
      } else if (act === 'raise' || act === 'bet') to = amt;
      else if (act === 'call') to = mine + amt;
      const person = isPersonAction(P.get(a.seat), a);
      if (st === 'flop' && (act === 'bet' || act === 'raise') && to > cur + 1e-9) flopWagers++;
      if (st === 'turn' && (act === 'bet' || act === 'raise') && to > cur + 1e-9) {
        // the street's FIRST wager only, by a person
        if (!turnWagered && person && Number.isFinite(pot) && pot > 0) {
          const frac = (to - mine) / pot;
          if (Number.isFinite(frac) && frac > 0) {
            const bucket = omahaBetSizeBucket(frac) as (typeof BUCKETS)[number];
            const ag = aggrOn.flop.has(a.seat) ? 1 : 0;
            const ca = !aggrOn.flop.has(a.seat) && callOn.flop.has(a.seat) ? 1 : 0;
            const V = OMAHA_EV_VALUE_SHARE.turn[bucket as 'big'] * 0.8 ** ag * 0.9 ** ca;
            const line = flopWagers === 0 ? 'checked' : 'led';
            const c = cells[`${line}.${active > 2 ? 'mw' : 'hu'}.${bucket}`];
            if (c) pending.push({ seat: a.seat, cell: c, V });
          }
        }
        turnWagered = true;
      }
      if (st === 'flop' || st === 'turn' || st === 'river') {
        if (act === 'bet' || act === 'raise') aggrOn[st].add(a.seat);
        if (act === 'call') callOn[st].add(a.seat);
      }
      if (act === 'fold') folded.add(a.seat);
      sc.set(a.seat, Math.max(mine, to));
      if (!Number.isFinite(pot)) ok = false;
    }
    if (!ok || board.length < 5) continue;
    const liveAtEnd = h.players.filter((p) => !folded.has(p.seat)).length;
    let any = false;
    for (const b of pending) {
      const p = P.get(b.seat);
      const cards = p ? shown[p.userId] : undefined;
      if (!p || p.isHorse !== false) continue;
      if (!Array.isArray(cards)) {
        // hidden: not shown, and he folded after the bet or the hand reached a showdown (two or more never folded)
        if (folded.has(b.seat) || liveAtEnd >= 2) b.cell.hidden++;
        continue;
      }
      if (cards.length !== (h.gv === 'plo4' ? 4 : 5)) continue;
      const s = beatShare(cards, board.slice(0, 4));
      b.cell.n++;
      if (s > b.V) b.cell.k++;
      if (s > NOT_TOP20) b.cell.kTop20++;
      any = true;
    }
    if (any) used++;
  }
}
const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const shape: any = {};
for (const l of LINES) {
  shape[l] = {};
  for (const w of WAYS) {
    shape[l][w] = {};
    for (const b of BUCKETS) {
      const c = cells[`${l}.${w}.${b}`];
      shape[l][w][b] = {
        n: c.n,
        share: c.n > 0 ? r3(c.k / c.n) : null,
        nonTop20: c.n > 0 ? r3(c.kTop20 / c.n) : null,
        hidden: c.hidden,
        hiddenShare: c.n + c.hidden > 0 ? r3((c.k + c.hidden) / (c.n + c.hidden)) : null,
        hiddenNonTop20: c.n + c.hidden > 0 ? r3((c.kTop20 + c.hidden) / (c.n + c.hidden)) : null,
      };
    }
  }
}
const data = {
  source: 'people-only',
  filters: {
    bettor: 'profiles.is_horse = false and origin <> horse_policy',
    cards: 'shown at showdown by a person (mucked = false)',
    hudPopulationRows: 'not read',
  },
  hands,
  handsWithAShownPersonRead: used,
  turn: shape,
};
const ts = `/**
 * GENERATED by server/scripts/omaha-turn-line-people-prior-fit.ts from omaha-facing-bet-people-prior-export.sql rows
 * (PLO4/PLO5 cash, people only: the bettor is a person, cards shown by people at showdown, no HUD population rows,
 * no Horse play). Do not edit by hand: re-run the fit. Read by HorseOmahaTurnLinePeoplePrior.ts.
 */
export const OMAHA_TURN_LINE_PEOPLE_PRIOR_DATA = ${JSON.stringify(data, null, 2)} as const;
`;
writeFileSync(out, ts);
console.log(JSON.stringify(data.turn));
