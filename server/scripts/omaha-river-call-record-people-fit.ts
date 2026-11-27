/**
 * Fits PEOPLE's fold to a heads-up PLO4/PLO5 cash turn or river FIRST wager, by street and size cell, and the
 * between-player shrink k, for omahaRiverCallRangeIsHisRecord (server/src/engine/HorseOmahaRiverCallRecord.ts; the
 * generated table is server/src/engine/HorseOmahaRiverCallRecordPeople.data.ts).
 *
 * Owner order 2026-11-26: "the stats need to be used against human players, not horses." The cell is the one
 * OPPONENT-HUD counts for every player (x.foldToBet.small / x.foldToBet.big, HorseOmahaLifetimeHudAdapter.ts): his
 * FIRST answer to the street's FIRST wager, heads-up, the wager at most 0.7 of the pot before it ('small') or above it
 * or all-in ('big'). Here an answer counts only when the RESPONDER is a person:
 *   - PEOPLE ONLY: a responder whose profile is a Horse (profiles.is_horse, the horses file) never enters
 *     (isPersonAnswer); the bettor may be anyone, exactly as his own record counts it, so his record and people's
 *     rate are measured on the same counter;
 *   - PUBLIC ACTIONS ONLY: no card is read (the pull's hole cards are ignored);
 *   - the stored HUD '*' population rows (about 99.5% Horse play) are never read: the hand history is.
 * k = q(1 - q) / tau^2 - 1 (method of moments over people with at least 5 answers, each person's folds against what
 * people's cells predict for his own mix of game, street and size): the weight of people's rate against his record.
 *
 * Run from server/ (pull = scripts/ops/omaha-facing-bet-range-fit.mjs `pull` output, compact rows):
 *   npx tsx scripts/omaha-river-call-record-people-fit.ts <out.data.ts> <horses.json> <pullDir>
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Act = [
  number,
  string,
  string,
  number | null,
  boolean | null,
  number | null,
  number | null,
  string | null,
];
type Row = {
  id: string;
  created_at: string;
  gv: string;
  cc: string[] | null;
  cc2: unknown;
  rit: unknown;
  bomb: boolean | null;
  pl: [number, string][];
  ac: Act[];
};
type Cell = { folds: number; opps: number };
type Size = 'small' | 'big';
type Street = 'turn' | 'river';
type Game = 'plo4' | 'plo5';

/** An answer counts only when the responder is a person (not on the Horse profile list). */
export function isPersonAnswer(horses: ReadonlySet<string>, responder: string): boolean {
  return !horses.has(responder);
}

const FORCED = new Set([
  'sb',
  'bb',
  'ante',
  'post',
  'post_sb',
  'post_bb',
  'blind',
  'small_blind',
  'big_blind',
  'straddle',
  'bomb_ante',
  'return',
]);
const WAGER = new Set(['bet', 'raise', 'all_in', 'allin']);
const ANSWER = new Set(['fold', 'call', 'raise', 'all_in', 'allin']);

