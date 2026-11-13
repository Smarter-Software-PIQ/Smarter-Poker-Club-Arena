/**
 * STYLE READ LIVE SWITCH, DELIVERY LEG (2026-11-13): the database configuration reaches every decision worker, and
 * every failure on the way (nothing delivered, unreadable, invalid, stale, a dead worker) reads as off.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  STYLE_SWITCH_OPTIONS,
  STYLE_SWITCH_POLL_MS,
  STYLE_SWITCH_STALE_MS,
  STYLE_SWITCH_STATES,
  StyleSwitchHolder,
} from '../HorseStyleSwitch.js';
import {
  STYLE_SWITCH_DELIVERY_MS,
  createStyleSwitchDelivery,
  createStyleSwitchWorkerInbox,
  styleSwitchMessageValid,
  type StyleSwitchStateMessage,
} from './styleSwitchDelivery.js';

const WALL = Date.UTC(2026, 10, 13, 21, 0);
const ok = (seq: number, options: Record<string, string>): StyleSwitchStateMessage => ({
  type: 'STYLE_SWITCH_STATE',
  seq,
  status: 'ok',
  readAtEpochMs: WALL,
  config: { version: 1, options },
});
const unreadable = (seq: number): StyleSwitchStateMessage => ({
  type: 'STYLE_SWITCH_STATE',
  seq,
  status: 'unreadable',
  readAtEpochMs: WALL,
  config: null,
});

function workerRig() {
  let now = 1_000;
  const notes: string[] = [];
  let wall = WALL;
  const inbox = createStyleSwitchWorkerInbox(
    () => now,
    () => wall
  );
  const holder = new StyleSwitchHolder(inbox.source, (f) => notes.push(f));
  return {
    inbox,
    notes,
    advance: (ms: number) => {
      now += ms;
      wall += ms;
    },
    wall: () => wall,
    /** the worker is busy: wall time passes before it handles its next message, its own refresh clock too */
    busyFor: (ms: number) => {
      now += ms;
      wall += ms;
    },
    states: () => holder.refresh(now),
  };
}

describe('the STYLE_SWITCH_STATE message', () => {
  it('is exactly type, seq, status and config', () => {
    expect(styleSwitchMessageValid(ok(1, {}))).toBe(true);
    expect(styleSwitchMessageValid(unreadable(2))).toBe(true);
    expect(styleSwitchMessageValid({ ...ok(1, {}), extra: 1 })).toBe(false);
    expect(styleSwitchMessageValid({ type: 'STYLE_SWITCH_STATE', seq: 1, status: 'ok' })).toBe(
      false
    );
    expect(styleSwitchMessageValid({ ...ok(1, {}), seq: -1 })).toBe(false);
    expect(styleSwitchMessageValid({ ...ok(1, {}), seq: 1.5 })).toBe(false);
    expect(styleSwitchMessageValid({ ...ok(1, {}), status: 'on' })).toBe(false);
    expect(styleSwitchMessageValid({ ...unreadable(1), config: {} })).toBe(false);
    expect(styleSwitchMessageValid(null)).toBe(false);
    expect(styleSwitchMessageValid([])).toBe(false);
  });
});

