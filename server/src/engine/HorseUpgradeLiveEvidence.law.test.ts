/**
 * LAW: EVERY ENABLED HORSE UPGRADE NAMES A COUNTER THE RUNNING ENGINE EMITS.
 *
 * On 2026-11-12 the activation manifest said the core and thirteen upgrades
 * were enabled and active, and for five of them (range posteriors, the public
 * timing hint, side games, the pre-action purge, a persona-mixed pick) nothing
 * the serving engine produced could show the path had ever run: the code was
 * wired and there was no counter on it. "Enabled" was a declaration.
 *
 * HORSE_UPGRADE_LIVE_EVIDENCE now names, per enabled upgrade, the counters on
 * its own path. This law keeps that list true: an enabled upgrade with no
 * counter fails, and so does a listed counter whose emitting line was deleted
 * or renamed. It reads source; it does not claim any counter fired in
 * production, and a counter is fleet evidence, never per-Horse evidence.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HORSE_UPGRADE_LIVE_EVIDENCE,
  computeHorseUpgradeActivationManifest,
  enabledHorseUpgradeIds,
} from './HorseUpgradeActivationManifest.js';

const SRC = join(process.cwd(), 'src');
const MANIFEST = 'engine/HorseUpgradeActivationManifest.ts';

/** Non-test engine source, with the manifest (which only lists the needles) left out. */
function emittingSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== 'node_modules' && name !== 'testing' && name !== 'benchmark') walk(full);
        continue;
      }
      const file = relative(SRC, full).split('\\').join('/');
      if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
      if (/\.test\.ts$|\.test-support\.ts$/.test(file) || file === MANIFEST) continue;
      out.push({ file, text: readFileSync(full, 'utf8') });
    }
  };
  walk(SRC);
  return out;
}

const EMITTERS = ['noteFire', 'noteFeature', 'recordWatchcounter', 'noteHorseTelemetryOpportunity'];

/**
 * A copy of `text` with every comment and every string interior blanked,
 * offsets kept, plus the offsets at which a string literal opens in code.
 * Quoted strings end at their line; a template ends at its closing backtick.
 */
function lex(text: string): { code: string; opens: Set<number> } {
  const out = text.split('');
  const opens = new Set<number>();
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (; i < stop; i++) if (text[i] !== '\n') out[i] = ' ';
    } else if (ch === "'" || ch === '"' || ch === '`') {
      opens.add(i);
      i++;
      while (i < text.length && text[i] !== ch) {
        if (ch !== '`' && text[i] === '\n') break;
        if (text[i] === '\\') out[i++] = ' ';
        if (i < text.length && text[i] !== '\n') out[i] = ' ';
        i++;
      }
      i++;
    } else i++;
  }
  return { code: out.join(''), opens };
}

/**
 * True when `needle` is a string literal of its own, written in code, inside
 * the argument list of a call that emits a counter. The callee is one of the
 * emitters, called bare or as `this.deps.<emitter>`. A registry row, an
 * object literal, a list, a comment of any shape, a string that only quotes
 * the call, or a like-named method on another object does not count.
 */
function emittedIn(text: string, needle: string): boolean {
  const { code, opens } = lex(text);
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    if (!opens.has(at)) continue;
    let depth = 0;
    for (let i = at - 1; i >= 0 && at - i < 600; i--) {
      const ch = code[i];
      if (ch === ')') depth++;
      else if (ch === '(') {
        if (depth > 0) {
          depth--;
          continue;
        }
        const head = code.slice(Math.max(0, i - 80), i);
        const callee = /([A-Za-z_]\w*)\s*$/.exec(head);
        // A bare grouping parenthesis has no callee: keep walking outward.
        if (!callee) continue;
        const receiver = head.slice(0, callee.index);
        const bare = !receiver.endsWith('.');
        if (EMITTERS.includes(callee[1]!) && (bare || receiver.endsWith('this.deps.'))) return true;
        break;
      } else if ((ch === '[' || ch === '{') && depth === 0) break;
    }
  }
  return false;
}

describe('LAW: an enabled Horse upgrade is provable from a live counter', () => {
  const sources = emittingSources();
  const enabled = enabledHorseUpgradeIds();

  it('reads the same enabled set the manifest serves', () => {
    const served = computeHorseUpgradeActivationManifest()
      .upgrades.filter((u) => u.enabled)
      .map((u) => u.id);
    expect([...enabled].sort()).toEqual([...served].sort());
    expect(enabled.length).toBeGreaterThanOrEqual(14);
  });

  it('lists evidence for every enabled upgrade and for nothing else', () => {
    expect(Object.keys(HORSE_UPGRADE_LIVE_EVIDENCE).sort()).toEqual([...enabled].sort());
    for (const id of enabled) expect(HORSE_UPGRADE_LIVE_EVIDENCE[id].length, id).toBeGreaterThan(0);
  });

  it.each(
    Object.entries(HORSE_UPGRADE_LIVE_EVIDENCE).flatMap(([id, needles]) =>
      needles.map((needle) => [id, needle] as const)
    )
  )('%s: %s is emitted by non-test engine source', (_id, needle) => {
    const emitters = sources.filter((s) => emittedIn(s.text, needle));
    expect(
      emitters.map((s) => s.file),
      `no emitting line found for ${needle}`
    ).not.toEqual([]);
  });

  it('accepts only a needle inside the arguments of an emitting call', () => {
    const n = "'upgrade99_probe'";
    expect(emittedIn(`if (on) noteFire(${n});`, n)).toBe(true);
    expect(emittedIn(`this.deps.noteFeature(a ? ${n} : 'other');`, n)).toBe(true);
    expect(emittedIn(`recordWatchcounter(\n    ${n},\n    labels\n  );`, n)).toBe(true);
    expect(emittedIn(`noteHorseTelemetryOpportunity(variant, 'cash', ${n});`, n)).toBe(true);
    // A registry row, an object literal, a list, a comment and a call that
    // does not emit are not evidence.
    expect(emittedIn(`  metric: ${n},`, n)).toBe(false);
    expect(emittedIn(`const x = { label: ${n} };`, n)).toBe(false);
    expect(emittedIn(`const keys = [${n}];`, n)).toBe(false);
    expect(emittedIn(`// noteFire(${n});`, n)).toBe(false);
    expect(emittedIn(`run(); /* noteFire(${n}); */`, n)).toBe(false);
    expect(emittedIn(`describeCounter(${n});`, n)).toBe(false);
    // A block comment without leading stars, a string that quotes the call,
    // and a like-named method on another object.
    expect(emittedIn(`/*\n  noteFire(${n});\n*/`, n)).toBe(false);
    expect(emittedIn(`const doc = "noteFire(${n})";`, n)).toBe(false);
    expect(emittedIn(`other.noteFire(${n});`, n)).toBe(false);
    expect(emittedIn(`logger.deps.noteFeature(${n});`, n)).toBe(false);
  });
});
