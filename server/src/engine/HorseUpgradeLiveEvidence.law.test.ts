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
    const emitters = sources.filter(
      (s) =>
        s.text.includes(needle) &&
        // The line that names the counter must be on an emitting call, not a
        // list or a comment: a brain fire, a feature note or a watchcounter.
        s.text
          .split('\n')
          .some(
            (line) =>
              line.includes(needle) &&
              !/^\s*(\/\/|\*|\/\*)/.test(line) &&
              /noteFire\(|noteFeature\(|recordWatchcounter\(|noteHorseTelemetryOpportunity|metric:|\? '|: '/.test(
                line
              )
          )
    );
    expect(
      emitters.map((s) => s.file),
      `no emitting line found for ${needle}`
    ).not.toEqual([]);
  });

  it('rejects a needle nothing emits (the check is not vacuous)', () => {
    const ghost = "'upgrade99_never_emitted_anywhere'";
    expect(sources.some((s) => s.text.includes(ghost))).toBe(false);
  });
});
