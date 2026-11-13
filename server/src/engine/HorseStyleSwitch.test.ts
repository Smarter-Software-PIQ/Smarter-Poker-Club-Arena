/**
 * STYLE READ LIVE SWITCH (2026-11-13): off, shadow, canary and on; the source default; a malformed or unreadable
 * configuration fails safe to off; a switch-off lands within one poll interval; every change is receipted.
 */
import { describe, expect, it } from 'vitest';
import {
  ABSENT_STYLE_SWITCH_SOURCE,
  STYLE_CANARY_ON_BUCKET,
  STYLE_SWITCH_OPTIONS,
  STYLE_SWITCH_POLL_MS,
  STYLE_SWITCH_SOURCE_DEFAULT,
  STYLE_SWITCH_STALE_MS,
  StyleSwitchHolder,
  parseStyleSwitchConfig,
  styleCanaryBucket,
  styleSwitchBrainOpts,
  styleSwitchDecisionOpts,
  styleSwitchSourceFromStates,
  styleSwitchStatesFrom,
  type StyleSwitchReading,
} from './HorseStyleSwitch.js';

const HORSE = 'aaaaaaaa-0000-4000-8000-000000000001';
const T0 = Date.UTC(2026, 10, 13, 6, 0);

type Served = StyleSwitchReading | ((nowMs: number) => StyleSwitchReading);
function rig(initial: Served) {
  let reading = initial;
  const notes: string[] = [];
  let reads = 0;
  const holder = new StyleSwitchHolder(
    (nowMs) => {
      reads++;
      return typeof reading === 'function' ? reading(nowMs) : reading;
    },
    (f) => notes.push(f)
  );
  return {
    holder,
    notes,
    reads: () => reads,
    set: (r: Served) => {
      reading = r;
    },
  };
}
/** A source that delivers this configuration as received at the moment it is read. */
const present =
  (options: Record<string, unknown>) =>
  (nowMs: number): StyleSwitchReading => ({
    kind: 'present',
    raw: { version: 1, options },
    receivedAtMs: nowMs,
  });

