import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
// The fixture imports the maintained functions; no copied implementation or CDP handler replaces them.
import {
  readLegacyCensusMemory,
  legacyCensusMemoryAdmission,
  projectLegacyCensus,
  readLegacyCensusOverflow,
  bindLegacyCensusModules,
  collectMarkedLegacyCensus,
  retireLegacyCensusBinding,
} from '../server/scripts/legacy-engine-checkpoint.mjs';

describe('legacy native heap census projection', () => {
  it('retains only bounded scalar phase records from the owning native source and time', () => {
    const shell = readFileSync('server/scripts/legacy-engine-checkpoint.sh', 'utf8');
    const parser = shell
      .split("  | python3 -c '\nimport json,sys,time\n")[1]
      ?.split('\n\' "$CHECKPOINT_INTENT"')[0];
    expect(parser).toBeTruthy();
    const source = 'a'.repeat(64);
    const startedAtMs = Date.now() - 500;
    const intent = { at: (startedAtMs - 100) / 1000, nativeCensus: { sourceSHA256: source } };
    const row = {
      schema: 'legacy-census-phase/v1',
      sourceSHA256: source,
      phase: 'query_begin',
      startedAtMs,
      atMs: startedAtMs,
      predicateVisits: 0,
      gcBegins: 0,
      gcEnds: 0,
      gcDurationMs: 0,
    };
    const line = (value: unknown) => 'legacy-census-phase ' + JSON.stringify(value) + '\n';
    const run = (input: string) =>
      spawnSync('python3', ['-c', 'import json,sys,time\n' + parser, JSON.stringify(intent)], {
        input,
        encoding: 'utf8',
        timeout: 3000,
        maxBuffer: 16384,
      });
    // A timed-out request can have only query_begin. It remains evidence, never completion.
    const valid = run(line(row));
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain('"phase":"query_begin"');
    expect(valid.stdout).not.toContain('query_end');
    for (const bad of [
      { ...row, privatePayload: 'DO_NOT_EXPORT' },
      { ...row, sourceSHA256: 'b'.repeat(64) },
      { ...row, startedAtMs: 1 },
      { ...row, phase: 'private-owner' },
      { ...row, phase: [] },
      { ...row, predicateVisits: true },
      { ...row, atMs: Date.now() + 50000 },
      { ...row, gcBegins: -1 },
      { ...row, gcEnds: 1.5 },
      null,
    ]) {
      const result = run('unrelated private text\nlegacy-census-phase {broken\n' + line(bad));
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(
        '[legacy-engine-checkpoint] native phase evidence unavailable'
      );
    }
    const excess = run(line(row).repeat(21));
    expect(excess.status).not.toBe(0);
    expect(excess.stdout).toBe('');
    expect(shell).toContain('timeout 1s docker logs');
    expect(shell).toContain('--tail 64');
    expect(shell).toContain('head -c 65536');
  });

  it('accepts only closed bounded overflow counts, never arbitrary target data', () => {
    const value = (counts: unknown, extra = {}) => ({
      type: 'string',
      value: JSON.stringify({ schema: 'legacy-native-census-overflow/v1', counts, ...extra }),
    });
    expect(readLegacyCensusOverflow(value([1, 2, 17996, 2, 2]))).toEqual({
      schema: 'legacy-native-census-counts/v1',
      gameServers: 1,
      tableEngines: 2,
      tournamentManagers: 17996,
      lightningWorkers: 2,
      lightningHosts: 2,
    });
    for (const counts of [
      [1, 2, 17993, 2, 2],
      [1, 2, 22097, 2, 2],
      [1, 2, 22096, 2, 2],
      [1, 2, -1, 2, 2],
      [1, 2, 2003.5, 2, 2],
      [1, 2, '2003', 2, 2],
      [1, 2, 2003, 2],
      null,
    ])
      expect(readLegacyCensusOverflow(value(counts))).toBeNull();
    expect(
      readLegacyCensusOverflow(value([1, 2, 17996, 2, 2], { privatePayload: 'secret' }))
    ).toBeNull();
    expect(readLegacyCensusOverflow({ type: 'string', value: 'invalid' })).toBeNull();
    expect(
      readLegacyCensusOverflow({ type: 'object', value: value([1, 2, 17996, 2, 2]).value })
    ).toBeNull();
  });

  it('matches five native concrete identity sets using one bounded marked census without invoking traps', () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve('tests/operations/legacy-census-projection.mjs'),
        pathToFileURL(resolve('server/scripts/legacy-engine-checkpoint.mjs')).href,
      ],
      {
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 65536,
        env: { PATH: dirname(process.execPath), TZ: 'UTC' },
      }
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout.trim());
    expect(receipt).toMatchObject({
      ok: true,
      nativeBaselineScans: 5,
      markedUnionScans: 1,
      bindingRemoved: true,
      inheritedBehaviorPreserved: true,
      traps: 0,
      admission: true,
      sameProcessAliveAfterCleanup: true,
      inspectorClosed: true,
      portClosed: true,
    });
    expect(receipt.exactSets).toHaveLength(5);
    expect(receipt.exactIdentityEquality).toEqual([true, true, true, true, true]);
  });

  it.each(['connect', 'query', 'deferred', 'disconnect', 'expired', 'restore'])(
    'restores every prototype and releases its own binding on %s failure',
    (failure) => {
      class Shared {
        inherited() {
          return 19;
        }
      }
      const classes = [
        class A {},
        class B extends Shared {},
        class C extends Shared {},
        class D {},
        class E {},
      ];
      const tops = [
        classes[0].prototype,
        Shared.prototype,
        classes[3].prototype,
        classes[4].prototype,
      ];
      const modules = {
        gameServer: { GameServer: classes[0] },
        engine: { ServerTableEngine: classes[1] },
        manager: { TournamentManager: classes[2] },
        lightningWorker: { LightningClusterWorker: classes[3] },
        lightningHost: { LightningHandHost: classes[4] },
      };
      const key = '__legacyEngineCensus_22222222222222222222222222222222';
      let restoreAttempts = 0;
      const object = Object.create(Object);
      object.setPrototypeOf = (target: object, parent: object) => {
        if (parent === Object.prototype) {
          restoreAttempts++;
          if (failure === 'restore' && target === tops[0])
            throw Error('synthetic restoration refusal');
        }
        return Object.setPrototypeOf(target, parent);
      };
      class NativeSession {
        connect() {
          if (failure === 'connect') throw Error('synthetic connect failure');
        }
        post(
          method: string,
          params: Record<string, string>,
          callback: (error: Error | null, result?: unknown) => void
        ) {
          if (method === 'Runtime.evaluate')
            return callback(null, { result: { objectId: 'marker' } });
          if (method === 'Runtime.queryObjects') {
            expect(new classes[1]().inherited()).toBe(19);
            if (failure === 'query') return callback(Error('synthetic query failure'));
            if (failure === 'deferred') return;
            return callback(null, { objects: { objectId: 'native' } });
          }
          vm.runInContext(`(${params.functionDeclaration})`, context).call([]);
          callback(null, { result: { value: true } });
        }
        disconnect() {
          if (failure === 'disconnect') throw Error('synthetic disconnect failure');
        }
      }
      const context: vm.Context = vm.createContext({
        Object: object,
        Date,
        process: {
          getBuiltinModule: (name: string) =>
            name === 'node:inspector' ? { Session: NativeSession } : process.getBuiltinModule(name),
        },
      });
      const bind = vm.runInContext(`(${bindLegacyCensusModules.toString()})`, context);
      const collect = vm.runInContext(`(${collectMarkedLegacyCensus.toString()})`, context);
      const deadline = Date.now() + 5000;
      bind.call(modules, key, deadline);
      if (failure === 'expired') context.Date = { now: () => deadline + 1 };
      try {
        expect(() => collect(key, deadline)).toThrow();
        expect(Object.hasOwn(context, key)).toBe(false);
        if (failure === 'restore') {
          expect(restoreAttempts).toBe(tops.length);
          expect(
            tops.slice(1).every((top) => Object.getPrototypeOf(top) === Object.prototype)
          ).toBe(true);
        } else
          expect(tops.every((top) => Object.getPrototypeOf(top) === Object.prototype)).toBe(true);
      } finally {
        for (const top of tops) Object.setPrototypeOf(top, Object.prototype);
      }
    }
  );

  it('retires only its exact unentered binding, preserving foreign or active ownership', () => {
    const context = vm.createContext({ process, Object, Date });
    const bind = vm.runInContext(`(${bindLegacyCensusModules.toString()})`, context);
    const retire = vm.runInContext(`(${retireLegacyCensusBinding.toString()})`, context);
    const key = '__legacyEngineCensus_33333333333333333333333333333333';
    const deadline = Date.now() + 5000;
    bind.call({}, key, deadline);
    expect(() => bind.call({}, key, deadline)).toThrow('native census binding refused');
    expect(() => retire(key, deadline + 1)).toThrow();
    expect(retire(key, deadline)).toBe(true);
    expect(retire(key, deadline)).toBe(true);
    bind.call({}, key, deadline);
    Object.defineProperty(context[key], 'marker', { value: {} });
    expect(() => retire(key, deadline)).toThrow('native census binding is not unentered');
    expect(Object.hasOwn(context, key)).toBe(true);
  });

  it('refuses excessive prototype diversity or depth instead of omitting owners or growing an unbounded cache', () => {
    const roots = Array.from({ length: 5 }, () => class Concrete {});
    const modules = {
      gameServer: { GameServer: roots[0] },
      engine: { ServerTableEngine: roots[1] },
      manager: { TournamentManager: roots[2] },
      lightningWorker: { LightningClusterWorker: roots[3] },
      lightningHost: { LightningHandHost: roots[4] },
    };
    const diverse = Array.from({ length: 4097 }, () =>
      Object.create(Object.create(Object.prototype))
    );
    expect(() => projectLegacyCensus.call(diverse, modules, Date.now() + 5000)).toThrow(
      'native census topology refused'
    );
    let deep = roots[0].prototype;
    for (let index = 0; index < 257; index++) deep = Object.create(deep);
    expect(() =>
      projectLegacyCensus.call([Object.create(deep)], modules, Date.now() + 5000)
    ).toThrow('native census topology refused');
  });

  it('refuses an expired or exhausted in-target deadline and excessive owner counts without returning a prefix', () => {
    const roots = Array.from({ length: 5 }, () => class Concrete {});
    const modules = {
      gameServer: { GameServer: roots[0] },
      engine: { ServerTableEngine: roots[1] },
      manager: { TournamentManager: roots[2] },
      lightningWorker: { LightningClusterWorker: roots[3] },
      lightningHost: { LightningHandHost: roots[4] },
    };
    expect(() => projectLegacyCensus.call([], modules, Date.now() - 1)).toThrow(
      'native census projection deadline refused'
    );
    expect(() => projectLegacyCensus.call([], modules, Date.now() + 41000)).toThrow(
      'native census projection deadline refused'
    );
    let clockReads = 0;
    const bounded = vm.runInNewContext(`(${projectLegacyCensus.toString()})`, {
      process,
      Date: { now: () => (++clockReads === 1 ? 1000 : 2001) },
    });
    expect(() => bounded.call([new roots[0]()], modules, 2000)).toThrow(
      'native census projection deadline exhausted'
    );
    expect(clockReads).toBe(2);
    const excess = Array.from({ length: 4001 }, () => new roots[1]());
    const projected = projectLegacyCensus.call(excess, modules, Date.now() + 5000);
    expect(projected[1]).toEqual(excess);
    const mixed = [
      ...Array.from({ length: 9000 }, () => new roots[1]()),
      ...Array.from({ length: 9000 }, () => new roots[2]()),
      new roots[0](),
    ];
    const overflow = projectLegacyCensus.call(mixed, modules, Date.now() + 5000);
    expect(typeof overflow).toBe('string');
    expect(JSON.parse(overflow)).toEqual({
      schema: 'legacy-native-census-overflow/v1',
      counts: [1, 9000, 9000, 0, 0],
    });
    expect(() =>
      projectLegacyCensus.call(Array(22097).fill(excess[0]), modules, Date.now() + 5000)
    ).toThrow('native census count refused');
  });

  it('stops walking at EventEmitter.prototype so unrelated EventEmitters are not marked while EventEmitter subclasses still match', () => {
    class ServerTableEngineBase extends EventEmitter {}
    class ServerTableEngine extends ServerTableEngineBase {}
    class TournamentManagerBase extends EventEmitter {}
    class TournamentManager extends TournamentManagerBase {}
    class GameServer {}
    class LightningClusterWorker {}
    class LightningHandHost {}
    const modules = {
      gameServer: { GameServer },
      engine: { ServerTableEngine },
      manager: { TournamentManager },
      lightningWorker: { LightningClusterWorker },
      lightningHost: { LightningHandHost },
    };
    const key = '__legacyEngineCensus_44444444444444444444444444444444';
    const deadline = Date.now() + 5000;
    const engineInstance = new ServerTableEngine();
    const managerInstance = new TournamentManager();
    const unrelatedEmitter = new EventEmitter();
    let markerDuringCollect: object | null = null;
    let emitterProtoDuringCollect: object | null = null;
    let engineBaseProtoDuringCollect: object | null = null;
    let managerBaseProtoDuringCollect: object | null = null;
    const nativeStub = {
      sourceSHA256: '8c2c3ddc611c6abfe1967f0c6438a71e0df3c2bc13f4a7a64999a054a923830e',
      collect(marker: object) {
        markerDuringCollect = marker;
        emitterProtoDuringCollect = Object.getPrototypeOf(EventEmitter.prototype);
        engineBaseProtoDuringCollect = Object.getPrototypeOf(ServerTableEngineBase.prototype);
        managerBaseProtoDuringCollect = Object.getPrototypeOf(TournamentManagerBase.prototype);
        const candidates = [engineInstance, managerInstance, unrelatedEmitter];
        return candidates.filter((obj) => {
          let cur = Object.getPrototypeOf(obj);
          while (cur !== null) {
            if (cur === marker) return true;
            cur = Object.getPrototypeOf(cur);
          }
          return false;
        });
      },
    };
    class StubSession {
      connect() {}
      post(_method: string, _params: unknown, cb: (err: null, res: unknown) => void) {
        cb(null, { result: { objectId: 'marker-id' } });
      }
      disconnect() {}
    }
    const context = vm.createContext({
      Object,
      Date,
      Number,
      Array,
      Error,
      JSON,
      process: {
        availableMemory: () => 1024 * 1024 * 1024,
        getBuiltinModule: (name: string) =>
          name === 'node:inspector' ? { Session: StubSession } : process.getBuiltinModule(name),
      },
    });
    const bind = vm.runInContext(`(${bindLegacyCensusModules.toString()})`, context);
    const collect = vm.runInContext(`(${collectMarkedLegacyCensus.toString()})`, context);
    bind.call(modules, key, deadline, nativeStub);
    const matched = collect(key, deadline);
    expect(emitterProtoDuringCollect).toBe(Object.prototype);
    expect(engineBaseProtoDuringCollect).toBe(markerDuringCollect);
    expect(managerBaseProtoDuringCollect).toBe(markerDuringCollect);
    expect(Object.getPrototypeOf(ServerTableEngineBase.prototype)).toBe(EventEmitter.prototype);
    expect(Object.getPrototypeOf(TournamentManagerBase.prototype)).toBe(EventEmitter.prototype);
    expect(matched).toEqual([engineInstance, managerInstance]);
    expect(matched).not.toContain(unrelatedEmitter);
  });

  it('does not substitute host free memory when constrained-process availability is unavailable', () => {
    const memory = vm.runInNewContext(`(${readLegacyCensusMemory.toString()})()`, {
      process: {
        getBuiltinModule: () => ({
          getHeapStatistics: () => ({ used_heap_size: 1, total_available_size: 1024 ** 3 }),
        }),
      },
    });
    expect(memory.availableProcessBytes).toBeNull();
    expect(legacyCensusMemoryAdmission(memory)).toBeNull();
  });

  it.each([
    null,
    undefined,
    false,
    [],
    {},
    { usedHeapBytes: 1 },
    { usedHeapBytes: 1, availableHeapBytes: 1, availableProcessBytes: 1, extra: 1 },
  ])('refuses unknown or malformed memory evidence %j', (value) => {
    expect(legacyCensusMemoryAdmission(value)).toBeNull();
  });

  it.each(['usedHeapBytes', 'availableHeapBytes', 'availableProcessBytes'])(
    'refuses invalid numeric %s evidence',
    (field) => {
      for (const value of [0, -1, 0.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
        expect(
          legacyCensusMemoryAdmission({
            usedHeapBytes: 1024,
            availableHeapBytes: 64 * 1024 * 1024,
            availableProcessBytes: 64 * 1024 * 1024,
            [field]: value,
          })
        ).toBeNull();
      }
    }
  );

  it('refuses overflow and admits exact independent heap/process reserve boundaries', () => {
    expect(
      legacyCensusMemoryAdmission({
        usedHeapBytes: Number.MAX_SAFE_INTEGER,
        availableHeapBytes: Number.MAX_SAFE_INTEGER,
        availableProcessBytes: Number.MAX_SAFE_INTEGER,
      })
    ).toBeNull();
    const exact = {
      usedHeapBytes: 1024,
      availableHeapBytes: 33555456,
      availableProcessBytes: 33562624,
    };
    expect(legacyCensusMemoryAdmission(exact)).toMatchObject({
      ok: true,
      requiredHeapBytes: 33555456,
      requiredProcessBytes: 33562624,
    });
    expect(
      legacyCensusMemoryAdmission({ ...exact, availableHeapBytes: exact.availableHeapBytes - 1 })
        ?.ok
    ).toBe(false);
    expect(
      legacyCensusMemoryAdmission({
        ...exact,
        availableProcessBytes: exact.availableProcessBytes - 1,
      })?.ok
    ).toBe(false);
  });
});
