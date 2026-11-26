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
 *
 * 2026-11-26, the same rule for the full ring. The reconnect witness of the
 * live proof runs on Playwright's iPhone 13 profile: a 390x664 viewport with
 * the browser bars showing, 1021 layout px tall, shorter than the 320x568
 * phone the 140px full-ring floor was measured on. The full-ring felt is
 * `min(88%, height budget * 0.725)` wide, so on that page it is height-bound
 * and narrower, and a portrait (a fixed share of the felt: rail bust 1.7 on a
 * slot 0.158 of the felt's width) painted 132.1px on every chair, on every
 * run that found a full-ring table. Nothing had shrunk it. That page keeps
 * its own measured floor; the 320x568 phone and every taller one keep 140.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { devices } from 'playwright-core';
import {
  NINE_SEAT_PHONE_MIN_LAYOUT_HEIGHT_PX,
  NINE_SEAT_PHONE_RAIL_BUST,
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

describe('a full-ring page too short for the whole felt keeps its own absolute floor', () => {
  /** A phone table is laid out 600px wide, so a viewport's layout height is: */
  const layoutHeight = (viewport: { width: number; height: number }) =>
    (viewport.height * 600) / viewport.width;

  it('the cause: the full-ring felt, and every portrait on it, narrows with the height budget', () => {
    // The felt is 88% of the 600px layout (528px) only where the budget
    // allows; below that its width follows the height.
    expect(read('src/pages/TablePage.css')).toMatch(
      /\.table-page\[data-seats='9'\] \.table-scaler \{\s*width: min\(88%, calc\(var\(--sp-table-h, 100svh\) \* 0\.725\)\);/
    );
    // A chair slot is a fixed share of that width, and the rail bust is a
    // fixed multiple of the slot: the portrait is a share of the felt.
    const seat = read('src/components/table/SeatSlot.css');
    expect(seat).toContain(
      '--seat-avatar-full: clamp(50px, calc(var(--table-w, 360px) * 0.158), 124px);'
    );
    expect(seat).toContain('--sp-bust-scale: var(--sp-seat-rail-bust, 1.7);');
    expect(NINE_SEAT_PHONE_RAIL_BUST).toBeGreaterThanOrEqual(1.7);
  });

  it('the witness device is in the height-bound class; the measured 320x568 phone and every taller one are not', () => {
    const witness = read('playwright.config.ts');
    const project = witness.slice(witness.indexOf("name: 'webkit-live-table-realtime'"));
    expect(project.slice(0, project.indexOf('},'))).toContain("...devices['iPhone 13'],");
    // 390x664 with the browser bars showing: 1021 layout px.
    expect(layoutHeight(devices['iPhone 13'].viewport)).toBeLessThan(
      NINE_SEAT_PHONE_MIN_LAYOUT_HEIGHT_PX
    );
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 375, height: 852 },
      { width: 393, height: 852 },
      { width: 430, height: 852 },
    ])
      expect(layoutHeight(viewport)).toBeGreaterThanOrEqual(NINE_SEAT_PHONE_MIN_LAYOUT_HEIGHT_PX);
    // The physical-phone cases of the live proof are exactly those four.
    expect(read('tests/e2e/support/mobileLiveTableLayout.ts')).toContain(
      'await changeViewport({ width, height: width === 320 ? 568 : 852 });'
    );
  });

  it('both full-ring floors are absolute and neither is lowered', () => {
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponent).toBeGreaterThanOrEqual(140);
    // Measured on production at 1021 layout px: 132.1 on every chair.
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponentHeightBound).toBeGreaterThanOrEqual(132);
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponentHeightBound).toBeLessThanOrEqual(
      PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponent
    );
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatHero).toBeGreaterThanOrEqual(187);
  });

  it('the live proof applies the height-bound floor only to full-ring opponents on the short page', () => {
    const probe = read('tests/e2e/support/mobileLiveTableLayout.ts');
    expect(probe).toContain(
      'const nineHeightBound = innerHeight / ratio < floors.nineSeatMinLayoutHeight;'
    );
    expect(probe).toContain('nineSeatMinLayoutHeight: NINE_SEAT_PHONE_MIN_LAYOUT_HEIGHT_PX');
    expect(probe.replace(/\s+/g, ' ')).toContain(
      'const floor = nine ? hero ? floors.nineSeatHero : nineHeightBound ? floors.nineSeatOpponentHeightBound : floors.nineSeatOpponent : watching ? floors.sixSeatSpectator : floors.sixSeat;'
    );
    // The floor is never a share of anything measured on the page.
    expect(probe.match(/nineSeatOpponentHeightBound/g)).toHaveLength(1);
  });

  it('the fixture mounts a height-bound full ring and holds it to that floor', () => {
    const cases = read('tests/e2e/support/mobileAvatarSizingCases.ts');
    const height = Number(cases.match(/layoutHeight: (\d+),/)?.[1]);
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(NINE_SEAT_PHONE_MIN_LAYOUT_HEIGHT_PX);
    expect(cases).toContain("expect(bound.felt, 'the felt is height-bound on this page')");
    expect(cases).toContain('PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponentHeightBound');
    expect(cases).toContain(
      "expect(bound.limited, 'no chair carries a limit of its own').toBe(0);"
    );
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