describe('style read live switch', () => {
  it('default: no configuration on file keeps every option at the source default, off, and adds no option', () => {
    expect(Object.values(STYLE_SWITCH_SOURCE_DEFAULT).every((s) => s === 'off')).toBe(true);
    const r = rig({ kind: 'absent' });
    const states = r.holder.refresh(T0);
    expect(states).toEqual(STYLE_SWITCH_SOURCE_DEFAULT);
    expect(styleSwitchDecisionOpts(states, HORSE, true)).toEqual({});
    expect(r.notes).toEqual([]);
    expect(ABSENT_STYLE_SWITCH_SOURCE(T0)).toEqual({ kind: 'absent' });
  });

  it('on: the option becomes an explicit true; the change is receipted with the option and the state', () => {
    const r = rig(present({ styleFoldBluff: 'on' }));
    const states = r.holder.refresh(T0);
    expect(styleSwitchDecisionOpts(states, HORSE, true)).toEqual({ styleFoldBluff: true });
    expect(r.notes).toEqual(['style_switch_styleFoldBluff_on_seen']);
  });

  it('shadow: the option is listed in styleShadow and is not true; the second look gets no shadow list', () => {
    const r = rig(present({ styleRaiseRespect: 'shadow', styleBigBetHonesty: 'shadow' }));
    const states = r.holder.refresh(T0);
    expect(styleSwitchDecisionOpts(states, HORSE, true)).toEqual({
      styleShadow: ['styleBigBetHonesty', 'styleRaiseRespect'],
    });
    expect(styleSwitchDecisionOpts(states, HORSE, false)).toEqual({});
    expect(r.notes.sort()).toEqual([
      'style_switch_styleBigBetHonesty_shadow_seen',
      'style_switch_styleRaiseRespect_shadow_seen',
    ]);
  });

  it('off: an explicit off is the default; a switch-off from on is receipted', () => {
    const r = rig(present({ styleFoldBluff: 'on' }));
    r.holder.refresh(T0);
    r.set(present({ styleFoldBluff: 'off' }));
    const states = r.holder.refresh(T0 + STYLE_SWITCH_POLL_MS);
    expect(styleSwitchDecisionOpts(states, HORSE, true)).toEqual({});
    expect(r.notes).toEqual([
      'style_switch_styleFoldBluff_on_seen',
      'style_switch_styleFoldBluff_off_seen',
    ]);
  });

  it('malformed or unreadable configuration fails safe to off, with a receipt', () => {
    const bad: unknown[] = [
      null,
      42,
      'on',
      [],
      { version: 2, options: { styleFoldBluff: 'on' } },
      { version: 1 },
      { version: 1, options: [] },
      { version: 1, options: { styleFoldBluff: 'yes' } },
      { version: 1, options: { styleUnknown: 'on' } },
      { version: 1, options: { styleFoldBluff: 'on' }, extra: true },
    ];
    for (const raw of bad) {
      expect(parseStyleSwitchConfig(raw).ok, JSON.stringify(raw)).toBe(false);
      const r = rig(present({ styleFoldBluff: 'on', styleRaiseRespect: 'shadow' }));
      r.holder.refresh(T0);
      r.set((nowMs) => ({ kind: 'present', raw, receivedAtMs: nowMs }));
      const states = r.holder.refresh(T0 + STYLE_SWITCH_POLL_MS);
      expect(states, JSON.stringify(raw)).toEqual(STYLE_SWITCH_SOURCE_DEFAULT);
      expect(r.notes).toContain('style_switch_config_invalid_seen');
      expect(r.notes).toContain('style_switch_styleFoldBluff_off_seen');
      expect(r.notes).toContain('style_switch_styleRaiseRespect_off_seen');
    }
    const t = rig(present({ styleFoldBluff: 'on' }));
    t.holder.refresh(T0);
    t.set(() => {
      throw new Error('read failed');
    });
    expect(t.holder.refresh(T0 + STYLE_SWITCH_POLL_MS)).toEqual(STYLE_SWITCH_SOURCE_DEFAULT);
    expect(t.notes).toContain('style_switch_config_unreadable_seen');
    const odd = rig({ kind: 'weird' } as never);
    expect(odd.holder.refresh(T0)).toEqual(STYLE_SWITCH_SOURCE_DEFAULT);
    expect(odd.notes).toEqual(['style_switch_config_invalid_seen']);
  });

  it('the source default wins when the configuration is absent again', () => {
    const r = rig(present({ styleFoldBluff: 'on' }));
    r.holder.refresh(T0);
    r.set({ kind: 'absent' });
    expect(r.holder.refresh(T0 + STYLE_SWITCH_POLL_MS)).toEqual(STYLE_SWITCH_SOURCE_DEFAULT);
  });

  it('poll delay: a switch-off takes effect at the first read after one poll interval, never later', () => {
    const r = rig(present({ styleValueExtraction: 'on' }));
    expect(r.holder.refresh(T0).styleValueExtraction).toBe('on');
    r.set(present({ styleValueExtraction: 'off' }));
    // inside the interval the last read stands, and the source is not read again
    for (const dt of [1, 1_000, 30_000, STYLE_SWITCH_POLL_MS - 1])
      expect(r.holder.refresh(T0 + dt).styleValueExtraction, String(dt)).toBe('on');
    expect(r.reads()).toBe(1);
    // at the interval it is read and off holds from that decision on
    expect(r.holder.refresh(T0 + STYLE_SWITCH_POLL_MS).styleValueExtraction).toBe('off');
    expect(r.reads()).toBe(2);
    expect(r.holder.current().styleValueExtraction).toBe('off');
    expect(STYLE_SWITCH_POLL_MS).toBe(60_000);
  });

  it('canary: a fixed tenth of Horses by a stable hash of the Horse id is on, every other Horse is in shadow', () => {
    const ids = Array.from(
      { length: 10_000 },
      (_, i) => `aaaaaaaa-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
    );
    const on = ids.filter((id) => styleCanaryBucket(id) === STYLE_CANARY_ON_BUCKET);
    expect(on.length / ids.length).toBeGreaterThan(0.085);
    expect(on.length / ids.length).toBeLessThan(0.115);
    // deterministic, case-blind
    expect(styleCanaryBucket(HORSE)).toBe(styleCanaryBucket(HORSE.toUpperCase()));
    expect(ids.map(styleCanaryBucket)).toEqual(ids.map(styleCanaryBucket));
    const r = rig(present({ styleFoldBluff: 'canary' }));
    const states = r.holder.refresh(T0);
    expect(r.notes).toEqual(['style_switch_styleFoldBluff_canary_seen']);
    for (const id of ids.slice(0, 200)) {
      const b = styleCanaryBucket(id);
      expect(styleSwitchDecisionOpts(states, id, true)).toEqual(
        b === STYLE_CANARY_ON_BUCKET
          ? { styleFoldBluff: true, styleCanaryBucket: b, styleCanaryOptions: ['styleFoldBluff'] }
          : {
              styleShadow: ['styleFoldBluff'],
              styleCanaryBucket: b,
              styleCanaryOptions: ['styleFoldBluff'],
            }
      );
    }
  });

  it('every option name is a decision option of the brain', () => {
    expect(STYLE_SWITCH_OPTIONS).toEqual([
      'styleValueBettorNotManiac',
      'styleBigBetHonesty',
      'styleRaiseRespect',
      'styleTightReRaiserRespect',
      'styleFoldRatePreRepair',
      'styleValueExtraction',
      'styleFoldBluff',
    ]);
  });

  it('L1 stale, strict: a configuration stops 120 s after it was received, at any decision, not only at a read', () => {
    expect(STYLE_SWITCH_STALE_MS).toBe(2 * STYLE_SWITCH_POLL_MS);
    // a source that keeps serving the same delivery, received at T0
    const r = rig({
      kind: 'present',
      raw: { version: 1, options: { styleFoldBluff: 'on' } },
      receivedAtMs: T0,
    });
    expect(r.holder.refresh(T0 + 1).styleFoldBluff).toBe('on');
    // at exactly the bound it still holds
    expect(r.holder.refresh(T0 + STYLE_SWITCH_STALE_MS).styleFoldBluff).toBe('on');
    // one millisecond later it is off, although no read is due (the last read was at T0 + 120 s)
    expect(r.holder.refresh(T0 + STYLE_SWITCH_STALE_MS + 1)).toEqual(STYLE_SWITCH_SOURCE_DEFAULT);
    expect(r.notes).toContain('style_switch_config_stale_seen');
    expect(r.notes).toContain('style_switch_styleFoldBluff_off_seen');
    // and a later read of the same old delivery stays off
    expect(r.holder.refresh(T0 + 10 * STYLE_SWITCH_POLL_MS)).toEqual(STYLE_SWITCH_SOURCE_DEFAULT);
  });

  it('L1 strict: a present reading without its receive time is invalid and fails safe to off', () => {
    const r = rig({
      kind: 'present',
      raw: { version: 1, options: { styleFoldBluff: 'on' } },
    } as never);
    expect(r.holder.refresh(T0)).toEqual(STYLE_SWITCH_SOURCE_DEFAULT);
    expect(r.notes).toEqual(['style_switch_config_invalid_seen']);
  });

  it('L2 clock: a step back is a due read, never a freeze', () => {
    const r = rig(present({ styleFoldBluff: 'on' }));
    r.holder.refresh(T0);
    r.set(present({ styleFoldBluff: 'off' }));
    // the clock went back: the switch-off is read at once, not after the poll interval plus the step
    expect(r.holder.refresh(T0 - 10_000).styleFoldBluff).toBe('off');
  });

  it('L4: the canary options are listed, so a plain-shadow option on the same Horse is not labelled canary', () => {
    const states = parseStyleSwitchConfig({
      version: 1,
      options: { styleFoldBluff: 'canary', styleRaiseRespect: 'shadow' },
    });
    expect(states.ok).toBe(true);
    const id = 'aaaaaaaa-0000-4000-8000-000000000001'; // bucket 4: the shadow arm of the canary
    const opts = styleSwitchDecisionOpts((states as unknown as { states: never }).states, id, true);
    expect(opts.styleCanaryOptions).toEqual(['styleFoldBluff']);
    expect(opts.styleShadow).toEqual(['styleRaiseRespect', 'styleFoldBluff']);
    // the brain never sees the receipt-only fields
    expect(styleSwitchBrainOpts(opts)).toEqual({
      styleShadow: ['styleRaiseRespect', 'styleFoldBluff'],
    });
  });

  it('M3: recorded states round-trip through the replay source', () => {
    const states = (
      parseStyleSwitchConfig({
        version: 1,
        options: { styleValueExtraction: 'on' },
      }) as unknown as {
        states: never;
      }
    ).states;
    expect(styleSwitchStatesFrom(states)).toEqual(states);
    expect(styleSwitchStatesFrom({ ...STYLE_SWITCH_SOURCE_DEFAULT, extra: 'off' })).toBeNull();
    expect(
      styleSwitchStatesFrom({ ...STYLE_SWITCH_SOURCE_DEFAULT, styleFoldBluff: 'yes' })
    ).toBeNull();
    const h = new StyleSwitchHolder(styleSwitchSourceFromStates(states), () => {});
    expect(h.refresh(T0)).toEqual(states);
    expect(styleSwitchSourceFromStates(null)(T0)).toEqual({ kind: 'absent' });
    expect(styleSwitchSourceFromStates(STYLE_SWITCH_SOURCE_DEFAULT)(T0)).toEqual({
      kind: 'absent',
    });
  });
});
