/**
 * The postflop realisation of a heads-up flop in no-limit hold'em tournaments, measured in SELF-PLAY: league hands
 * (HorseLeague.playHand), where every card belongs to the engine's own simulated players. No database is read and no
 * person's or production player's card is used (the owner's ruling: zero unshown hole cards read, live or stored;
 * the 2026-11-24 table fitted from production hands with every player's starting hand was withdrawn for that
 * reason).
 *
 *   npx tsx scripts/holdem-tournament-raise-defence-solve/realisation-selfplay.ts <out realisation.json> [hands per format]
 *
 * Formats: the league's heads-up winner-take-all context, the six-handed big-blind-ante MTT context and the
 * six-handed Sit & Go context (the raise-defence cards' own contexts), every seat a Horse on the league's hybrid
 * tournament baseline with code-default options, start depths cycled over DEPTHS_BB so every stack-to-pot bucket is
 * met. Per hand that reaches the flop with exactly two players and both still holding chips (a flop decision is
 * made): F the pot before the first flop action; the out-of-position player (the first to act on the flop) realises
 * s = 1/2 + (net_oop - net_ip + pre_oop - pre_ip) / (2F) of it (the two shares add to 1; pre differs only by the big
 * blind's dead ante); e his all-in equity against the other's class (the class equity table); spr the smaller stack
 * behind at the flop over F. Fit per spr bucket: s = a + b e (least squares) with standard errors; solve.py reads a
 * and b at the bucket centres (median spr), linear between, flat outside.
 */
process.env.EQUITY_GOVERNOR = 'off';
// Offline, as src/scripts/horseLeagueCard.ts: no database is reachable from this script.
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'horse-league-card-offline-placeholder';
import { writeFileSync } from 'node:fs';

const { playHand, LEAGUE_MATCHUPS } = await import('../../src/benchmark/HorseLeague.js');
const { HorseMind } = await import('../../src/engine/HorseMind.js');
const { HORSE_HYBRID_PROFILES } = await import('../../src/engine/HorseHybridProfile.js');
const { HOLDEM_CLASSES, holdemClassOf } =
  await import('../../src/engine/HorseHoldemTournamentAllInCall.js');
const { classVsClassEquity } =
  await import('../../src/engine/HorseHoldemTournamentRaiseDefence.js');

export const VERSION = 'holdem-tournament-flop-realisation-selfplay-v2';
const EDGES = [1.5, 3, 6, 12];
const DEPTHS_BB = [10, 12, 15, 18, 22, 25, 30, 40, 60];
const BB = 2;
const FORMATS: Array<{ card: string; seats: number }> = [
  { card: 'hu_holdem_tournament_heads_up_big_blind_defence_is_priced_18bb', seats: 2 },
  { card: 'mtt6_holdem_tournament_blind_defence_is_priced_17bb', seats: 6 },
  { card: 'sng6_holdem_tournament_raise_defence_is_priced_17bb', seats: 6 },
];

