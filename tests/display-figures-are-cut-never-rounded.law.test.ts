/**
 * A FIGURE ON SCREEN IS CUT, NEVER ROUNDED (Dan 2026-11-27 and 2026-09-04,
 * binding). Verbatim: "NUMERS AFTER A DECIMAL NEED TO STOP AFTER 2 DIGITS ANY
 * WHERE AND EVERYWHERE" and "ABSOLUTELY ZERO ROUNDING ANYWHERE EVER".
 *
 * figures-stop-at-two-decimals pinned the shared chip formatters and the bare
 * Number#toLocaleString() default. This pins the rest of the way a number
 * reached the screen rounded: its own `new Intl.NumberFormat`, a `toFixed`
 * beside a display unit, `Math.round(x * 10) / 10` in text, an explicit
 * `toLocaleString({ maximumFractionDigits: 2 })`, and the money helpers in
 * src/lib/utils.ts. Each one now goes through cutFixed, cutTo or
 * cutNumberFormat in src/utils/format.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cutFixed,
  cutNumberFormat,
  cutTo,
  formatBigBlinds,
  formatStackChips,
  formatTableChips,
  pct,
} from '../src/utils/format';
import {
  formatChips as libFormatChips,
  formatChipsWhole,
  formatCurrency,
  formatPercent,
} from '../src/lib/utils';
import { installTwoDecimalDisplay } from '../src/utils/twoDecimalDisplay';

const ROOT = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const SRC = sourceFiles(join(ROOT, 'src')).map((file) => ({
  file: relative(ROOT, file),
  text: readFileSync(file, 'utf8'),
}));

/** Comments blanked (line breaks kept), so prose about toFixed is not code. */
const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/\/\/[^\n]*/g, '');

/**
 * Files whose toFixed beside a unit is not on screen, each with its reason.
 * src/config/spinSpec.ts: the text is a thrown developer invariant about the
 * rake table, never shown to a player, and the file is mirrored byte for byte
 * into server/src/config/spinSpec.ts (tests/config/spinSpec.test.ts), which
 * cannot import the client formatters.
 */
const NOT_ON_SCREEN = new Set([join('src', 'config', 'spinSpec.ts')]);

describe('the cutting helpers', () => {
  it('cutFixed cuts by digits and keeps the toFixed shape', () => {
    expect(cutFixed(0.999, 2)).toBe('0.99');
    expect(cutFixed(1.005, 2)).toBe('1.00');
    expect(cutFixed(25.67, 1)).toBe('25.6');
    expect(cutFixed(5, 2)).toBe('5.00');
    expect(cutFixed(1234.567, 2)).toBe('1234.56');
    expect(cutFixed(-12.349, 2)).toBe('-12.34');
    expect(cutFixed(Number.NaN, 1)).toBe('0.0');
  });

  it('never prints a negative zero', () => {
    expect(cutFixed(-0.004, 2)).toBe('0.00');
    expect(cutFixed(-0.04, 1)).toBe('0.0');
    expect(Object.is(cutTo(-0.04, 1), 0)).toBe(true);
    expect(cutNumberFormat('en-US', { maximumFractionDigits: 2 }).format(-0.004)).toBe('0');
  });

  it('reads float noise as the figure it is, not as a lost digit', () => {
    expect(cutFixed(0.29 * 100, 1)).toBe('29.0');
    expect(cutFixed(1.15 * 100, 2)).toBe('115.00');
    expect(cutTo(0.57 * 100, 1)).toBe(57);
  });

  it('never shows more than two decimals', () => {
    expect(cutFixed(1.23456, 4)).toBe('1.23');
    expect(cutNumberFormat('en-US', { maximumFractionDigits: 4 }).format(1.23456)).toBe('1.23');
  });

  it('cutNumberFormat keeps separators and minimum places, and cuts', () => {
    const two = cutNumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(two.format(1999.999)).toBe('1,999.99');
    expect(two.format(5)).toBe('5.00');
    expect(cutNumberFormat('en-US').format(1234.5678)).toBe('1,234.56');
    expect(cutNumberFormat('en-US', { maximumFractionDigits: 0 }).format(2.99)).toBe('2');
    expect(cutNumberFormat('en-US', { style: 'percent' }).format(0.2567)).toBe('25%');
    expect(cutNumberFormat('en-US', { notation: 'compact' }).format(1999)).toBe('1.9K');
  });
});

