/**
 * LAW: the two withdrawn PLO6 rules stay off in production.
 *
 * #10628 (a deep Omaha seat's stack-off bar read without the VPIP floor) and
 * #10626 (an Omaha preflop call of 40% of the stack with action behind not
 * priced as a final all-in) were merged on a demonstrated mechanism and
 * switched to opt-in hours later because their value was never shown; the
 * value study since points against both (#10650, #10669). They remain in the
 * source as opt-in arms for measurement. This law fails if either option is
 * read so that absence turns it on, or if any production source sets it.
 * Re-enabling either one needs the evidence in
 * docs/HORSE-DECISION-CHANGE-EVIDENCE.md and the retirement of this law in
 * the same pull request (docs/LAWS.md rule 4).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WITHDRAWN = ['vpipFloorDeepStackOff', 'omahaPreflopCallWithActionBehind'] as const;

function productionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return productionSources(path);
    if (!/\.(ts|mts|js|mjs)$/.test(name)) return [];
    if (/\.test\.|\.test-support\.|\.law\.test\./.test(name)) return [];
    return [path];
  });
}

describe('the withdrawn PLO6 rules stay off', () => {
  const logic = readFileSync('src/engine/HorseLogic.ts', 'utf8');

  it.each(WITHDRAWN)('%s is read as `=== true`, never as `!== false`', (option) => {
    expect(logic).toContain(`opts.${option} === true`);
    expect(logic).not.toMatch(new RegExp(`${option}\\s*!==\\s*false`));
    expect(logic).not.toMatch(new RegExp(`${option}\\s*\\?\\?\\s*true`));
  });

  it.each(WITHDRAWN)('no production source sets %s to true', (option) => {
    const setters = productionSources('src').filter((file) =>
      new RegExp(`${option}\\s*:\\s*true`).test(readFileSync(file, 'utf8'))
    );
    expect(setters).toEqual([]);
  });
});
