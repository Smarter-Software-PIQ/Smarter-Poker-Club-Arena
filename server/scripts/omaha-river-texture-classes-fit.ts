/**
 * Fits HorseOmahaRiverTextureClasses.data.ts (omahaRiverBettorRangeIsTextureMeasured) from the rows of
 * omaha-river-texture-classes-export.sql (PLO4/PLO5 cash hands with a person and a showdown; one json file per
 * six-hour window, each an array of the `hand` objects). PEOPLE ONLY: a bet counts when the bettor is a person
 * (is_horse false) and his cards were shown at showdown (mucked = false); Horse bets, mucked cards, folded cards
 * and the HUD '*' population rows never enter. Heads-up at the bet (two players live).
 *
 *   npx tsx scripts/omaha-river-texture-classes-fit.ts <pull dir> [--write]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Card } from '../src/types.js';
import { scoreOmahaHiPartial } from '../src/engine/HorseEval.js';
import { omahaBetReadCard } from '../src/engine/HorseOmahaBetRead.js';
import { omahaBetSizeBucket, omahaRiverBoardBands } from '../src/engine/HorseOmahaFacingBetEv.js';
import {
  omahaRiverTextureClassOf,
  omahaRiverTextureCuts,
  omahaRiverTextureOf,
} from '../src/engine/HorseOmahaRiverTextureClasses.js';

const dir = process.argv[2];
const write = process.argv.includes('--write');
const TEX = ['flushPaired', 'paired', 'flushEarly', 'flushRiver', 'plain'] as const;
const BUCKETS = ['mid', 'big', 'raise'] as const;
const count: Record<string, number[]> = {};
const add = (k: string, c: number): void => {
  (count[k] ??= [0, 0, 0, 0, 0])[c]++;
};
let hands = 0;
let bets = 0;
let from = '';
let to = '';
for (const f of readdirSync(dir)
  .filter((x) => x.endsWith('.json'))
  .sort()) {
  const rows = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Array<Record<string, unknown>>;
  for (const h of rows) {
    hands++;
    const t = String(h.t);
    if (!from || t < from) from = t;
    if (!to || t > to) to = t;
    const board = ((h.cc as unknown[]) ?? []).map(omahaBetReadCard);
    if (board.length !== 5 || board.some((c) => !c)) continue;
    const pl = (h.pl as Array<[number, string, boolean]>) ?? [];
    const person = new Map(pl.map((p) => [p[0], p[2] !== true]));
    const uid = new Map(pl.map((p) => [p[0], p[1]]));
    const shown = (h.hc as Record<string, unknown[]>) ?? {};
    const texture = omahaRiverTextureOf(board as Card[]);
    if (!texture) continue;
    let level = 0;
    let n = 0;
    const com = new Map<number, number>();
    for (const a of (h.ac as unknown[][]) ?? []) {
      const [seat, stage, act, amt0, , origin, pot, , seats] = a as [
        number,
        string,
        string,
        number,
        unknown,
        string,
        number | null,
        number | null,
        number[][] | null,
      ];
      if (stage !== 'river') continue;
      const amt = Number(amt0 ?? 0);
      const c = com.get(seat) ?? 0;
      if (act === 'call') com.set(seat, c + amt);
      else if (act === 'bet' || act === 'raise' || act === 'all_in') {
        if (amt > level + 1e-9) {
          n++;
          const live = Array.isArray(seats) ? seats.filter((s) => !(Number(s[6]) & 1)).length : 0;
          const cards = (shown[uid.get(seat) ?? ''] ?? []).map(omahaBetReadCard);
          if (
            person.get(seat) === true &&
            origin !== 'horse_policy' &&
            live === 2 &&
            pot !== null &&
            Number(pot) > 0 &&
            (cards.length === 4 || cards.length === 5) &&
            cards.every(Boolean)
          ) {
            const frac = (amt - c) / Number(pot);
            const size = omahaBetSizeBucket(frac);
            const bucket =
              n >= 2 ? 'raise' : size === 'under40' ? null : size === 'mid' ? 'mid' : 'big';
            const bands = omahaRiverBoardBands(board as Card[], cards.length, (best) =>
              omahaRiverTextureCuts(texture, best)
            );
            if (bucket && bands) {
              const cls = omahaRiverTextureClassOf(
                scoreOmahaHiPartial(cards as Card[], board as Card[]),
                bands.cuts
              );
              add(`${texture}|${bucket}`, cls);
              add(`pooled|${bucket}`, cls);
              bets++;
            }
          }
          level = amt;
        }
        com.set(seat, Math.max(c, amt));
      }
    }
  }
}
const cellOf = (k: string): { n: number; w: number[] } => {
  const c = count[k] ?? [0, 0, 0, 0, 0];
  const n = c.reduce((x, y) => x + y, 0);
  return { n, w: n > 0 ? c.map((x) => Math.round((x / n) * 1000) / 1000) : [0, 0, 0, 0, 0] };
};
const data = {
  source: 'people-only',
  filters: {
    bettor: 'profiles.is_horse = false and origin <> horse_policy',
    cards: 'shown at showdown by the bettor (mucked = false)',
    field: 'two players live at the bet',
    hudPopulationRows: 'not read',
  },
  window: { from, to },
  hands,
  bets,
  classes: [
    'A top of the key category and above',
    'B key category below that',
    'C the two categories under it',
    'D the category under those',
    'E weaker',
  ],
  pooled: Object.fromEntries(BUCKETS.map((b) => [b, cellOf(`pooled|${b}`)])),
  cells: Object.fromEntries(
    TEX.map((t) => [t, Object.fromEntries(BUCKETS.map((b) => [b, cellOf(`${t}|${b}`)]))])
  ),
};
const text = `/**
 * GENERATED by server/scripts/omaha-river-texture-classes-fit.ts from omaha-river-texture-classes-export.sql
 * (PLO4/PLO5 cash, people only: the bettor is a person, his cards were shown at showdown, heads-up at the bet; no
 * Horse bet, no mucked or folded card, no HUD population row). Do not edit by hand: re-run the fit. Read by
 * HorseOmahaRiverTextureClasses.ts.
 */
export const OMAHA_RIVER_TEXTURE_CLASSES_DATA = ${JSON.stringify(data, null, 2)} as const;
`;
if (write) writeFileSync(resolve('src/engine/HorseOmahaRiverTextureClasses.data.ts'), text);
console.log(JSON.stringify(data, null, 1));
