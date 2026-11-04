/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UNIT TESTS — PlayerStyleClassifier
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Tests the PURE decision-tree classifier:
 * - MIN_SAMPLE guard → 'unknown' for < 15 hands
 * - 8 archetype classifications based on VPIP/PFR/AF
 * - Confidence scaling (15 → 0.15, 100 → 1.0)
 * - getStyleLabel convenience method
 * - getStyleDefinitions returns all 9 styles
 */

import { describe, it, expect } from 'vitest';
import {
  gameLoosenessFactor,
  playerStyleClassifier,
  VARIANT_LOOSENESS,
} from '../../src/services/PlayerStyleClassifier';

describe('PlayerStyleClassifier', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // MIN SAMPLE GUARD
  // ─────────────────────────────────────────────────────────────────────────

  describe('insufficient sample', () => {
    it('should return "unknown" for < 15 hands', () => {
      const result = playerStyleClassifier.classify({
        handsPlayed: 10,
        vpipCount: 3,
        pfrCount: 2,
      });
      expect(result.style).toBe('unknown');
      expect(result.confidence).toBe(0);
      // Icons moved from emoji to letters 2026-08 (was '❓'); classification itself unchanged.
      expect(result.icon).toBe('?');
    });

    it('should return "unknown" for 0 hands', () => {
      const result = playerStyleClassifier.classify({
        handsPlayed: 0,
        vpipCount: 0,
        pfrCount: 0,
      });
      expect(result.style).toBe('unknown');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ARCHETYPE CLASSIFICATION
  // ─────────────────────────────────────────────────────────────────────────

  describe('archetype classification', () => {
    it('should classify Nit (VPIP < 12, PFR < 8)', () => {
      // VPIP = 10%, PFR = 5%
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 10,
        pfrCount: 5,
        aggressiveActions: 5,
        passiveActions: 10,
      });
      expect(result.style).toBe('nit');
      // Icons moved from emoji to letters 2026-08 (was '🧊'); classification itself unchanged.
      expect(result.icon).toBe('N');
    });

    it('should classify Rock (VPIP < 18, PFR < 10, AF < 2.0)', () => {
      // VPIP = 15%, PFR = 8%
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 15,
        pfrCount: 8,
        aggressiveActions: 10,
        passiveActions: 10, // AF = 1.0
      });
      expect(result.style).toBe('rock');
      // Icons moved from emoji to letters 2026-08 (was '🪨'); classification itself unchanged.
      expect(result.icon).toBe('R');
    });

    it('should classify Maniac (VPIP > 40, PFR > 25, AF > 2.5)', () => {
      // VPIP = 55%, PFR = 35%
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 55,
        pfrCount: 35,
        aggressiveActions: 30,
        passiveActions: 10, // AF = 3.0
      });
      expect(result.style).toBe('maniac');
      // Icons moved from emoji to letters 2026-08 (was '🔥'); classification itself unchanged.
      expect(result.icon).toBe('M');
    });

    it('should classify Calling Station (VPIP > 40, PFR < 12, AF < 1.5)', () => {
      // VPIP = 50%, PFR = 5%
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 50,
        pfrCount: 5,
        aggressiveActions: 5,
        passiveActions: 20, // AF = 0.25
      });
      expect(result.style).toBe('calling_station');
      // Icons moved from emoji to letters 2026-08 (was '📞'); 'CS' is the only 2-letter icon.
      expect(result.icon).toBe('CS');
    });

    it('should classify Fish (VPIP > 35, PFR < 15, AF < 2.0)', () => {
      // VPIP = 40%, PFR = 10%
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 40,
        pfrCount: 10,
        aggressiveActions: 10,
        passiveActions: 10, // AF = 1.0
      });
      expect(result.style).toBe('fish');
      // 2026-08-16: Fish and Shark were the last two emoji icons; the letter
      // migration had skipped them. Every badge is a letter now.
      expect(result.icon).toBe('F');
    });

    it('should classify Shark (VPIP 18-28, PFR 15-25, AF >= 2.5)', () => {
      // VPIP = 22%, PFR = 18%
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 22,
        pfrCount: 18,
        aggressiveActions: 30,
        passiveActions: 10, // AF = 3.0
      });
      expect(result.style).toBe('shark');
      expect(result.icon).toBe('S');
    });

    it('should classify LAG (VPIP > 28, PFR > 18, AF >= 2.0)', () => {
      // VPIP = 35%, PFR = 22%
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 35,
        pfrCount: 22,
        aggressiveActions: 20,
        passiveActions: 10, // AF = 2.0
      });
      expect(result.style).toBe('lag');
      // Icons moved from emoji to letters 2026-08 (was '💥'); classification itself unchanged.
      expect(result.icon).toBe('L');
    });

    it('should classify TAG (VPIP 15-28, PFR >= 10, AF >= 1.5)', () => {
      // VPIP = 22%, PFR = 15%
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 22,
        pfrCount: 15,
        aggressiveActions: 15,
        passiveActions: 10, // AF = 1.5
      });
      expect(result.style).toBe('tag');
      // Icons moved from emoji to letters 2026-08 (was '🎯'); classification itself unchanged.
      expect(result.icon).toBe('T');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // A RAISER IS NEVER A FISH (2026-11-04)
  // ─────────────────────────────────────────────────────────────────────────

  describe('a loose player who raises is never titled Fish', () => {
    it('reads Burls (34.3 / 17.1, AF 1.12 over 1,623 hands) as LAG, not Fish', () => {
      // The live KINGS CLUB cash figures that produced the "FISH" share card.
      const hands = 1623;
      const result = playerStyleClassifier.classify({
        handsPlayed: hands,
        vpipCount: Math.round(0.3432 * hands),
        pfrCount: Math.round(0.1707 * hands),
        aggressiveActions: Math.round(hands * 1.12),
        passiveActions: hands,
      });
      expect(result.style).toBe('lag');
    });

    it('never returns Fish for any VPIP when PFR is at least half of VPIP', () => {
      for (let vpip = 15; vpip <= 70; vpip += 1) {
        for (const af of [0.5, 1.0, 1.5, 1.9]) {
          const pfr = Math.ceil(vpip / 2);
          const result = playerStyleClassifier.classify({
            handsPlayed: 1000,
            vpipCount: vpip * 10,
            pfrCount: pfr * 10,
            aggressiveActions: Math.round(1000 * af),
            passiveActions: 1000,
          });
          expect(result.style, `vpip=${vpip} pfr=${pfr} af=${af}`).not.toBe('fish');
          expect(result.style, `vpip=${vpip} pfr=${pfr} af=${af}`).not.toBe('calling_station');
        }
      }
    });

    it('still reads a genuine loose-passive player as Fish', () => {
      // 38 / 9 with a middling AF: plays a lot, raises almost nothing.
      const result = playerStyleClassifier.classify({
        handsPlayed: 500,
        vpipCount: 190,
        pfrCount: 45,
        aggressiveActions: 600,
        passiveActions: 500, // AF = 1.2
      });
      expect(result.style).toBe('fish');
    });

    it('reads a loose player who raises a third of his hands with low AF as Fish', () => {
      // 36 / 12 (ratio 0.33): loose and mostly calling.
      const result = playerStyleClassifier.classify({
        handsPlayed: 500,
        vpipCount: 180,
        pfrCount: 60,
        aggressiveActions: 400,
        passiveActions: 500, // AF = 0.8
      });
      expect(result.style).toBe('fish');
    });

    it('lands every (vpip, pfr) pair with pfr <= vpip in exactly one named style', () => {
      for (let vpip = 0; vpip <= 100; vpip += 5) {
        for (let pfr = 0; pfr <= vpip; pfr += 5) {
          const result = playerStyleClassifier.classify({
            handsPlayed: 1000,
            vpipCount: vpip * 10,
            pfrCount: pfr * 10,
            aggressiveActions: 1200,
            passiveActions: 1000,
          });
          expect(result.style).not.toBe('unknown');
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GAME-AWARE, EXPLAINED, AND SHAREABLE OR NOT (2026-11-04)
  // ─────────────────────────────────────────────────────────────────────────

  describe('game-aware ranges', () => {
    const base = { handsPlayed: 1000, aggressiveActions: 1300, passiveActions: 1000 };

    it("judges a PLO range against PLO: 36/19 in PLO is TAG, in Hold'em it is LAG", () => {
      const plo = playerStyleClassifier.classify({
        ...base,
        vpipCount: 360,
        pfrCount: 190,
        variantHands: [{ variant: 'plo', hands: 1000 }],
      });
      const nlh = playerStyleClassifier.classify({
        ...base,
        vpipCount: 360,
        pfrCount: 190,
        variantHands: [{ variant: 'nlh', hands: 1000 }],
      });
      expect(plo.style).toBe('tag');
      expect(nlh.style).toBe('lag');
    });

    it('weights a mixed game list by hands', () => {
      expect(
        gameLoosenessFactor([
          { variant: 'nlh', hands: 500 },
          { variant: 'plo', hands: 500 },
        ])
      ).toBeCloseTo(1.15, 5);
      expect(gameLoosenessFactor([{ variant: 'PLO6', hands: 10 }])).toBe(1.5);
      expect(gameLoosenessFactor([{ variant: 'mystery_game', hands: 10 }])).toBe(1);
      expect(gameLoosenessFactor(undefined)).toBe(1);
      expect(gameLoosenessFactor([])).toBe(1);
    });

    it('never lets a game factor turn a raiser into a Fish', () => {
      for (const variant of Object.keys(VARIANT_LOOSENESS)) {
        const result = playerStyleClassifier.classify({
          ...base,
          vpipCount: 400,
          pfrCount: 220,
          variantHands: [{ variant, hands: 1000 }],
        });
        expect(result.style, variant).not.toBe('fish');
      }
    });
  });

  describe('the reason line', () => {
    it('states the arithmetic in Title Case with no em dash', () => {
      const hands = 1623;
      const result = playerStyleClassifier.classify({
        handsPlayed: hands,
        vpipCount: Math.round(0.3432 * hands),
        pfrCount: Math.round(0.1707 * hands),
        aggressiveActions: Math.round(hands * 1.12),
        passiveActions: hands,
      });
      expect(result.reason).toBe('Plays 34% Of Hands, Raises About Half Of Them');
      expect(result.reason).not.toContain('\u2014');
    });

    it('names the game when the range was judged against it', () => {
      const result = playerStyleClassifier.classify({
        handsPlayed: 1000,
        vpipCount: 360,
        pfrCount: 190,
        aggressiveActions: 1300,
        passiveActions: 1000,
        variantHands: [{ variant: 'plo5', hands: 1000 }],
      });
      expect(result.reason).toContain('(Normal For PLO5)');
    });
  });

  describe('shareable titles', () => {
    it('only Shark, TAG and LAG go on the share image', () => {
      const defs = playerStyleClassifier.getStyleDefinitions();
      const shareable = Object.entries(defs)
        .filter(([, d]) => d.shareable)
        .map(([k]) => k)
        .sort();
      expect(shareable).toEqual(['lag', 'shark', 'tag']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIDENCE SCALING
  // ─────────────────────────────────────────────────────────────────────────

  describe('confidence', () => {
    it('should have 0.15 confidence at 15 hands', () => {
      const result = playerStyleClassifier.classify({
        handsPlayed: 15,
        vpipCount: 1,
        pfrCount: 0,
        aggressiveActions: 0,
        passiveActions: 5,
      });
      expect(result.confidence).toBe(0.15);
    });

    it('should have 0.5 confidence at 50 hands', () => {
      const result = playerStyleClassifier.classify({
        handsPlayed: 50,
        vpipCount: 5,
        pfrCount: 3,
        aggressiveActions: 5,
        passiveActions: 5,
      });
      expect(result.confidence).toBe(0.5);
    });

    it('should cap at 1.0 confidence at 100+ hands', () => {
      const result = playerStyleClassifier.classify({
        handsPlayed: 200,
        vpipCount: 20,
        pfrCount: 10,
        aggressiveActions: 10,
        passiveActions: 10,
      });
      expect(result.confidence).toBe(1.0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EDGE CASES: AF CALCULATION
  // ─────────────────────────────────────────────────────────────────────────

  describe('AF edge cases', () => {
    it('should handle zero passiveActions (AF defaults to 5 when aggressiveActions > 0)', () => {
      // VPIP = 50%, PFR = 30%, AF = 5 (aggressive but no passive)
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 50,
        pfrCount: 30,
        aggressiveActions: 20,
        passiveActions: 0, // AF = 5
      });
      expect(result.style).toBe('maniac');
    });

    it('should handle zero aggressiveActions AND zero passiveActions (AF = 1)', () => {
      const result = playerStyleClassifier.classify({
        handsPlayed: 100,
        vpipCount: 10,
        pfrCount: 5,
        aggressiveActions: 0,
        passiveActions: 0, // AF = 1
      });
      // VPIP = 10%, PFR = 5% → nit (VPIP < 12, PFR < 8)
      expect(result.style).toBe('nit');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CONVENIENCE METHODS
  // ─────────────────────────────────────────────────────────────────────────

  describe('getStyleLabel', () => {
    it('should return "icon label" format', () => {
      const label = playerStyleClassifier.getStyleLabel({
        handsPlayed: 100,
        vpipCount: 22,
        pfrCount: 18,
        aggressiveActions: 30,
        passiveActions: 10,
      });
      expect(label).toBe('S Shark');
    });

    it('should return "? ?" for insufficient data', () => {
      const label = playerStyleClassifier.getStyleLabel({
        handsPlayed: 5,
        vpipCount: 1,
        pfrCount: 0,
      });
      // Unknown icon moved from '❓' to '?' 2026-08, so the label is now '? ?'.
      expect(label).toBe('? ?');
    });
  });

  describe('getStyleDefinitions', () => {
    it('should return all 9 style definitions', () => {
      const defs = playerStyleClassifier.getStyleDefinitions();
      expect(Object.keys(defs).length).toBe(9);
      // 2026-08-16: every icon is now a letter. Shark and Fish were the last
      // two emoji left over from the 2026-08 migration; unknown had already
      // moved from the emoji question mark to a plain '?'.
      expect(defs.shark.icon).toBe('S');
      expect(defs.fish.icon).toBe('F');
      expect(defs.unknown.icon).toBe('?');
      expect(defs.rock.icon).toBe('R');
      expect(defs.maniac.icon).toBe('M');
      expect(defs.tag.icon).toBe('T');
      expect(defs.lag.icon).toBe('L');
      expect(defs.nit.icon).toBe('N');
      expect(defs.calling_station.icon).toBe('CS');
    });

    it('should return a copy (not mutate original)', () => {
      const defs1 = playerStyleClassifier.getStyleDefinitions();
      const defs2 = playerStyleClassifier.getStyleDefinitions();
      expect(defs1).not.toBe(defs2);
      expect(defs1).toEqual(defs2);
    });
  });
});
