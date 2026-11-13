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
  ABSENT_STYLE_SWITCH_SOURCE,
  STYLE_SWITCH_SOURCE_DEFAULT,
  STYLE_CANARY_ON_BUCKET,
  STYLE_SWITCH_OPTIONS,
  STYLE_SWITCH_STATES,
  styleCanaryBucket,
  styleSwitchBrainOpts,
  styleSwitchDecisionOpts,
  type StyleSwitchOption,
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
        const { styleCanaryBucket: bucket, styleCanaryOptions: _canary, ...config } = opts;
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

  it('behaviour: the decision options every Horse receives are identical without canary, and with one option in canary differ in that option alone', () => {
    // What the brain receives (styleSwitchBrainOpts), not how the source is written: for any mix of states,
    // compare each Horse's options with the first Horse's and collect every option whose treatment differs.
    const treatment = (brain: ReturnType<typeof styleSwitchBrainOpts>, o: StyleSwitchOption) =>
      brain[o] === true ? 'on' : brain.styleShadow?.includes(o) ? 'shadow' : 'off';
    const differing = (states: StyleSwitchStates): Set<string> => {
      const brains = IDS.map((id) =>
        styleSwitchBrainOpts(styleSwitchDecisionOpts(states, id, true))
      );
      const out = new Set<string>();
      for (const b of brains) {
        const keys = new Set([...Object.keys(b), ...Object.keys(brains[0])]);
        for (const k of keys)
          if (k !== 'styleShadow' && !(STYLE_SWITCH_OPTIONS as readonly string[]).includes(k))
            out.add(k); // any non-style key at all is a violation
        for (const o of STYLE_SWITCH_OPTIONS)
          if (treatment(b, o) !== treatment(brains[0], o)) out.add(o);
      }
      return out;
    };
    const plain = STYLE_SWITCH_STATES.filter((s) => s !== 'canary');
    for (let seed = 0; seed < 300; seed++) {
      const mix = (i: number) => plain[(seed * 5 + i * 11 + ((seed * i) % 3)) % plain.length];
      expect([...differing(statesWith(mix))], `seed ${seed}`).toEqual([]);
      const o = seed % STYLE_SWITCH_OPTIONS.length;
      const one = statesWith((i) => (i === o ? 'canary' : mix(i)));
      expect([...differing(one)], `seed ${seed} canary ${STYLE_SWITCH_OPTIONS[o]}`).toEqual([
        STYLE_SWITCH_OPTIONS[o],
      ]);
      // and within that option the two treatments are exactly on (bucket 0) and shadow (every other bucket)
      for (const id of IDS)
        expect(
          treatment(
            styleSwitchBrainOpts(styleSwitchDecisionOpts(one, id, true)),
            STYLE_SWITCH_OPTIONS[o]
          )
        ).toBe(styleCanaryBucket(id) === STYLE_CANARY_ON_BUCKET ? 'on' : 'shadow');
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

  it('the bucket is pinned by golden vectors (a change to the hash, salt or modulus fails here)', () => {
    expect(styleCanaryBucket('aaaaaaaa-0000-4000-8000-000000000001')).toBe(4);
    expect(styleCanaryBucket('aaaaaaaa-0000-4000-8000-000000000010')).toBe(0);
    expect(styleCanaryBucket('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe(1);
    expect(styleCanaryBucket('7C9E6679-7425-40DE-944B-E07FC1F90AE7')).toBe(1);
  });

  it('M1: every option starts off, and the production source serves nothing', () => {
    for (const o of STYLE_SWITCH_OPTIONS) expect(STYLE_SWITCH_SOURCE_DEFAULT[o], o).toBe('off');
    expect(ABSENT_STYLE_SWITCH_SOURCE(0)).toEqual({ kind: 'absent' });
    const worker = readFileSync(
      fileURLToPath(new URL('./horseDecision/workerRuntime.ts', import.meta.url)),
      'utf8'
    );
    // the live worker builds its holder over the absent source only
    expect(worker).toMatch(/new StyleSwitchHolder\(ABSENT_STYLE_SWITCH_SOURCE,/);
    expect(worker.match(/new StyleSwitchHolder\(/g)).toHaveLength(1);
  });

  it('anchor: the worker passes the Horse id into decision options only through the switch resolver', () => {
    // Every decision option object the worker builds starts from `...request.opts`; inside those objects the only
    // per-Horse input may be styleSwitchDecisionOpts(..., request.player.user_id, ...). Anything else that keyed the
    // options on the Horse would be a second split configuration.
    const src = readFileSync(
      fileURLToPath(new URL('./horseDecision/workerRuntime.ts', import.meta.url)),
      'utf8'
    );
    let at = 0;
    let objects = 0;
    for (;;) {
      const start = src.indexOf('...request.opts,', at);
      if (start < 0) break;
      const open = src.lastIndexOf('{', start);
      let depth = 0;
      let end = open;
      for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
      }
      const body = src.slice(open, end + 1).replace(/styleSwitchDecisionOpts\([^)]*\)/g, '');
      expect(body, `options object at ${open}`).not.toMatch(/user_id|userId|styleCanaryBucket/);
      objects++;
      at = end;
    }
    expect(objects).toBeGreaterThanOrEqual(3);
  });
});