function main(): void {
  const [out, horsesFile, dir] = process.argv.slice(2);
  if (!out || !horsesFile || !dir) throw new Error('usage: <out.data.ts> <horses.json> <pullDir>');
  const HORSES = new Set<string>(
    (JSON.parse(readFileSync(horsesFile, 'utf8')) as { id: string }[]).map((r) => r.id)
  );
  const cell = (): Cell => ({ folds: 0, opps: 0 });
  const T: Record<Game, Record<Street, Record<Size, Cell>>> = {
    plo4: { turn: { small: cell(), big: cell() }, river: { small: cell(), big: cell() } },
    plo5: { turn: { small: cell(), big: cell() }, river: { small: cell(), big: cell() } },
  };
  const per = new Map<string, { game: Game; street: Street; size: Size; fold: boolean }[]>();
  let hands = 0;
  let from = '';
  let to = '';
  const seen = new Set<string>();
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    const rows = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Row[];
    if (!Array.isArray(rows)) continue;
    for (const h of rows) {
      if (!h || seen.has(h.id)) continue;
      seen.add(h.id);
      const game = String(h.gv).toLowerCase();
      if (game !== 'plo4' && game !== 'plo5') continue;
      if (h.bomb === true || h.cc2 || (Array.isArray(h.rit) && h.rit.length)) continue;
      if ((h.cc ?? []).length < 4) continue;
      if ((h.ac ?? []).some((a) => String(a[2]).startsWith('rit_board'))) continue;
      hands++;
      const t = String(h.created_at);
      if (!from || t < from) from = t;
      if (!to || t > to) to = t;
      const uidOf = new Map(h.pl.map((p) => [Number(p[0]), p[1]]));
      const uid = (a: Act) => a[7] ?? uidOf.get(Number(a[0])) ?? '';
      const folded = new Set<string>();
      let street = '';
      let wagerSeen = false;
      let wager: { bettor: string; size: Size } | null = null;
      let answered = false;
      for (const a of h.ac) {
        const st = String(a[1]);
        const act = String(a[2]).toLowerCase();
        if (st !== street) {
          street = st;
          wagerSeen = false;
          wager = null;
          answered = false;
        }
        if (FORCED.has(act)) continue;
        const u = uid(a);
        if (st === 'turn' || st === 'river') {
          if (!wagerSeen && WAGER.has(act) && Number(a[3] ?? 0) > 0) {
            wagerSeen = true;
            const live = h.pl.filter((p) => !folded.has(p[1])).length;
            const pot = Number(a[5]);
            const amt = Number(a[3] ?? 0);
            const allIn = act === 'all_in' || act === 'allin';
            if (live === 2 && Number.isFinite(pot) && pot > 0)
              wager = { bettor: u, size: allIn || amt / pot > 0.7 ? 'big' : 'small' };
          } else if (wager && !answered && u !== wager.bettor && ANSWER.has(act)) {
            answered = true;
            if (isPersonAnswer(HORSES, u)) {
              const c = T[game][st][wager.size];
              c.opps++;
              if (act === 'fold') c.folds++;
              const list = per.get(u) ?? [];
              list.push({ game, street: st, size: wager.size, fold: act === 'fold' });
              per.set(u, list);
            }
          }
        }
        if (act === 'fold') folded.add(u);
      }
    }
  }
  const rate = (g: Game, s: Street, z: Size) => {
    const c = T[g][s][z];
    return c.opps > 0 ? c.folds / c.opps : 0.5;
  };
  let O = 0;
  let E = 0;
  const players: { o: number; f: number; e: number }[] = [];
  for (const list of per.values()) {
    if (list.length < 5) continue;
    let f = 0;
    let e = 0;
    for (const x of list) {
      f += x.fold ? 1 : 0;
      e += rate(x.game, x.street, x.size);
    }
    players.push({ o: list.length, f, e });
    O += list.length;
    E += e;
  }
  const q = E / O;
  let num = 0;
  let noise = 0;
  for (const x of players) {
    const r = x.f / x.o;
    const m = x.e / x.o;
    num += x.o * (r - m) ** 2;
    noise += m * (1 - m);
  }
  const tau2 = (num - noise) / (O - players.reduce((a, x) => a + x.o * x.o, 0) / O);
  const k = tau2 > 0 ? (q * (1 - q)) / tau2 - 1 : NaN;
  if (!(k > 0)) throw new Error(`no between-player spread: tau2 ${tau2}`);
  const fmt = (c: Cell) => `{ folds: ${c.folds}, opps: ${c.opps} }`;
  const g = (x: Game) => `  ${x}: Object.freeze({
    turn: Object.freeze({ small: ${fmt(T[x].turn.small)}, big: ${fmt(T[x].turn.big)} }),
    river: Object.freeze({ small: ${fmt(T[x].river.small)}, big: ${fmt(T[x].river.big)} }),
  }),`;
  const body = `/**
 * GENERATED by server/scripts/omaha-river-call-record-people-fit.ts: do not edit by hand.
 * PEOPLE's first answer to a heads-up PLO4/PLO5 cash turn / river FIRST wager (OPPONENT-HUD's x.foldToBet cells:
 * 'small' = at most 0.7 pot, 'big' = above it or all-in), responders who are people only (profiles.is_horse), public
 * actions only, the stored HUD '*' rows not read. ${hands} PLO4/PLO5 hands with a turn, ${from} to ${to}.
 * k: method of moments over ${players.length} people with at least 5 answers (${O} answers), each against his own mix.
 */
export const OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU = Object.freeze({
${g('plo4')}
${g('plo5')}
});
export const OMAHA_PEOPLE_FIRST_WAGER_FOLD_PRIOR_OPPS = ${Math.round(k * 10) / 10};
`;
  writeFileSync(out, body);
  console.log(
    JSON.stringify({ hands, from, to, T, players: players.length, answers: O, q, tau2, k })
  );
}
main();