describe('the worker inbox feeds the holder', () => {
  it('leaves every other message alone and reads off before any delivery', () => {
    const w = workerRig();
    expect(w.inbox.receive({ type: 'FAST_DECISION' })).toBe(false);
    expect(w.inbox.receive(null)).toBe(false);
    expect(Object.values(w.states()).every((s) => s === 'off')).toBe(true);
    expect(w.notes).toEqual([]);
  });

  it('applies a delivered configuration at the next refresh and names only the options delivered', () => {
    const w = workerRig();
    expect(w.inbox.receive(ok(1, { styleFoldBluff: 'shadow', styleRaiseRespect: 'canary' }))).toBe(
      true
    );
    const s = w.states();
    expect(s.styleFoldBluff).toBe('shadow');
    expect(s.styleRaiseRespect).toBe('canary');
    expect(s.styleBigBetHonesty).toBe('off');
    expect(w.notes).toContain('style_switch_styleFoldBluff_shadow_seen');
  });

  it('switches off within one poll of the delivery that says off', () => {
    const w = workerRig();
    w.inbox.receive(ok(1, { styleFoldBluff: 'on' }));
    expect(w.states().styleFoldBluff).toBe('on');
    w.inbox.receive(ok(2, {}));
    w.advance(STYLE_SWITCH_POLL_MS);
    expect(w.states().styleFoldBluff).toBe('off');
    expect(w.notes).toContain('style_switch_styleFoldBluff_off_seen');
  });

  it('stays on while it is re-delivered and goes off once deliveries stop', () => {
    const w = workerRig();
    let seq = 0;
    for (let i = 0; i < 10; i++) {
      w.inbox.receive({ ...ok(++seq, { styleBigBetHonesty: 'on' }), readAtEpochMs: w.wall() });
      expect(w.states().styleBigBetHonesty).toBe('on');
      w.advance(STYLE_SWITCH_DELIVERY_MS);
    }
    w.advance(STYLE_SWITCH_STALE_MS + 1);
    expect(w.states().styleBigBetHonesty).toBe('off');
    expect(w.notes).toContain('style_switch_config_stale_seen');
  });

  it('turns everything off on an unreadable delivery', () => {
    const w = workerRig();
    w.inbox.receive(ok(1, { styleValueExtraction: 'on' }));
    expect(w.states().styleValueExtraction).toBe('on');
    w.inbox.receive(unreadable(2));
    w.advance(STYLE_SWITCH_POLL_MS);
    expect(Object.values(w.states()).every((s) => s === 'off')).toBe(true);
    expect(w.notes).toContain('style_switch_config_unreadable_seen');
  });

  it('turns everything off on a malformed envelope or a configuration the parser refuses', () => {
    for (const bad of [
      { ...ok(2, {}), extra: true },
      ok(2, { notAnOption: 'on' }),
      ok(2, { styleFoldBluff: 'maybe' }),
      { ...ok(2, {}), config: null },
    ]) {
      const w = workerRig();
      w.inbox.receive(ok(1, { styleFoldBluff: 'on' }));
      expect(w.states().styleFoldBluff).toBe('on');
      expect(w.inbox.receive(bad)).toBe(true);
      w.advance(STYLE_SWITCH_POLL_MS);
      expect(Object.values(w.states()).every((s) => s === 'off')).toBe(true);
      expect(w.notes).toContain('style_switch_config_invalid_seen');
    }
  });

  it('measures freshness from the database read: a reading that sat unhandled past the stale bound never applies', () => {
    const w = workerRig();
    const message = ok(1, { styleFoldBluff: 'on' });
    w.busyFor(STYLE_SWITCH_STALE_MS + 1_000);
    w.inbox.receive(message);
    expect(w.states().styleFoldBluff).toBe('off');
    expect(w.notes).toContain('style_switch_config_stale_seen');
  });

  it('one failed read then silence: the last delivery ends at the stale bound', () => {
    const w = workerRig();
    w.inbox.receive(ok(1, { styleFoldBluff: 'on' }));
    expect(w.states().styleFoldBluff).toBe('on');
    w.advance(STYLE_SWITCH_STALE_MS - 1_000);
    expect(w.states().styleFoldBluff).toBe('on');
    w.advance(2_000);
    expect(w.states().styleFoldBluff).toBe('off');
  });

  it('an invalid envelope does not let an older delivery back in', () => {
    const w = workerRig();
    w.inbox.receive(ok(5, {}));
    w.inbox.receive({ type: 'STYLE_SWITCH_STATE', nonsense: true });
    w.inbox.receive(ok(4, { styleFoldBluff: 'on' }));
    w.advance(STYLE_SWITCH_POLL_MS);
    expect(w.states().styleFoldBluff).toBe('off');
  });

  it('never lets an older delivery replace a newer one', () => {
    const w = workerRig();
    w.inbox.receive(ok(5, {}));
    w.inbox.receive(ok(4, { styleFoldBluff: 'on' }));
    expect(w.states().styleFoldBluff).toBe('off');
  });
});

