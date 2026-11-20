/**
 * LAW: ENGINE_ROLLING_HANDOFF=on with no yield request changes nothing for
 *      live play, and the release-controlled run-spec carries the flag.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY (owner order 2026-11-19: "WE NEED TO STOP REQUIRING AN ENGINE CUT OVER
 * FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES.")
 * ------------------------------------------------------------------------
 * A rolling release needs the SERVING engine to already contain the handoff
 * code with the flag on, so the bootstrap is one ordinary classic release
 * whose run-spec (server/scripts/engine-up.sh) passes ENGINE_ROLLING_HANDOFF=on.
 * That engine then serves every table, all day, with the coordinator built and
 * nobody asking it to yield. This law proves that state is inert:
 *   - every guard GameServer reads answers "do nothing different" for every
 *     unit (no admission refused, no readmission suppressed, no arrival held,
 *     no lease loss classified as a transfer);
 *   - the adoption loop only reads the handed-leases list (empty) and never
 *     parks, retires, adopts, hands off, settles or even counts open moves;
 *   - the status stays serving with nothing in flight;
 *   - the flag is exactly `on` and the classic run-spec sets it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RollingHandoffCoordinator,
  type HandoffEnginePort,
  type HandoffUnit,
} from '../server/src/handoff/RollingHandoffCoordinator';
import { rollingHandoffEnabled } from '../server/src/handoff/rollingHandoffFlag';

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const units: HandoffUnit[] = [
  { scope: 'table', key: '11111111-1111-4111-8111-111111111111' },
  { scope: 'table', key: '22222222-2222-4222-8222-222222222222' },
  { scope: 'tournament', key: '33333333-3333-4333-8333-333333333333' },
];

function inertHarness() {
  const forbidden: string[] = [];
  const fail = (name: string) => () => {
    forbidden.push(name);
    throw new Error(`${name} must never run without a yield request`);
  };
  const port: HandoffEnginePort = {
    instanceId: '1795000000000-aaaaaaaa',
    version: 'serving',
    ownedUnits: () => units,
    eligibility: () => null,
    leaseGeneration: () => '44444444-4444-4444-8444-444444444444',
    parkAtNextBoundary: fail('parkAtNextBoundary'),
    releasePark: fail('releasePark'),
    boundaryState: fail('boundaryState') as never,
    fingerprint: fail('fingerprint') as never,
    retireYielded: fail('retireYielded') as never,
    adopt: fail('adopt') as never,
    releaseArrivalHold: fail('releaseArrivalHold'),
    holdsArrivalOf: () => true,
    activeNonUnitWork: () => null,
  };
  let handedReads = 0;
  const store = {
    handOff: fail('store.handOff') as never,
    handedTo: async () => {
      handedReads += 1;
      return [];
    },
    settle: fail('store.settle') as never,
    openHandoffs: fail('store.openHandoffs') as never,
  };
  const coordinator = new RollingHandoffCoordinator(port, store, { adoptPollMs: 2 });
  return { coordinator, forbidden, handedReads: () => handedReads };
}

describe('the rolling handoff flag with no yield request', () => {
  it('leaves every guard GameServer reads at its pre-flag answer', () => {
    const { coordinator, forbidden } = inertHarness();
    for (const unit of units) {
      expect(coordinator.refusesAdmission(unit)).toBe(false);
      expect(coordinator.suppressesReadmission(unit)).toBe(false);
      expect(coordinator.holdsArrival(unit)).toBe(false);
      expect(coordinator.isTransferring(unit)).toBe(false);
    }
    expect(forbidden).toEqual([]);
  });

  it('only reads the empty handed-leases list while it serves', async () => {
    const { coordinator, forbidden, handedReads } = inertHarness();
    coordinator.startAdoptionLoop();
    for (let i = 0; i < 20; i += 1) {
      await coordinator.adoptPass();
      await new Promise((r) => setTimeout(r, 3));
    }
    coordinator.stopAdoptionLoop();
    expect(handedReads()).toBeGreaterThan(0);
    expect(forbidden).toEqual([]);
    const status = coordinator.status();
    expect(status.mode).toBe('serving');
    expect(status.successor).toBeNull();
    expect(status.yields).toEqual([]);
    expect(status.adoptions).toEqual([]);
    expect(status.blockedRetirement).toBeNull();
    expect(status.owned).toBe(units.length);
  });

  it('is on only for exactly "on"', () => {
    expect(rollingHandoffEnabled({ ENGINE_ROLLING_HANDOFF: 'on' } as NodeJS.ProcessEnv)).toBe(true);
    for (const value of ['', 'true', 'ON', '1', 'yes'])
      expect(rollingHandoffEnabled({ ENGINE_ROLLING_HANDOFF: value } as NodeJS.ProcessEnv)).toBe(
        false
      );
    expect(rollingHandoffEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('is carried by the release-controlled classic run-spec, after the host env file', () => {
    const up = read('server/scripts/engine-up.sh');
    expect(up).toContain("ROLLING_HANDOFF_FLAG_ENV='ENGINE_ROLLING_HANDOFF=on'");
    const classic = up.slice(
      up.indexOf(
        'INCOMING_CONTAINER="${INCOMING_PREFIX}${AUTHORIZED_SHA:0:12}-$$"\nphase create-start'
      )
    );
    const envFile = classic.indexOf('--env-file "$ENV_FILE"');
    const flag = classic.indexOf('--env "$ROLLING_HANDOFF_FLAG_ENV"');
    expect(envFile).toBeGreaterThan(0);
    expect(flag).toBeGreaterThan(envFile);
    // The Backup copy runs with the flag too, so certification soaks the bootstrap state.
    expect(read('server/standby/standby-engine.sh')).toMatch(/^ENGINE_ROLLING_HANDOFF=on$/m);
  });
});
