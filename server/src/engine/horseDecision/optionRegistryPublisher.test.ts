import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { OPTION_SWITCH_REGISTRY, optionSwitchStatesFrom } from '../HorseOptionSwitch.js';
import {
  createOptionRegistryPublisher,
  optionRegistryDigest,
  optionRegistryPayload,
} from './optionRegistryPublisher.js';

const SHA = 'a'.repeat(40);

describe('the serving engine publishes the option registry it parses with (reset-trap guard)', () => {
  it('publishes every registered name with exactly the states its parser accepts', () => {
    const payload = optionRegistryPayload();
    expect(Object.keys(payload)).toEqual(OPTION_SWITCH_REGISTRY.map((e) => e.name));
    for (const e of OPTION_SWITCH_REGISTRY) expect(payload[e.name]).toEqual([...e.states]);
    // the published list IS the parser's: every non-style name at every published state parses alone,
    // and a name the payload does not carry is skipped alone (2026-11-20: it no longer voids the set)
    for (const [name, states] of Object.entries(payload)) {
      if (states.includes('shadow')) continue;
      for (const s of states) expect(optionSwitchStatesFrom({ [name]: s })).not.toBeNull();
    }
    expect(optionSwitchStatesFrom({ notPublishedByThisRelease: 'off' })).toEqual({});
  });

  it('the digest is canonical: key order does not change it, a state does', () => {
    const a = { b: ['off', 'on'], a: ['off'] };
    const b = { a: ['off'], b: ['off', 'on'] };
    expect(optionRegistryDigest(a)).toBe(optionRegistryDigest(b));
    expect(optionRegistryDigest(a)).not.toBe(
      optionRegistryDigest({ a: ['off', 'on'], b: ['off', 'on'] })
    );
    expect(optionRegistryDigest(optionRegistryPayload())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the digest is sha256 of exactly the string the database rebuilds (fn_ca_horse_option_registry_publish)', () => {
    // the publish function builds '[' || '["<name>",["<state>",...]]' joined by ',' ordered by name COLLATE "C" || ']'
    const expected = createHash('sha256')
      .update('[["a",["off"]],["b",["off","on"]],["styleX",["off","shadow","canary","on"]]]')
      .digest('hex');
    expect(
      optionRegistryDigest({
        styleX: ['off', 'shadow', 'canary', 'on'],
        b: ['off', 'on'],
        a: ['off'],
      })
    ).toBe(expected);
  });

  it('calls the publish function with the release sha, the payload and its digest', async () => {
    const rpc = vi.fn(async () => ({ data: { release_sha: SHA }, error: null }));
    const p = createOptionRegistryPublisher({ releaseSha: SHA, rpc, warn: () => {} });
    await expect(p.publish()).resolves.toBe('published');
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe('fn_ca_horse_option_registry_publish');
    expect(args.p_release_sha).toBe(SHA);
    expect(args.p_registry).toEqual(optionRegistryPayload());
    expect(args.p_digest).toBe(optionRegistryDigest(optionRegistryPayload()));
  });

  it('a process without a full release sha publishes nothing (it can never stand in for the serving release)', async () => {
    for (const releaseSha of [null, 'abc12345', 'A'.repeat(40)]) {
      const rpc = vi.fn();
      const warn = vi.fn();
      const p = createOptionRegistryPublisher({ releaseSha, rpc, warn });
      await expect(p.publish()).resolves.toBe('skipped_no_release');
      await expect(p.publish()).resolves.toBe('skipped_no_release');
      expect(rpc).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it('never throws: a missing function, an error answer and a rejected call each resolve, warnings throttled', async () => {
    let t = 0;
    const warn = vi.fn();
    const answers: Array<
      () => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
    > = [
      async () => ({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' },
      }),
      async () => ({ data: null, error: { message: 'boom' } }),
      async () => {
        throw new Error('network down');
      },
    ];
    let i = 0;
    const p = createOptionRegistryPublisher({
      releaseSha: SHA,
      rpc: () => answers[i++ % answers.length]!(),
      now: () => t,
      warn,
    });
    await expect(p.publish()).resolves.toBe('function_missing');
    await expect(p.publish()).resolves.toBe('failed');
    await expect(p.publish()).resolves.toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1);
    t += 31 * 60_000;
    await expect(p.publish()).resolves.toBe('function_missing');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('one publish at a time: a tick that finds one in flight shares it', async () => {
    let release!: () => void;
    const rpc = vi.fn(
      () =>
        new Promise<{ data: unknown; error: null }>((resolve) => {
          release = () => resolve({ data: null, error: null });
        })
    );
    const p = createOptionRegistryPublisher({ releaseSha: SHA, rpc, warn: () => {} });
    const a = p.publish();
    const b = p.publish();
    await Promise.resolve();
    release();
    await expect(Promise.all([a, b])).resolves.toEqual(['published', 'published']);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
