/**
 * A CHIP FORMATTER NEVER RECEIVES RAW CLIENT ARITHMETIC (Dan 2026-11-13).
 *
 * The chip formatters print the exact figure they are given, digit for digit,
 * and never guess that a trailing digit is noise. So `exactChips(0.1 + 0.2)`
 * prints 0.30000000000000004. Client arithmetic on chip figures therefore
 * applies the explicit chip rule first: sumChips for a sum, chipCents for any
 * other expression (or Math.trunc / Math.round for a whole figure). This law
 * finds a chip formatter whose figure argument holds a bare + - * / between
 * operands, outside those rules, array indexes and callbacks.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

/** The shared chip formatters. `fmt` in utils/format is the COUNT formatter and is not one. */
const CHIP_FORMATTERS = [
  'exactChips',
  'compactChips',
  'fmtChips',
  'formatWalletChips',
  'winLossChips',
  'feeFigure',
  'exactChipFigure',
  'formatChips',
  'formatSignedChips',
  'playerRecordMoney',
];

/** Calls whose argument is already put through an explicit precision rule. */
const RULED = /\b(chipCents|sumChips|Math\.(?:round|trunc|floor|ceil))\s*\(/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(path);
  }
  return out;
}

/** The text up to the bracket that closes the one opened just before `start`. */
function enclosed(text: string, start: number): string {
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    i++;
  }
  return text.slice(start, i - 1);
}

/** Replace each bracketed group opened by `opener` with a placeholder. */
function blank(text: string, opener: RegExp): string {
  for (let m = opener.exec(text); m; m = opener.exec(text)) {
    const open = m.index + m[0].length;
    const inner = enclosed(text, open);
    text = `${text.slice(0, m.index)}X${text.slice(open + inner.length + 1)}`;
  }
  return text;
}

/** The figure argument of a call, reduced to what decides its precision. */
function figureArgument(argument: string): string {
  let a = argument.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, 'S');
  a = blank(a, new RegExp(RULED.source));
  a = blank(a, /\[/); // an index, such as series[series.length - 1]
  a = blank(a, /=>\s*\{/); // a callback body
  a = a.replace(/=>[^,)]*/g, '=> X'); // a callback expression
  let depth = 0;
  let first = '';
  for (const c of a) {
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) break;
    first += c;
  }
  return first.replace(/\?\.|\?\?/g, ' ');
}

const RAW_ARITHMETIC = /[\w)\]]\s*[+*/]\s*[\w(.]|[\w)\]]\s*-\s*[\w(.]/;

export function rawArithmeticCalls(source: string): string[] {
  const local = [...source.matchAll(/const\s+(\w+)\s*=\s*(\w+)\s*;/g)]
    .filter(([, , target]) => CHIP_FORMATTERS.includes(target))
    .map(([, alias]) => alias);
  const names = [...CHIP_FORMATTERS, ...local];
  const call = new RegExp(`(?<![\\w.])(${names.join('|')})\\(`, 'g');
  const found: string[] = [];
  for (const m of source.matchAll(call)) {
    const argument = enclosed(source, m.index! + m[0].length);
    if (RAW_ARITHMETIC.test(figureArgument(argument))) {
      const line = source.slice(0, m.index).split('\n').length;
      found.push(`${line}: ${m[1]}(${argument.replace(/\s+/g, ' ').slice(0, 80)})`);
    }
  }
  return found;
}

describe('a chip formatter never receives raw client arithmetic', () => {
  it('recognizes raw arithmetic and the rules that make it exact', () => {
    expect(rawArithmeticCalls('exactChips(a + b)')).toHaveLength(1);
    expect(rawArithmeticCalls('formatWalletChips(total - spent)')).toHaveLength(1);
    expect(rawArithmeticCalls('const fmt = compactChips;\nfmt(stack * 2)')).toHaveLength(1);
    expect(rawArithmeticCalls('exactChips(sumChips([a, b]))')).toEqual([]);
    expect(rawArithmeticCalls('exactChips(chipCents(a - b))')).toEqual([]);
    expect(rawArithmeticCalls('feeFigure(rows[rows.length - 1].fee)')).toEqual([]);
    expect(rawArithmeticCalls('exactChips(row.amount_text ?? row.amount)')).toEqual([]);
    expect(rawArithmeticCalls('exactChips(-amount)')).toEqual([]);
    expect(rawArithmeticCalls('fmt(count - 1)')).toEqual([]);
  });

  it('no source file passes unruled arithmetic to a chip formatter', () => {
    const offenders: string[] = [];
    for (const file of sources(join(ROOT, 'src'))) {
      for (const hit of rawArithmeticCalls(readFileSync(file, 'utf8')))
        offenders.push(`${relative(ROOT, file)}:${hit}`);
    }
    expect(offenders).toEqual([]);
  });
});
