/**
 * LAW - A SHORT PHONE KEEPS AN ABSOLUTE AVATAR FLOOR; A MID-PROOF PUBLISH IS NOT A DEFECT
 *
 * PostDeployVerificationIncomplete (2026-11-19) kept firing after the apt mirror
 * fix for two causes found in the live-table job:
 *  1. On a 320x568 phone (1065 layout px tall) a watched six-max table painted
 *     176.6-189.2px against the 191px spectator floor measured on 852px-tall
 *     phones. Dan's rule is "as large as they can be without overlapping
 *     anything": on a height-bound phone the fit keeps portraits clear of the
 *     dealer button below the 2.3 spectator scale. The spectator floor applies
 *     only where it fits; a short phone keeps the six-seat floor - absolute,
 *     never lower.
 *  2. The seat-move notice proof failed whenever a protected publish landed
 *     mid-proof (served build 5911065a -> 11bea616). That run certifies no
 *     build; it is a NON-VERDICT exactly as the release-window step classifies
 *     it - only on the named marker AND a confirmed forward publish.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHONE_AVATAR_MIN_HEIGHT_PX,
  SPECTATOR_PHONE_MIN_LAYOUT_HEIGHT_PX,
} from '../src/components/table/mobileAvatarSize';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('a short phone keeps an absolute avatar floor', () => {
  it('separates the measured short phone (1065) from every tall phone (>= 1189)', () => {
    expect(SPECTATOR_PHONE_MIN_LAYOUT_HEIGHT_PX).toBeGreaterThan(1065);
    expect(SPECTATOR_PHONE_MIN_LAYOUT_HEIGHT_PX).toBeLessThanOrEqual(1189);
  });

  it('the short-phone fallback floor is the six-seat floor, never lower', () => {
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.sixSeat).toBeGreaterThanOrEqual(175);
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.sixSeatSpectator).toBeGreaterThanOrEqual(191);
    const probe = read('tests/e2e/support/mobileLiveTableLayout.ts');
    expect(probe).toContain(
      'const tallEnough = innerHeight / ratio >= floors.spectatorMinLayoutHeight;'
    );
    expect(probe).toContain("const watching = page.dataset.hero === 'false' && tallEnough;");
    expect(probe).toContain(': floors.sixSeat;');
    expect(probe).toContain('spectatorMinLayoutHeight: SPECTATOR_PHONE_MIN_LAYOUT_HEIGHT_PX');
  });
});

describe('a publish during the seat-move proof is a non-verdict, not a defect', () => {
  const spec = read('tests/e2e/production-seat-move-announcement.spec.ts');
  const wf = read('.github/workflows/post-deploy-e2e.yml');
  const i = wf.indexOf('- name: Verify seat-move notices in the served spectator browser');
  const step = wf.slice(i, wf.indexOf('- name:', i + 10));

  it('the proof names the build change exactly', () => {
    expect(spec).toContain('PRODUCTION_ADVANCED_DURING_PROOF');
    expect(spec).not.toContain('expect(afterSynthetic).toEqual(evidence.before);');
  });

  it('the step stays a single attempt and classifies only on marker plus a confirmed forward publish', () => {
    expect(step).toContain('--retries=0');
    expect(step).not.toMatch(/--retries=[1-9]/);
    expect(step).toContain("grep -q 'PRODUCTION_ADVANCED_DURING_PROOF'");
    expect(step).toContain('production-e2e-provenance.mjs release-window "$EXPECTED_LIVE_SHA"');
    expect(step).toContain('[ "$WSTATUS" -eq 3 ]');
    expect(step).toContain(
      'node scripts/ci/assert-e2e-actually-ran.mjs e2e-report/seat-move-announcement.json'
    );
    expect(step.trimEnd().endsWith('exit "$STATUS"')).toBe(true);
  });
});