const out = process.argv[2];
const handsPer = Number(process.argv[3] ?? 30000);
if (!out) throw new Error('usage: realisation-selfplay.ts <out.json> [hands per format]');
const hy = HORSE_HYBRID_PROFILES.tournament;
const rows: Array<[number, number, number]> = [];
const perFormat: Record<string, number> = {};
for (const f of FORMATS) {
  const card = LEAGUE_MATCHUPS.find((m: { name: string }) => m.name === f.card);
  if (!card) throw new Error(`no card ${f.card}`);
  const ctx = card.context;
  if (!ctx) throw new Error(`card ${f.card} has no tournament context`);
  const anteChips = ctx.bigBlindAnte === true ? (ctx.ante ?? 0) : 0;
  const sandbox = HorseMind.createSandbox();
  const counters = { illegal: 0, truncated: 0 };
  let n0 = rows.length;
  for (let h = 0; h < handsPer; h++) {
    const depth = DEPTHS_BB[h % DEPTHS_BB.length];
    const dealer = h % f.seats;
    const bbIdx = f.seats === 2 ? (dealer + 1) % 2 : (dealer + 2) % f.seats;
    let flopPot = -1;
    let oop = -1;
    let flopLive = 0;
    const flopSeats: number[] = [];
    let preflopAllIn = false;
    let matched = BB;
    const seed = (0x5e1f0000 + f.seats * 7919 + h * 104729) >>> 0;
    playHand(
      seed,
      dealer,
      () => ({}),
      counters,
      sandbox,
      'nlh',
      f.seats,
      depth,
      ctx,
      () => ({ ...hy.mods }),
      undefined,
      () => hy.style,
      false,
      {
        onAction: (e: {
          seatIdx: number;
          stage: string;
          action: string;
          amount: number;
          pot: number;
          liveBefore: number;
        }) => {
          if (e.stage === 'preflop') {
            if (e.action === 'all_in') preflopAllIn = true;
            if ((e.action === 'raise' || e.action === 'bet') && e.amount > matched)
              matched = e.amount;
          } else if (e.stage === 'flop') {
            if (flopPot < 0) {
              flopPot = e.pot;
              oop = e.seatIdx;
              flopLive = e.liveBefore;
            }
            if (!flopSeats.includes(e.seatIdx)) flopSeats.push(e.seatIdx);
          }
        },
        onEnd: (e: { cards: Array<Array<{ rank: string; suit: string }>>; net: number[] }) => {
          if (flopPot <= 0 || flopLive !== 2 || preflopAllIn) return;
          // The two players who saw the flop: the seats with a flop decision (a later fold keeps the hand).
          if (flopSeats.length !== 2) return;
          const otherSeen = flopSeats[1];
          const pre = (i: number) => (i === bbIdx ? anteChips : 0);
          const s =
            0.5 + (e.net[oop] - e.net[otherSeen] + pre(oop) - pre(otherSeen)) / (2 * flopPot);
          const ca = holdemClassOf(e.cards[oop][0] as never, e.cards[oop][1] as never);
          const cb = holdemClassOf(e.cards[otherSeen][0] as never, e.cards[otherSeen][1] as never);
          if (!ca || !cb) return;
          const eq = classVsClassEquity(HOLDEM_CLASSES.indexOf(ca), HOLDEM_CLASSES.indexOf(cb));
          const behind = Math.min(
            depth * BB - matched - pre(oop),
            depth * BB - matched - pre(otherSeen)
          );
          rows.push([behind / flopPot, eq, s]);
        },
      },
      1795000000000 + h * 60000
    );
  }
  perFormat[f.card] = rows.length - n0;
  n0 = rows.length;
  console.error(
    `${f.card}: ${perFormat[f.card]} heads-up flops of ${handsPer} hands (illegal ${counters.illegal}, truncated ${counters.truncated})`
  );
}

function fit(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (ys[i] - a - b * xs[i]) ** 2;
  const s2 = rss / Math.max(1, n - 2);
  return { a, b, seB: Math.sqrt(s2 / sxx), seA: Math.sqrt(s2 * (1 / n + (mx * mx) / sxx)) };
}
const bounds = [0, ...EDGES, Infinity];
const res = {
  version: VERSION,
  source:
    "self-play (HorseLeague.playHand), every card the engine's own simulated players'; no database read",
  formats: perFormat,
  edges: EDGES,
  sprCentres: [] as number[],
  a: [] as number[],
  b: [] as number[],
  n: [] as number[],
  seA: [] as number[],
  seB: [] as number[],
  realisedAtHalf: [] as number[],
  hands: rows.length,
};
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
for (let k = 0; k < bounds.length - 1; k++) {
  const sel = rows.filter((r) => r[0] >= bounds[k] && r[0] < bounds[k + 1]);
  const sprs = sel.map((r) => r[0]).sort((x, y) => x - y);
  const fr = fit(
    sel.map((r) => r[1]),
    sel.map((r) => r[2])
  );
  res.sprCentres.push(Math.round(sprs[Math.floor(sprs.length / 2)] * 1000) / 1000);
  res.a.push(r4(fr.a));
  res.b.push(r4(fr.b));
  res.n.push(sel.length);
  res.seA.push(r4(fr.seA));
  res.seB.push(r4(fr.seB));
  res.realisedAtHalf.push(r4((fr.a + fr.b * 0.5) / 0.5));
}
writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
console.log(JSON.stringify(res));
process.exit(0);
