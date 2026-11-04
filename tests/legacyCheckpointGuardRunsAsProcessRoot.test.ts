import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Release 41730448462-1 reached its 22:55Z break and the retained guard refused
// retained_process_actor_unproven at preflight: Inspector evaluated it while a
// tournament manager's AsyncLocalStorage store was current. The predecessor's
// own bindToProcessRoot (eed06fe5 dataActorContext) clears that store.
const source = readFileSync(resolve('server/scripts/legacy-engine-checkpoint.mjs'), 'utf8');
const match = source.match(
  /functionDeclaration: `(function \(\.\.\.args\) \{[\s\S]*?return pendingCheckpoint;\s*\})`/
);

function predecessorContext() {
  const actor = new AsyncLocalStorage<{ tournamentId: string } | undefined>();
  const root = new AsyncResource('smarter.process-root');
  return {
    actor,
    module: {
      currentTournamentDataAuthority: () => actor.getStore() ?? null,
      bindToProcessRoot:
        <A extends unknown[], R>(work: (...args: A) => R) =>
        (...args: A) =>
          root.runInAsyncScope(() => actor.run(undefined, () => work(...args))),
    },
  };
}

function declaration(guard: string) {
  expect(match, 'guard call declaration is present').not.toBeNull();
   
  return new Function(`return (${match![1].replace('${guard.toString()}', guard)})`)() as (
    ...args: unknown[]
  ) => Promise<unknown>;
}

const guard = `async function (options, objects, modules) {
  const before = modules.dataActorContext.currentTournamentDataAuthority();
  await Promise.resolve();
  return { before, after: modules.dataActorContext.currentTournamentDataAuthority() };
}`;

describe('the retained checkpoint guard runs as the process', () => {
  it('sees no tournament authority even when one is current at evaluation', async () => {
    const { actor, module } = predecessorContext();
    const call = declaration(guard);
    const result = await actor.run({ tournamentId: 'leaked' }, () =>
      call.call({}, {}, {}, { dataActorContext: module })
    );
    expect(result).toEqual({ before: null, after: null });
  });

  it('the previous declaration inherited the leaked authority', async () => {
    const { actor, module } = predecessorContext();
    const old = new Function(
      `return function (...args) { const p = (${guard}).apply(this, args); p.catch(() => {}); return p; }`
    )() as (...args: unknown[]) => Promise<{ before: unknown }>;
    const result = await actor.run({ tournamentId: 'leaked' }, () =>
      old.call({}, {}, {}, { dataActorContext: module })
    );
    expect(result.before).toEqual({ tournamentId: 'leaked' });
  });

  it('a predecessor without bindToProcessRoot runs the guard unchanged', async () => {
    const call = declaration(guard);
    const module = { currentTournamentDataAuthority: () => null };
    await expect(call.call({}, {}, {}, { dataActorContext: module })).resolves.toEqual({
      before: null,
      after: null,
    });
  });
});
