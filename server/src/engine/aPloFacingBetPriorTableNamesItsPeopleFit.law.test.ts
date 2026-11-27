/**
 * LAW: EVERY PLO FACING-BET BLUFF / FOLD PRIOR TABLE NAMES ITS FIT, AND A FITTED ONE IS FITTED ON PEOPLE
 * (2026-11-26, PLO-OWNER lead-7, lane HARDEN).
 *
 * The Horses' PLO4/PLO5 over-folding was "fixed" and came back several times. Two of the causes were tables:
 * fixes were layered on a verdict whose bluff prior (OMAHA_EV_PRIOR_BLUFF) was a constant fitted on 41-179 hands,
 * and some re-fits used the Horse field, which never bluffs (owner order 2026-11-26: "The stats need to be used
 * against human players, not horses"). This law makes a table that cannot say where it came from fail CI:
 *
 *  1. every constant TABLE (an object literal) whose name says BLUFF, FOLD or PRIOR in the PLO facing-bet path
 *     (HorseOmahaFacingBetEv.ts and any HorseOmahaFacingBetPeoplePrior*.ts) has a doc comment directly above it
 *     that names its fit: what it is (measured / fitted / generated / sweep / solved / equilibrium / balanced) and
 *     where (a date, an archive, or a file);
 *  2. a FITTED population table (its comment says measured, fitted, generated, sweep or population) names its
 *     generator, a file in this repository, and at least one named generator filters to people (a profile Horse
 *     flag compared to false in code or SQL). The one table fitted before generators lived in the repository
 *     (OMAHA_EV_PRIOR_BLUFF, archive full-sweep-20261115, bettor a person) is pinned by name below and must keep
 *     saying its bettor was a person; the pin list may only shrink.
 * Cheap: it reads a handful of source files, no engine import.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE = __dirname;
const REPO = join(ENGINE, '..', '..', '..');
const PATH_FILE = /^HorseOmahaFacingBet(Ev|PeoplePrior[\w.]*)\.ts$/;
const TABLE_NAME = /BLUFF|FOLD|PRIOR/;
const NAMES_A_FIT = /\b(measured|fitted|fit|generated|sweep|solved|equilibrium|balanced)\b/i;
const NAMES_A_SOURCE = /\d{4}-\d{2}-\d{2}|\barchive\b|[\w./-]+\.(ts|sql|mjs|json)\b/i;
const IS_FITTED = /\b(measured|fitted|generated|sweep|population)\b/i;
const FILE_REF = /[\w./-]+\.(?:ts|sql|mjs)\b/g;
/** A people-only filter in a generator: the profile Horse flag compared to false (code or SQL). */
const PEOPLE_FILTER = [
  /is_horse(?:\s*,\s*true\))?\s*=\s*false/i,
  /\bis_horse\s+is\s+not\s+true/i,
  /isHorse\s*===\s*false/,
];
/** Fitted before generators lived in the repository; may only shrink. Each must state its bettor was a person. */
const ARCHIVED_FITS: Readonly<Record<string, RegExp>> = {
  OMAHA_EV_PRIOR_BLUFF: /facing a person's bet/,
};

export interface PriorTable {
  file: string;
  name: string;
  comment: string;
}

/** The constant tables (object literals) named BLUFF / FOLD / PRIOR in one source file, with their doc comment. */
export function priorTablesOf(file: string, src: string): PriorTable[] {
  const out: PriorTable[] = [];
  const re = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\b/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const name = m[1]!;
    if (!TABLE_NAME.test(name)) continue;
    // the initializer: the first '=' at type depth 0 that is not part of '=>'
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '<') depth++;
      else if (ch === '>' && src[i - 1] !== '=') depth--;
      else if (ch === '=' && depth <= 0 && src[i + 1] !== '>' && src[i + 1] !== '=') break;
      else if (ch === ';') break;
    }
    if (src[i] !== '=') continue;
    if (!/^\s*(?:Object\.freeze\(\s*)?\{/.test(src.slice(i + 1, i + 40))) continue;
    const before = src.slice(0, m.index).trimEnd();
    const comment = before.endsWith('*/') ? before.slice(before.lastIndexOf('/**')) : '';
    out.push({ file, name, comment });
  }
  return out;
}

/** Where a file a comment names is looked for (repo root, server/, the server scripts, the ops scripts, here). */
function resolveRef(ref: string): string | null {
  for (const base of [
    REPO,
    join(REPO, 'server'),
    join(REPO, 'server', 'scripts'),
    join(REPO, 'scripts', 'ops'),
    ENGINE,
  ]) {
    const p = join(base, ref);
    if (existsSync(p)) return p;
  }
  return null;
}

