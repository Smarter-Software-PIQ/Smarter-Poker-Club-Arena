/**
 * Complaint law: QQ opens and folds to a 22bb all-in 3-bet getting 43 percent
 *
 * The complaint, as it was made: "When a horse opens and is 3-bet or 4-bet it almost always folds (owner report 2026-11-08); live hand 7ee5da8f"
 *
 * Hand 7ee5da8f-1db6-4325-96da-61ce32c5fb62 (tournament nlh), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (fold at decision 11) at any seed.
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
import FIXTURE from './qq-opener-folds-to-an-all-in-3-bet.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;

describe('complaint law: QQ opens and folds to a 22bb all-in 3-bet getting 43 percent', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('7ee5da8f-1db6-4325-96da-61ce32c5fb62');
    expect(recordedPathMatches(FX)).toBe(true);
  });

  it("today's brain never takes the forbidden path at the real nodes, for any profile or seed", () => {
    expect(complaintPathHits(FX)).toEqual([]);
  });

  it.skipIf(!FX.control)('control: with the governing rule off, the replay takes the path again', () => {
    expect(complaintPathHits(FX, FX.control ?? {}).length).toBeGreaterThan(0);
  });
});
