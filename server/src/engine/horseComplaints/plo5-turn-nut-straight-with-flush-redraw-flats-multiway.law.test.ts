/**
 * Complaint law: PLO5 turn nut straight with a king-high flush redraw flat-calls a pot bet with a player behind
 *
 * The complaint, as it was made: "I JUST WATCHED THE HORSE ’NOODLE’ FLAT CALL A LARGE BET ON THE TURN OF 50 CHIPS, WITH THE NUTS, AND A KING HIGH FLUSH REDRAW, WITH ANOTHER PLAYER LEFT TO ACT STILL, INSTEAD OF RE RERAISING WITH FREE ROLL EQUITY?! WHY? HOW IS THAT PROFITABLE? HOW IS THAT NOT EXPLOITED??"
 *
 * Hand 63e5f760-62b8-4d8e-9594-57ac821a6495 (cash plo5), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (call at decision 21) at any seed.
 * When the fixture names a control (the decide() options that switch the
 * governing rule off), the same replay must take the path again, so the law
 * is not vacuous.
 *
 * Generated from scripts/horse-measure/templates/horse-complaint.law.test.ts.tmpl.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from '../HorseMind.js';
import {
  complaintPathHits,
  recordedPathMatches,
  type ComplaintFixture,
} from '../HorseComplaintReplay.js';
import FIXTURE from './plo5-turn-nut-straight-with-flush-redraw-flats-multiway.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
/** The live decision clock (decision journal identity.decisionTimeMs,
 * 2026-11-06 03:20:08.218 UTC): the horse's hourly mood reads it, so the
 * replay pins it. */
const CLOCK = 1793935208218;

describe('complaint law: PLO5 turn nut straight with a king-high flush redraw flat-calls a pot bet with a player behind', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('63e5f760-62b8-4d8e-9594-57ac821a6495');
    expect(recordedPathMatches(FX)).toBe(true);
  });

  it("today's brain never takes the forbidden path at the real nodes, for any profile or seed", () => {
    expect(complaintPathHits(FX, { decisionTimeMs: CLOCK })).toEqual([]);
  });

  it.skipIf(!FX.control)(
    'control: with the governing rule off, the replay takes the path again',
    () => {
      expect(
        complaintPathHits(FX, { ...(FX.control ?? {}), decisionTimeMs: CLOCK }).length
      ).toBeGreaterThan(0);
    }
  );
});