/** What is wrong with one table (empty = it obeys the law). */
export function priorTableProblems(
  t: PriorTable,
  read: (ref: string) => string | null = (ref) => {
    const p = resolveRef(ref);
    return p ? readFileSync(p, 'utf8') : null;
  }
): string[] {
  const where = `${t.file} ${t.name}`;
  if (!t.comment) return [`${where}: no doc comment directly above the table naming its fit`];
  const out: string[] = [];
  if (!NAMES_A_FIT.test(t.comment) || !NAMES_A_SOURCE.test(t.comment))
    out.push(
      `${where}: its comment must say what the fit is (measured/fitted/generated/solved/...) and where (a date, archive or file)`
    );
  if (IS_FITTED.test(t.comment)) {
    const pin = ARCHIVED_FITS[t.name];
    if (pin) {
      if (!pin.test(t.comment))
        out.push(`${where}: an archived fit must keep stating its bettor was a person`);
      return out;
    }
    const own = t.file.split('/').at(-1)!;
    const refs = [...new Set(t.comment.match(FILE_REF) ?? [])].filter(
      (r) => !r.endsWith(own) && !r.endsWith('.data.ts')
    );
    const texts = refs.map((r) => read(r)).filter((x): x is string => typeof x === 'string');
    if (!texts.length)
      out.push(
        `${where}: a fitted population table must name its generator (a file in this repository) in its comment`
      );
    else if (!texts.some((x) => PEOPLE_FILTER.some((re) => re.test(x))))
      out.push(
        `${where}: its generator (${refs.join(', ')}) has no people-only filter (profile Horse flag compared to false)`
      );
  }
  return out;
}

function pathFiles(): { file: string; src: string }[] {
  return readdirSync(ENGINE)
    .filter((f) => PATH_FILE.test(f) && !/\.test(-support)?\./.test(f))
    .map((f) => ({ file: `server/src/engine/${f}`, src: readFileSync(join(ENGINE, f), 'utf8') }));
}

describe('LAW: every PLO facing-bet bluff/fold prior table names its fit, and a fitted one is fitted on people', () => {
  const tables = pathFiles().flatMap((f) => priorTablesOf(f.file, f.src));

  it('finds the tables of the path (OMAHA_EV_PRIOR_BLUFF among them), so the law is not vacuous', () => {
    expect(tables.map((t) => t.name)).toContain('OMAHA_EV_PRIOR_BLUFF');
  });

  it('every table obeys', () => {
    expect(tables.flatMap((t) => priorTableProblems(t))).toEqual([]);
  });

  it('every archived pin still names a table that exists (the list may only shrink)', () => {
    for (const name of Object.keys(ARCHIVED_FITS))
      expect(tables.map((t) => t.name)).toContain(name);
    expect(Object.keys(ARCHIVED_FITS).length).toBeLessThanOrEqual(1);
  });

  describe('a new table without both fails', () => {
    const F = 'server/src/engine/HorseOmahaFacingBetPeoplePriorNext.ts';
    const tableOf = (src: string) => priorTablesOf(F, src)[0]!;
    it('no comment', () => {
      const t = tableOf(`export const OMAHA_NEXT_FOLD_PRIOR = { river: 0.3 };`);
      expect(priorTableProblems(t)).toHaveLength(1);
    });
    it('a comment that names no fit', () => {
      const t = tableOf(
        `/** Shares by street. */\nexport const OMAHA_NEXT_BLUFF: Record<string, number> = { river: 0.3 };`
      );
      expect(priorTableProblems(t)[0]).toMatch(/what the fit is/);
    });
    it('a fitted table with no generator, and one whose generator does not filter to people', () => {
      const t = tableOf(
        `/** Measured 2026-11-26 on the population. */\nexport const OMAHA_NEXT_BLUFF = Object.freeze({ river: 0.3 });`
      );
      expect(priorTableProblems(t, () => null)[0]).toMatch(/name its generator/);
      const g = tableOf(
        `/** GENERATED 2026-11-26 by server/scripts/next-fit.ts. */\nexport const OMAHA_NEXT_BLUFF = { river: 0.3 };`
      );
      expect(priorTableProblems(g, () => 'rows.filter((p) => p.seat > 0)')[0]).toMatch(
        /no people-only filter/
      );
      expect(priorTableProblems(g, () => 'rows.filter((p) => p.isHorse === false)')).toEqual([]);
      expect(priorTableProblems(g, () => 'where coalesce(p.is_horse, true) = false')).toEqual([]);
    });
    it('an equilibrium anchor names its anchor and needs no generator; a scalar is not a table', () => {
      const t = tableOf(
        `/** Balanced share bet / (pot + 2 bet), solved 2026-11-26. */\nexport const OMAHA_NEXT_PRIOR = { river: 0.25 };`
      );
      expect(priorTableProblems(t)).toEqual([]);
      expect(priorTablesOf(F, 'export const OMAHA_NEXT_PRIOR_MIN = 0.02;')).toEqual([]);
    });
  });
});
