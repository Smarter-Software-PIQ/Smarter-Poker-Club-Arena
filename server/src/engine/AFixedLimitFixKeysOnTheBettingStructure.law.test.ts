/**
 * LAW: THE FIXED-LIMIT HORSE FIXES KEY ON THE BETTING STRUCTURE, NOT ON THE
 * VARIANT NAME (2026-11-15, Fixed-Limit lane).
 *
 * Fixed-limit Omaha in 4, 5 and 6 cards (flo4, flo5, flo6) is being added by
 * another pull request (#10865, open). Main cannot deal flo4, so the spot here
 * is the nearest thing main can build: a real HandController deals a
 * four-card fixed-limit Omaha table (the flo8 deal and betting), and the brain
 * is shown it as plo4 card rules (no low half) or plo8 card rules (hi-lo) with
 * the betting structure the controller reports, fixed_limit. Neither variant
 * name is fixed limit by itself (bettingStructureFor('plo4') is pot_limit), so
 * a fix that keyed on 'flh' or 'flo8' would stay off here.
 *
 * Law: F2 (fixedLimitCallIsNotACommitment) engages on the four-card
 * fixed-limit state shown as plo4, and F3 (fixedLimitHiLoLowHalfFloor) on
 * the hi-lo one shown as plo8, exactly as at flo8; a real pot-limit plo4
 * table with F2 on never engages it. F1 and the read-time guard (F1b) are
 * pinned on the same plo4 fixed-limit state in
 * AFixedLimitReadIsNeverProbeDiscounted.law.test.ts.
 *
 * Production note: the decision worker refuses a state whose bettingStructure
 * differs from bettingStructureFor(gameVariant), so a live flo4 table reaches
 * these fixes once #10865 adds flo4, flo5 and flo6 to the fixed-limit set in
 * BettingStructure.ts; every fix reads that structure, none names a variant.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { decideSpot, fixedLimitRiverFacingOneBet } from './FixedLimitRiverCallSpot.test-support.js';
import type { Table } from './HuVariantSpot.test-support.js';

const F2 = { fixedLimitCallIsNotACommitment: true } as const;
const F3 = { fixedLimitHiLoLowHalfFloor: true } as const;
const continues = (a: string) => a !== 'fold';

/** The same dealt table, shown to the brain under another variant's card rules. */
const shownAs = (t: Table, variant: string): Table => ({ ...t, variant });

afterEach(() => HorseMind.reset());

describe('the fixed-limit fixes key on the betting structure', () => {
  it('the spot: a four-card fixed-limit table shown as plo4 card rules carries structure fixed_limit', () => {
    const t = fixedLimitRiverFacingOneBet({ variant: 'flo8', seats: 6, stack: 40, seed: 1 })!;
    const { gs } = decideSpot(shownAs(t, 'plo4'), 501);
    expect(gs.gameVariant).toBe('plo4');
    expect(gs.bettingStructure).toBe('fixed_limit');
    expect(gs.variantRules).toMatchObject({ holeCardsDealt: 4, splitLow8OrBetter: false });
    expect(Number(gs.fixedBetSize)).toBeGreaterThan(0);
  }, 120_000);

  it('F2: a fixed-limit call is not a commitment on plo4 card rules with fixed-limit betting', () => {
    enableBrainTelemetry();
    let fired = 0;
    const rows: Array<{ seed: number; short: string; deep: string }> = [];
    for (let seed = 1; seed <= 12; seed++) {
      const short = fixedLimitRiverFacingOneBet({ variant: 'flo8', seats: 6, stack: 40, seed });
      const deep = fixedLimitRiverFacingOneBet({ variant: 'flo8', seats: 6, stack: 1000, seed });
      if (!short || !deep) continue;
      const on = withDecisionFireScope(() =>
        decideSpot(shownAs(short, 'plo4'), 500 + seed, { ...F2, telemetry: true })
      );
      if (on.fired.has('fixed_limit_call_not_a_commitment_seen')) fired++;
      const d = decideSpot(shownAs(deep, 'plo4'), 500 + seed, F2);
      rows.push({ seed, short: on.value.d.action, deep: d.d.action });
      const t2 = fixedLimitRiverFacingOneBet({ variant: 'flo8', seats: 6, stack: 40, seed })!;
      const off = withDecisionFireScope(() =>
        decideSpot(shownAs(t2, 'plo4'), 500 + seed, { telemetry: true })
      );
      expect(off.fired.has('fixed_limit_call_not_a_commitment_seen')).toBe(false);
    }
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(fired).toBeGreaterThan(0);
    // With F2 on the short stack continues exactly where the deep stack does.
    for (const r of rows)
      expect(continues(r.short), `seed ${r.seed}: short ${r.short}, deep ${r.deep}`).toBe(
        continues(r.deep)
      );
  }, 240_000);

  it('F2 stays off at a real pot-limit plo4 table', () => {
    enableBrainTelemetry();
    let decided = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const t = fixedLimitRiverFacingOneBet({
        variant: 'plo4' as 'flo8',
        seats: 6,
        stack: 40,
        seed,
      });
      if (!t) continue;
      const on = withDecisionFireScope(() => decideSpot(t, 500 + seed, { ...F2, telemetry: true }));
      expect(on.value.gs.bettingStructure).toBe('pot_limit');
      expect(on.fired.has('fixed_limit_call_not_a_commitment_seen')).toBe(false);
      expect(on.fired.has('fixed_limit_call_priced_remaining_action_seen')).toBe(false);
      decided++;
    }
    expect(decided).toBeGreaterThan(0);
  }, 120_000);

  it('F3: the hi-lo low half is kept on plo8 card rules with fixed-limit betting', () => {
    enableBrainTelemetry();
    const spot = () =>
      shownAs(
        fixedLimitRiverFacingOneBet({
          variant: 'flo8',
          seats: 2,
          stack: 40,
          deck: 'Ac 2d 9h 9s Kc Kh Js Ts Kd Qs 7c 4h 3d',
          hero: 1,
        })!,
        'plo8'
      );
    for (let s = 0; s < 4; s++) {
      const on = withDecisionFireScope(() =>
        decideSpot(spot(), 300 + s * 13, { ...F3, telemetry: true })
      );
      expect(on.value.gs.bettingStructure).toBe('fixed_limit');
      expect(on.value.gs.variantRules).toMatchObject({ splitLow8OrBetter: true });
      expect(on.fired.has('fixed_limit_hilo_low_half_kept_seen')).toBe(true);
      expect(on.value.d.action).not.toBe('fold');
      const off = withDecisionFireScope(() =>
        decideSpot(spot(), 300 + s * 13, { telemetry: true })
      );
      expect(off.fired.has('fixed_limit_hilo_low_half_kept_seen')).toBe(false);
    }
  }, 120_000);
});
