/**
 * Complaint law: A PLO6 opener does not price a four-bet call as a final all-in while players can still raise behind
 *
 * The complaint, as it was made: "PLO6-AUDIT-005: the opener called a four-bet for half its stack through the all-in arithmetic, priced heads-up against the four-bettor, with the three-bettor and a cold caller still to act"
 *
 * Hand 6dc5eff8-d53b-4d96-b44c-af8548b1e1d6 (cash plo6), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (call at decision 10) at any seed.
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
import FIXTURE from './plo6-opener-calls-a-four-bet-for-half-its-stack-with-action-behind.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;

describe('complaint law: A PLO6 opener does not price a four-bet call as a final all-in while players can still raise behind', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('6dc5eff8-d53b-4d96-b44c-af8548b1e1d6');
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
