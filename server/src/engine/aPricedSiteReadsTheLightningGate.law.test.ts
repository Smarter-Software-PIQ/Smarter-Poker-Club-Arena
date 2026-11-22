/**
 * A PRICED SITE READS THE LIGHTNING GATE (AUDIT-02, 2026-11-19).
 *
 * omahaPricedInScope(player, gs, opts) admits a Lightning pool only when the decision's own options carry
 * omahaPricedInLightning === true. Four priced sites called it without the options, so with
 * omahaPricedInLightning on they still never acted in Lightning: HorseOmahaCheckedToBet (omahaCheckedToBetScope),
 * HorseOmahaFlopBetMeasuredFoldShare, HorseOmahaFlopBetRaiseBranch and HorseOmahaFoldModelFittedOnPeople. Every
 * call now passes the options; off (omahaPricedInLightning unset or false) the scope is exactly as before.
 *
 * Law 1 (source): every runtime call of omahaPricedInScope passes a third argument.
 * Law 2 (behaviour): the checked-to-bet scope opens in Lightning only with omahaPricedInLightning on, and a table
 * spot is the same with and without it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { SeatPlayer } from '../types.js';
import { omahaCheckedToBetScope } from './HorseOmahaCheckedToBet.js';
import RECORDED from './HorseOmahaCheckedToBet.fixture.json';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The argument text of every `omahaPricedInScope(` call in `src` (balanced parentheses; the definition excluded). */
function callsIn(src: string): string[] {
  const out: string[] = [];
  const re = /(?<!function )\bomahaPricedInScope\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}
/** Top-level comma count of an argument list. */
function argCount(args: string): number {
  let depth = 0;
  let n = args.trim() === '' ? 0 : 1;
  for (const c of args) {
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) n++;
  }
  return args.trim().endsWith(',') ? n - 1 : n;
}

describe('a priced site reads the Lightning gate', () => {
  it('every runtime call of omahaPricedInScope passes the decision options', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const f of readdirSync(HERE)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f.includes('test-support')) continue;
      for (const args of callsIn(readFileSync(join(HERE, f), 'utf8'))) {
        if (/^\s*player: SeatPlayer/.test(args)) continue; // the definition's parameter list
        seen++;
        if (argCount(args) < 3)
          offenders.push(`${f}: omahaPricedInScope(${args.replace(/\s+/g, ' ')})`);
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  interface Spot {
    set: string;
    hero: SeatPlayer;
    gs: HorseGameStateV2;
  }
  const SPOT = (RECORDED as unknown as { spots: Spot[] }).spots.filter(
    (s) => s.set === 'river_hu_checkback_air_weak'
  )[1];
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const lightning = (s: Spot): Spot => {
    const c = copy(s);
    (c.gs as { publicMemoryDomain?: unknown }).publicMemoryDomain = { speed: 'lightning' };
    return c;
  };
  it('the checked-to-bet scope opens in Lightning only with omahaPricedInLightning on; a table spot is unchanged', () => {
    const table = copy(SPOT);
    const fast = lightning(SPOT);
    const atTable = omahaCheckedToBetScope(table.hero, table.gs);
    expect(atTable).not.toBeNull();
    expect(omahaCheckedToBetScope(table.hero, table.gs, { omahaPricedInLightning: true })).toEqual(
      atTable
    );
    expect(omahaCheckedToBetScope(table.hero, table.gs, { omahaPricedInLightning: false })).toEqual(
      atTable
    );
    expect(omahaCheckedToBetScope(fast.hero, fast.gs)).toBeNull();
    expect(
      omahaCheckedToBetScope(fast.hero, fast.gs, { omahaPricedInLightning: false })
    ).toBeNull();
    expect(omahaCheckedToBetScope(fast.hero, fast.gs, { omahaPricedInLightning: true })).toEqual(
      atTable
    );
  });
});
