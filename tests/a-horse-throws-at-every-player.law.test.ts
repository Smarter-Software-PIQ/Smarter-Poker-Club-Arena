/**
 * A HORSE THROWS AT EVERY PLAYER, NOT ONLY HUMANS
 *
 * Dan, 2026-11-12, verbatim: "MAKE SURE THE 'THROWABLES' AREN'T ONLY TARGETING
 * HUMANS, ITS SHOULD BE TARGETING ANY AND ALL PLAYERS AT THE TABLE" and "THE
 * THROWABLES THROWN BY HORSES". CLAUDE.md 10.5: horses are players.
 *
 * WHY. detectAfterHand's annoy needle picked its target from
 * `input.seated.filter((s) => !s.isHorse)`, so a horse never threw at another
 * horse and a horses-only table never saw a throw at all. The empty-rail cost
 * it was guarding is already refused by hasAudience(), which counts watchers,
 * not seat types.
 *
 * WHAT THIS REFUSES. In HorseTableGestures.ts, horse identity may be read only
 * to find the THROWER (the horse's input device). No target selection may
 * exclude a seat because it is, or is not, a horse: no `!s.isHorse`,
 * `isHorse === false`, `!p.is_horse`, `is_horse: false` filter, and no
 * `humans` target pool.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'server', 'src', 'services', 'HorseTableGestures.ts');

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

describe('a horse throws at every player, not only humans (Dan 2026-11-12)', () => {
  const code = codeOnly(readFileSync(SRC, 'utf8'));

  it('no throw target is chosen by excluding horses or keeping only humans', () => {
    expect(code).not.toMatch(/!\s*\w+\.isHorse/);
    expect(code).not.toMatch(/isHorse\s*===?\s*false/);
    expect(code).not.toMatch(/!\s*\w+\.is_horse/);
    expect(code).not.toMatch(/is_horse\s*===?\s*false/);
    expect(code).not.toMatch(/\bhumans\b/);
  });

  it('horse identity is read only to find the thrower', () => {
    const reads = code.match(/\bisHorse\b|\bis_horse\b/g) ?? [];
    // seatedHorse() (the showdown thrower) and the annoy thrower loop.
    expect(reads.length).toBeLessThanOrEqual(2);
  });
});
