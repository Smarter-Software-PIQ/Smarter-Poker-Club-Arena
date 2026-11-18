/**
 * Complaint law: Heads-up final table: the small blind folds 6h 3h 8s 3s first in at 13.4 big blinds
 *
 * The complaint, as it was made: "Owner order 2026-11-12 21:14 Chicago: a person won the PLO4 MTT; the Horse small blind folded its first action in 9 of 12 heads-up hands"
 *
 * Hand 1f534dc5-3ecc-4f53-baee-3c72a9726638 (tournament plo4), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (fold at decision 3) at any seed.
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
import FIXTURE from './plo4-heads-up-final-small-blind-folds-six-three-pair-at-thirteen-blinds.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;

describe('complaint law: Heads-up final table: the small blind folds 6h 3h 8s 3s first in at 13.4 big blinds', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('1f534dc5-3ecc-4f53-baee-3c72a9726638');
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
