/**
 * Complaint law: A PLO6 hand does not cold call a four-bet through the final all-in arithmetic while players can still raise behind
 *
 * The complaint, as it was made: "PLO6-AUDIT-005: a hijack cold called a four-bet for 40 percent of its stack through the all-in arithmetic with players still to act"
 *
 * Hand 0d1cddfa-aede-4db1-9b3d-eb77f7d55314 (cash plo6), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (call at decision 11) at any seed.
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
import FIXTURE from './plo6-cold-call-of-a-four-bet-with-action-behind.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;

describe('complaint law: A PLO6 hand does not cold call a four-bet through the final all-in arithmetic while players can still raise behind', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('0d1cddfa-aede-4db1-9b3d-eb77f7d55314');
    expect(recordedPathMatches(FX)).toBe(true);
  });

  it("today's brain never takes the forbidden path at the real nodes, for any profile or seed", () => {
    expect(complaintPathHits(FX)).toEqual([]);
  });

  it.skipIf(!FX.control)(
    'control: with the governing rule off, the replay takes the path again',
    () => {
      expect(complaintPathHits(FX, FX.control ?? {}).length).toBeGreaterThan(0);
    }
  );
});
