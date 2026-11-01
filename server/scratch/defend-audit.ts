/**
 * DEFENCE AUDIT (V72, 2026-10-31): what a Hold'em horse does facing ONE open,
 * nobody calling, from every defender seat against every earlier opener seat.
 * Drives HorseLogic.decide end to end with the dealt census set.
 *
 *   SUPABASE_URL=https://supabase.invalid SUPABASE_SERVICE_ROLE_KEY=offline-league-placeholder \
 *   EQUITY_GOVERNOR=off npx tsx scratch/defend-audit.ts [seeds] [off] [ctx=a,b] [style=x] [grid=DEF:OPEN]
 */
import { HorseLogic, type HorseGameStateV2 } from '../src/engine/HorseLogic.js';
import { seedFastRandom } from '../src/engine/HorseEval.js';
import type { Card, SeatPlayer, ActionRecord, HorseStyle } from '../src/types.js';

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const BB = 2;
type Ctx = {
  name: string;
  seats: number;
  stackBB: number;
  mode: 'cash' | 'tournament';
  ante: boolean;
  openBB: number;
};
const CONTEXTS: Ctx[] = [
  { name: 'cash6_100', seats: 6, stackBB: 100, mode: 'cash', ante: false, openBB: 2.5 },
  { name: 'cash6_100x3', seats: 6, stackBB: 100, mode: 'cash', ante: false, openBB: 3 },
  { name: 'cash6_40', seats: 6, stackBB: 40, mode: 'cash', ante: false, openBB: 2.5 },
  { name: 'cash9_100', seats: 9, stackBB: 100, mode: 'cash', ante: false, openBB: 2.5 },
  { name: 'mtt9_50', seats: 9, stackBB: 50, mode: 'tournament', ante: true, openBB: 2.2 },
  { name: 'mtt9_25', seats: 9, stackBB: 25, mode: 'tournament', ante: true, openBB: 2.1 },
  { name: 'mtt6_50', seats: 6, stackBB: 50, mode: 'tournament', ante: true, openBB: 2.2 },
  { name: 'mtt6_25na', seats: 6, stackBB: 25, mode: 'tournament', ante: false, openBB: 2.1 },
  { name: 'mtt6_40na', seats: 6, stackBB: 40, mode: 'tournament', ante: false, openBB: 2.2 },
];
const args = process.argv.slice(2);
const seeds = Number(args[0] ?? 12);
const off = args.includes('off');
const only = args.find((a) => a.startsWith('ctx='))?.slice(4);
const style = (args.find((a) => a.startsWith('style='))?.slice(6) ?? 'balanced') as HorseStyle;
const gridSpot = args.find((a) => a.startsWith('grid='))?.slice(5);
const extra = args.find((a) => a.startsWith('opts='))?.slice(5);

