/**
 * Complaint law: PLO5 top set does not raise a full-pot river lead on a board with three possible straights
 *
 * The complaint, as it was made: "Facing a full-pot river lead on a board where straights are possible, a Horse without the nuts must never raise; it should lean toward folding and at most call (owner ruling 2026-11-14, in substance)"
 *
 * Hand 754bce1c-6572-4803-8441-f120e0c1e2d9 (cash plo5), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (jam at decision 23) at any seed.
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
import FIXTURE from './plo5-top-set-jams-over-a-pot-river-lead.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;

describe('complaint law: PLO5 top set does not raise a full-pot river lead on a board with three possible straights', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('754bce1c-6572-4803-8441-f120e0c1e2d9');
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
