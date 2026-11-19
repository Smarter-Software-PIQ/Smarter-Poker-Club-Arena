/**
 * LIGHTNING PAIRED EVALUATION: RELEASING WHAT A HAND AND AN ARM BUILT (2026-11-19).
 *
 * Every `vi.fn` is entered in two process-wide registries that nothing ever
 * empties: `mocks` of @vitest/spy (what vi.clearAllMocks walks) and `spies` of
 * tinyspy (what restoreAll walks). The host fixture (testing/lightningHostTestKit
 * fakeBackend, fakeHorseLane, buildHost) builds about twenty of them per hand,
 * and each one closes over that hand's host and backend and keeps its call
 * arguments (snapshots, settlements). Through those closures a registered mock
 * also holds the module graph it was built on: the equity caches and the mind
 * of an arm that ended long ago. So every hand of every arm stayed reachable
 * for the life of the process (README D10), and a 2,200-hand cell ran out of
 * the default heap inside its first seed.
 *
 * (The other half of D10 is in LightningPairedEval.test.ts playArm: the arm's
 * error reporter was a vi.fn too, and its recorded calls held every hand
 * through the stack frames of the Error the host reports each hand.)
 *
 * A fixture scope remembers what the registries held when it opened;
 * `release()` removes everything entered since. The arm releases after every
 * hand (so one arm's memory does not grow with its hands) and the caller
 * releases around the arm (the mocks its module factories built).
 *
 * Both registries live in node_modules, outside the module graph the caller
 * resets, so this file reaches the same sets from any graph. The probe below
 * fails the run if a vitest upgrade moves either registry: a harness that can
 * no longer release must say so, not grow quietly.
 */
import { fn as spyFn, mocks as vitestMocks } from '@vitest/spy';
import { spies as tinyspySpies } from 'tinyspy';

export interface LightningEvalFixtureScope {
  /** Removes every mock registered since the scope opened; returns how many. */
  release: () => number;
}

function registries(): Array<Set<unknown>> {
  return [vitestMocks as unknown as Set<unknown>, tinyspySpies as unknown as Set<unknown>];
}

/** How many mocks the two registries hold right now (tests and the README figure). */
export function lightningEvalRegisteredMocks(): number {
  return registries().reduce((n, r) => n + r.size, 0);
}

export function openLightningEvalFixtureScope(): LightningEvalFixtureScope {
  const sets = registries();
  const probe = spyFn();
  for (const set of sets) {
    if (!(set instanceof Set) || !set.has(probe))
      throw new Error(
        'Lightning paired evaluation: a vi.fn is no longer entered in the @vitest/spy `mocks` and tinyspy `spies` registries, so the harness cannot release a hand (memory would grow with every hand played). Re-read where this vitest version keeps its mocks (LightningPairedEvalRelease.test-support.ts).'
      );
    set.delete(probe);
  }
  const kept = sets.map((set) => new Set(set));
  return {
    release() {
      let released = 0;
      sets.forEach((set, i) => {
        for (const mock of set)
          if (!kept[i]!.has(mock)) {
            set.delete(mock);
            released++;
          }
      });
      return released;
    },
  };
}