function posNames(n: number): string[] {
  // seat order 3..n then 1 (SB), 2 (BB)
  const map: Record<number, string[]> = {
    9: ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN'],
    8: ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN'],
    6: ['UTG', 'HJ', 'CO', 'BTN'],
    5: ['HJ', 'CO', 'BTN'],
    4: ['CO', 'BTN'],
    3: ['BTN'],
  };
  return [...map[n], 'SB', 'BB'];
}
function classes() {
  const out: { cls: string; combos: number; r1: string; r2: string; kind: 'p' | 's' | 'o' }[] = [];
  for (let i = 0; i < 13; i++)
    for (let j = 0; j < 13; j++) {
      if (i === j)
        out.push({ cls: RANKS[i] + RANKS[j], combos: 6, r1: RANKS[i], r2: RANKS[j], kind: 'p' });
      else if (j > i)
        out.push({
          cls: RANKS[i] + RANKS[j] + 's',
          combos: 4,
          r1: RANKS[i],
          r2: RANKS[j],
          kind: 's',
        });
      else
        out.push({
          cls: RANKS[j] + RANKS[i] + 'o',
          combos: 12,
          r1: RANKS[j],
          r2: RANKS[i],
          kind: 'o',
        });
    }
  return out;
}
function tourney(stackBB: number, seats: number) {
  return {
    schemaVersion: 1 as const,
    contextStatus: 'complete' as const,
    contextIssues: [],
    playersLeft: 180,
    spotsPaid: 30,
    entrants: 300,
    avgStackChips: stackBB * BB,
    medianStackChips: stackBB * BB,
    seatsPerTable: seats,
    playersAtTable: seats,
    nearBubble: false,
    inMoney: false,
    payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
    currentSmallBlind: 1,
    currentBigBlind: 2,
    currentAnte: 2,
    anteType: 'big_blind' as const,
    nextSmallBlind: 2,
    nextBigBlind: 4,
    nextAnte: 4,
    nextBlindInMin: 10,
  };
}
type Cell = { call: number; raise: number; jam: number };
export function auditSpot(
  ctx: Ctx,
  heroSeat: number,
  openerSeat: number,
  opts: Record<string, unknown>,
  nSeeds: number
) {
  const n = ctx.seats;
  const actOrder = [...Array(n - 2).keys()].map((k) => 3 + k).concat([1, 2]);
  const res = new Map<string, Cell>();
  let ts = 1000;
  const openTo = ctx.openBB * BB;
  for (const c of classes()) {
    const cell: Cell = { call: 0, raise: 0, jam: 0 };
    for (let s = 0; s < nSeeds; s++) {
      const seed =
        (s + 1) * 7919 +
        heroSeat * 104729 +
        openerSeat * 7 +
        c.cls.charCodeAt(0) * 31 +
        c.cls.length;
      const su = (s * 3) % 4;
      const s1 = SUITS[su];
      const s2 = c.kind === 's' ? s1 : SUITS[(su + 1 + (s % 3)) % 4];
      const hole = [
        { rank: c.r1, suit: s1 },
        { rank: c.r2, suit: s2 },
      ] as Card[];
      const used = new Set(hole.map((h) => h.rank + h.suit));
      const deck: Card[] = [];
      for (const r of RANKS)
        for (const x of SUITS) if (!used.has(r + x)) deck.push({ rank: r, suit: x } as Card);
      const players: SeatPlayer[] = [];
      const history: ActionRecord[] = [];
      let di = (seed % 40) + 1;
      for (let seat = 1; seat <= n; seat++) {
        let bet = seat === 1 ? 1 : seat === 2 ? 2 : 0;
        if (seat === openerSeat) bet = openTo;
        const anteHere = seat === 2 && ctx.ante ? 2 : 0;
        players.push({
          seat,
          user_id: `a-${seat}`,
          username: `A${seat}`,
          stack: ctx.stackBB * BB - bet - anteHere,
          bet,
          totalInvested: bet + anteHere,
          cards:
            seat === heroSeat
              ? hole
              : [deck[(di++ * 7) % deck.length], deck[(di++ * 11) % deck.length]],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
          is_horse: true,
        } as SeatPlayer);
      }
      for (const seat of actOrder) {
        if (seat === heroSeat) break;
        const p = players[seat - 1];
        if (seat === openerSeat) {
          history.push({
            seat,
            userId: p.user_id,
            action: 'raise',
            amount: openTo,
            timestamp: ts++,
            stage: 'preflop',
            isFullRaise: true,
          } as ActionRecord);
          continue;
        }
        p.is_folded = true;
        history.push({
          seat,
          userId: p.user_id,
          action: 'fold',
          amount: 0,
          timestamp: ts++,
          stage: 'preflop',
        } as ActionRecord);
      }
      const pot = 3 + openTo + (ctx.ante ? 2 : 0) - (openerSeat === 1 ? 1 : 0);
      const gs = {
        players,
        communityCards: [],
        pot,
        currentBet: openTo,
        minRaise: openTo - 2,
        lastRaise: openTo - 2,
        stage: 'preflop',
        gameVariant: 'nlh',
        bigBlind: BB,
        dealerSeat: n,
        actionHistory: history,
        gameMode: ctx.mode,
        ante: ctx.ante ? 2 : 0,
        bigBlindAnte: ctx.ante,
        format: ctx.mode === 'cash' ? 'cash' : 'mtt',
        dealtSeatIds: players.map((p) => p.seat),
        ...(ctx.mode === 'tournament' ? { tournament: tourney(ctx.stackBB, n) } : {}),
      } as unknown as HorseGameStateV2;
      seedFastRandom(seed);
      const hero = players[heroSeat - 1];
      const d = HorseLogic.decide(
        hero,
        gs,
        style,
        {} as never,
        { mind: false, telemetry: false, ...opts } as never
      );
      if (d.action === 'call') cell.call++;
      else if (
        d.action === 'all_in' ||
        (d.action === 'raise' && (d.amount ?? 0) >= hero.stack + hero.bet - 1e-9)
      )
        cell.jam++;
      else if (d.action === 'raise' || d.action === 'bet') cell.raise++;
    }
    cell.call /= nSeeds;
    cell.raise /= nSeeds;
    cell.jam /= nSeeds;
    res.set(c.cls, cell);
  }
  return res;
}
export function sum(m: Map<string, Cell>) {
  let call = 0,
    raise = 0,
    jam = 0;
  for (const c of classes()) {
    const x = m.get(c.cls)!;
    call += x.call * c.combos;
    raise += x.raise * c.combos;
    jam += x.jam * c.combos;
  }
  return { call: (100 * call) / 1326, raise: (100 * raise) / 1326, jam: (100 * jam) / 1326 };
}
function grid(m: Map<string, Cell>) {
  const lines = ['     ' + RANKS.map((r) => r.padStart(4)).join('')];
  for (let i = 0; i < 13; i++) {
    let line = RANKS[i].padEnd(5);
    for (let j = 0; j < 13; j++) {
      const cls =
        i === j
          ? RANKS[i] + RANKS[j]
          : j > i
            ? RANKS[i] + RANKS[j] + 's'
            : RANKS[j] + RANKS[i] + 'o';
      const x = m.get(cls)!;
      const r = Math.round((x.raise + x.jam) * 100),
        cl = Math.round(x.call * 100);
      line += (
        r >= 50
          ? 'R' + (r === 100 ? '' : r)
          : cl >= 50
            ? 'c' + (cl === 100 ? '' : cl)
            : r + cl > 0
              ? '~'
              : '.'
      ).padStart(4);
    }
    lines.push(line);
  }
  return lines.join('\n');
}
if (process.argv[1]?.endsWith('defend-audit.ts')) {
  const opts: Record<string, unknown> = off ? { v72DefenceByOpener: false } : {};
  if (extra) Object.assign(opts, JSON.parse(extra));
  for (const ctx of CONTEXTS) {
    if (only && !only.split(',').includes(ctx.name)) continue;
    const names = posNames(ctx.seats);
    const seatOf = (i: number) => (i < ctx.seats - 2 ? 3 + i : i === ctx.seats - 2 ? 1 : 2);
    console.log(
      `\n${ctx.name} (${style}${off ? ', off' : ''}) defender vs opener: call/3bet(+jam) = total`
    );
    for (let d = names.length - 1; d >= 1; d--) {
      const row: string[] = [];
      for (let o = 0; o < d; o++) {
        if (names[d] === 'BB' || names[d] === 'SB' || o < d) {
          if (names[o] === 'SB' && names[d] !== 'BB') continue;
          const m = auditSpot(ctx, seatOf(d), seatOf(o), opts, seeds);
          const s = sum(m);
          row.push(
            `${names[o]} ${s.call.toFixed(1)}/${s.raise.toFixed(1)}${s.jam > 0.05 ? '+j' + s.jam.toFixed(1) : ''}=${(s.call + s.raise + s.jam).toFixed(1)}`
          );
          if (gridSpot === `${names[d]}:${names[o]}`) console.log(grid(m));
        }
      }
      console.log(`  ${names[d].padEnd(4)} | ${row.join(' | ')}`);
    }
  }
  process.exit(0);
}