describe('the main-thread delivery', () => {
  function mainRig(reads: Array<() => Promise<unknown>>) {
    const sent: StyleSwitchStateMessage[] = [];
    const warnings: string[] = [];
    let at = WALL;
    let i = 0;
    const delivery = createStyleSwitchDelivery({
      read: () => (reads[Math.min(i++, reads.length - 1)] as () => Promise<unknown>)(),
      broadcast: (m) => sent.push(m),
      readTimeoutMs: 20,
      now: () => at,
      warn: (m) => warnings.push(m),
    });
    return { delivery, sent, warnings, setNow: (v: number) => (at = v) };
  }
  const good = (options: Record<string, string>) => () => Promise.resolve({ version: 1, options });
  const bad = () => Promise.reject(new Error('rpc failed'));

  it('delivers every successful read, unchanged or not, with a rising sequence', async () => {
    const r = mainRig([good({ styleFoldBluff: 'shadow' })]);
    await r.delivery.tick();
    await r.delivery.tick();
    expect(r.sent).toEqual([
      ok(1, { styleFoldBluff: 'shadow' }),
      ok(2, { styleFoldBluff: 'shadow' }),
    ]);
  });

  it('keeps the last delivery through one failed read and delivers unreadable on the second', async () => {
    const r = mainRig([good({}), bad, bad, good({})]);
    await r.delivery.tick();
    await r.delivery.tick();
    expect(r.sent).toHaveLength(1);
    await r.delivery.tick();
    expect(r.sent[1]).toEqual(unreadable(2));
    await r.delivery.tick();
    expect(r.sent[2]).toEqual(ok(3, {}));
    // the first failure says the last delivery stands, and the recovery is logged
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain('the last delivery stands');
    expect(r.warnings[1]).toContain('reads again');
  });

  it('reports a long outage at most once per five minutes after its first failure', async () => {
    const r = mainRig([bad]);
    await r.delivery.tick();
    for (let k = 0; k < 5; k++) await r.delivery.tick();
    expect(r.warnings).toHaveLength(1);
    r.setNow(WALL + 5 * 60_000);
    await r.delivery.tick();
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[1]).toContain('every option now reads off');
  });

  it('start reads at once, then on the interval, on a timer that never holds the process, and only once', async () => {
    vi.useFakeTimers();
    try {
      const setSpy = vi.spyOn(globalThis, 'setInterval');
      let reads = 0;
      const delivery = createStyleSwitchDelivery({
        read: () => {
          reads++;
          return Promise.resolve({ version: 1, options: {} });
        },
        broadcast: () => {},
        intervalMs: 1_000,
        warn: () => {},
      });
      delivery.start();
      delivery.start();
      expect(setSpy).toHaveBeenCalledTimes(1);
      const timer = setSpy.mock.results[0]!.value as { hasRef?: () => boolean };
      expect(timer.hasRef?.()).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toBe(1);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(reads).toBe(4);
      delivery.stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(reads).toBe(4);
      setSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts a read that never answers as a failure', async () => {
    const r = mainRig([() => new Promise(() => {})]);
    await r.delivery.tick();
    await r.delivery.tick();
    expect(r.sent).toEqual([unreadable(1)]);
  });

  it('never runs two reads at once, survives a broadcast that throws, and posts nothing after stop', async () => {
    let release: (v: unknown) => void = () => {};
    let reads = 0;
    const sent: StyleSwitchStateMessage[] = [];
    const delivery = createStyleSwitchDelivery({
      read: () => {
        reads++;
        return new Promise((resolve) => (release = resolve));
      },
      broadcast: (m) => {
        sent.push(m);
        throw new Error('a worker is gone');
      },
      readTimeoutMs: 1_000,
      warn: () => {},
    });
    const first = delivery.tick();
    await delivery.tick();
    expect(reads).toBe(1);
    release({ version: 1, options: {} });
    await first;
    expect(sent).toHaveLength(1);
    const second = delivery.tick();
    delivery.stop();
    release({ version: 1, options: {} });
    await second;
    expect(sent).toHaveLength(1);
  });

  it('reaches the holder end to end: database answer in, option state out', async () => {
    const w = workerRig();
    const delivery = createStyleSwitchDelivery({
      read: () => Promise.resolve({ version: 1, options: { styleRaiseRespect: 'shadow' } }),
      broadcast: (m) => w.inbox.receive(JSON.parse(JSON.stringify(m))),
      now: () => w.wall(),
      warn: () => {},
    });
    await delivery.tick();
    expect(w.states().styleRaiseRespect).toBe('shadow');
  });
});

describe('the wiring and the migration agree with the engine', () => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const read = (p: string) => fs.readFileSync(path.resolve(here, p), 'utf8');

  it('the worker serves its switch from the inbox and the pool starts the delivery', () => {
    const worker = read('worker.ts');
    expect(worker).toContain('new StyleSwitchHolder(styleSwitchInbox.source');
    expect(worker).toContain('if (styleSwitchInbox.receive(message)) return;');
    const lane = read('lane.ts');
    expect(lane).toContain('read: options.styleSwitchRead ?? readStyleSwitchFromDatabase');
    expect(lane).toContain('broadcast: (message) => singleton?.broadcastStyleSwitch(message)');
    expect(lane).toContain('styleSwitchDelivery?.stop();');
  });

  it('the migration names exactly the engine options and states, adds no rows and grants no browser role', () => {
    const dir = path.resolve(here, '../../../../supabase/migrations');
    const file = fs
      .readdirSync(dir)
      .find((f) => f.endsWith('_the_horse_style_read_has_a_live_switch.sql'));
    expect(file).toBeDefined();
    const sql = fs.readFileSync(path.join(dir, file as string), 'utf8');
    const code = sql.replace(/--.*$/gm, '');
    const table = code.slice(code.indexOf('CREATE TABLE public.ca_horse_style_switch ('));
    const optionList = [
      ...(/option IN \(([^)]*)\)/.exec(table)?.[1] ?? '').matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    expect(optionList.sort()).toEqual([...STYLE_SWITCH_OPTIONS].sort());
    const stateList = [
      ...(/state IN \(([^)]*)\)/.exec(table)?.[1] ?? '').matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    expect(stateList.sort()).toEqual([...STYLE_SWITCH_STATES].sort());
    expect(code).not.toMatch(/INSERT INTO public\.ca_horse_style_switch\b(?! AS s)/);
    expect(code).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_horse_style_switch_effective() FROM PUBLIC, anon, authenticated;'
    );
    expect(code).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_horse_style_switch_set(text, text, text, text) FROM PUBLIC, anon, authenticated;'
    );
    expect(code).not.toMatch(/GRANT[^;]*TO (anon|authenticated|PUBLIC)/i);
    expect(code).not.toMatch(
      /GRANT\s+(?!SELECT ON TABLE|EXECUTE ON FUNCTION)[^;]*TO service_role/i
    );
    expect(code.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(code.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
});
