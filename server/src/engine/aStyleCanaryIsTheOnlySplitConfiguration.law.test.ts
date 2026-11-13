/**
 * LAW (2026-11-13): every Horse runs one effective configuration, with ONE recorded exception: while a style read
 * option is in 'canary', the Horses whose stable canary bucket is 0 run it on and every other Horse runs it in
 * shadow. No other state, and no other option path, resolves differently for different Horses.
 * Registered in docs/laws.d/a-style-canary-is-the-only-split-configuration.md.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  STYLE_CANARY_ON_BUCKET,
  STYLE_SWITCH_OPTIONS,
  STYLE_SWITCH_STATES,
  styleCanaryBucket,
  styleSwitchDecisionOpts,
  type StyleSwitchState,
  type StyleSwitchStates,
} from './HorseStyleSwitch.js';

const IDS = Array.from(
  { length: 400 },
  (_, i) => `dddddddd-0000-4000-8000-${(i * 7919).toString(16).padStart(12, '0')}`
);
const statesWith = (pick: (i: number) => StyleSwitchState): StyleSwitchStates =>
  Object.fromEntries(STYLE_SWITCH_OPTIONS.map((o, i) => [o, pick(i)])) as StyleSwitchStates;
const configurationsOf = (states: StyleSwitchStates) =>
  new Set(IDS.map((id) => JSON.stringify(styleSwitchDecisionOpts(states, id, true))));

describe('law: a style canary is the only split configuration', () => {
  it('without canary every Horse resolves the one configuration, for every state of every option', () => {
    const plain = STYLE_SWITCH_STATES.filter((s) => s !== 'canary');
    for (const o of STYLE_SWITCH_OPTIONS.keys())
      for (const s of plain)
        expect(configurationsOf(statesWith((i) => (i === o ? s : 'off'))).size, `${o}:${s}`).toBe(
          1
        );
    // mixed sets without canary, deterministic sweep
    for (let seed = 0; seed < 200; seed++)
      expect(
        configurationsOf(statesWith((i) => plain[(seed * 7 + i * 13) % plain.length])).size
      ).toBe(1);
  });

  it('with an option in canary there are exactly two configurations, split by the canary bucket alone', () => {
    for (const o of STYLE_SWITCH_OPTIONS.keys()) {
      const states = statesWith((i) => (i === o ? 'canary' : i % 2 ? 'shadow' : 'off'));
      const byArm = new Map<boolean, Set<string>>();
      for (const id of IDS) {
        const inCanary = styleCanaryBucket(id) === STYLE_CANARY_ON_BUCKET;
        const opts = styleSwitchDecisionOpts(states, id, true);
        const { styleCanaryBucket: bucket, ...config } = opts;
        expect(bucket).toBe(styleCanaryBucket(id));
        (byArm.get(inCanary) ?? byArm.set(inCanary, new Set()).get(inCanary)!).add(
          JSON.stringify(config)
        );
      }
      expect(byArm.get(true)?.size, `option ${o}`).toBe(1);
      expect(byArm.get(false)?.size, `option ${o}`).toBe(1);
      expect([...byArm.get(true)!][0]).not.toBe([...byArm.get(false)!][0]);
    }
  });

  it('only the live switch reads the canary bucket; no other source resolves a per-Horse option', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== 'node_modules') walk(p);
        } else if (/\.ts$/.test(name) && !/\.test\.ts$|\.test-support\.ts$/.test(name)) {
          const src = readFileSync(p, 'utf8');
          if (/styleCanaryBucket\(|STYLE_CANARY_SALT|styleArmFor\(/.test(src))
            hits.push(p.slice(root.length));
        }
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(['engine/HorseStyleSwitch.ts']);
  });
});
