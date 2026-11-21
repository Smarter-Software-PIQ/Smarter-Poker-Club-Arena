import { describe, expect, it } from 'vitest';
import {
  LOAD_CAP,
  SLOPE,
  loadAwareTestTimeout,
} from '../../scripts/ci/load-aware-test-timeout.mjs';

const local = { GITHUB_ACTIONS: undefined } as Record<string, string | undefined>;

describe('the harness timeout follows the load of the machine it runs on', () => {
  it('hosted CI keeps the stated timeout exactly, whatever the load', () => {
    expect(
      loadAwareTestTimeout(30_000, { env: { GITHUB_ACTIONS: 'true' }, load: 90, cores: 2 })
    ).toBe(30_000);
  });

  it('an idle or lightly loaded machine keeps the stated timeout (a hang still fails fast)', () => {
    expect(loadAwareTestTimeout(30_000, { env: local, load: 0, cores: 28 })).toBe(30_000);
    expect(loadAwareTestTimeout(30_000, { env: local, load: 11, cores: 28 })).toBe(30_000);
    expect(loadAwareTestTimeout(30_000, { env: local, load: Number.NaN, cores: 28 })).toBe(30_000);
  });

  it('scales with load per core: every 2026-11-20 gate failure fits inside it', () => {
    // [base, measured ms, load at the time] from CORE-POOLED-2's posts (22:33Z, 23:03Z)
    const failures: Array<[number, number, number]> = [
      [30_000, 64_400, 30], // tests/law-registry.law.test.ts
      [30_000, 48_300, 23], // tests/a-revoke-from-anon-must-name-public.law.test.ts (load 23-36)
      [20_000, 20_000, 26], // tests/unit/postDeployE2eHonestyLaw.test.ts (14.0 s on its retry)
    ];
    for (const [base, took, load] of failures) {
      expect(loadAwareTestTimeout(base, { env: local, load, cores: 28 })).toBeGreaterThan(took);
    }
    expect(loadAwareTestTimeout(30_000, { env: local, load: (28 * 2) / SLOPE, cores: 28 })).toBe(
      60_000
    );
  });

  it('is capped, so a runaway machine still ends the run', () => {
    expect(loadAwareTestTimeout(30_000, { env: local, load: 500, cores: 28 })).toBe(
      30_000 * LOAD_CAP
    );
  });

  it('refuses a nonsense base', () => {
    expect(() => loadAwareTestTimeout(0, { env: local })).toThrow(RangeError);
  });
});