describe('the shared formatters cut', () => {
  it('stacks, table chips, big blinds and percentages', () => {
    expect(formatStackChips(99.999)).toBe('99.99');
    expect(formatStackChips(-0.004)).toBe('0.00');
    expect(formatStackChips(150.9)).toBe('150');
    expect(formatTableChips(0.999)).toBe('0.99');
    expect(formatTableChips(1.999)).toBe('1.99');
    expect(formatTableChips(-0.004)).toBe('0.00');
    expect(formatBigBlinds(37.59, 1)).toBe('37.5 BB');
    expect(formatBigBlinds(50, 1)).toBe('50 BB');
    expect(formatBigBlinds(1250.9, 1)).toBe('1,250 BB');
    expect(pct(0.2567)).toBe('25.6%');
    expect(pct(0.29)).toBe('29.0%');
  });

  it('the src/lib/utils.ts money helpers', () => {
    expect(libFormatChips(0.999)).toBe('0.99');
    expect(libFormatChips(455123)).toBe('455,123.00');
    expect(formatCurrency(1.005)).toBe('1.00');
    expect(formatCurrency(2183.7)).toBe('2,183.70');
    expect(formatChipsWhole(12.349)).toBe('12.34');
    expect(formatChipsWhole(700)).toBe('700');
    expect(formatPercent(33.36)).toBe('33.3%');
  });

  it('the browser default cuts even when a call names its own places', () => {
    installTwoDecimalDisplay();
    expect((0.999).toLocaleString('en-US', { maximumFractionDigits: 2 })).toBe('0.99');
    expect((2.7).toLocaleString('en-US', { maximumFractionDigits: 0 })).toBe('2');
    expect((0.29 * 100).toLocaleString('en-US', { maximumFractionDigits: 0 })).toBe('29');
    expect(
      (1.005).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    ).toBe('1.00');
  });
});

describe('no figure reaches the screen through a rounding formatter', () => {
  it('every Intl.NumberFormat is built by cutNumberFormat', () => {
    // The one constructor is the helper itself, and it always passes
    // roundingMode 'trunc' after cutting the value by its digits.
    const offenders = SRC.filter(
      ({ file, text }) =>
        file !== join('src', 'utils', 'format.ts') &&
        /new\s+Intl\.NumberFormat\s*\(/.test(code(text))
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
    const helper = readFileSync(join(ROOT, 'src/utils/format.ts'), 'utf8');
    const ctor = /new Intl\.NumberFormat\(locales, shaped/.exec(helper);
    expect(ctor).not.toBeNull();
    expect(helper).toMatch(/roundingMode: 'trunc'/);
  });

  it('no toFixed prints a figure beside a display unit', () => {
    // A toFixed directly followed by a unit a player reads (%, x, BB, Min,
    // Days, Chips, USD, h) is an on-screen figure. Payloads, CSV cells, CSS
    // and SVG geometry carry no such unit and are not matched.
    const unit = /\.toFixed\(\s*[12]\s*\)\)?\}?\)?(%|x\b|×| BB| Min| Days| Chips| USD|h\b)/;
    const offenders: string[] = [];
    for (const { file, text } of SRC) {
      if (NOT_ON_SCREEN.has(file)) continue;
      code(text)
        .split('\n')
        .forEach((line, i) => {
          if (unit.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('no display text interpolates Math.round(x * 10) / 10', () => {
    const offenders = SRC.filter(({ text }) =>
      /\$\{\s*Math\.round\([^`]*\*\s*10\)\s*\/\s*10\s*\}/.test(code(text))
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('the src/lib/utils.ts money helpers never round', () => {
    const lib = code(readFileSync(join(ROOT, 'src/lib/utils.ts'), 'utf8'));
    const money = lib.slice(
      lib.indexOf('export function formatCurrency'),
      lib.indexOf('export { formatRelative')
    );
    expect(money).not.toMatch(/\.toFixed\(|\.toLocaleString\(|Math\.round|new Intl\.NumberFormat/);
    expect(money).toMatch(/cutNumberFormat\(/);
  });
});
