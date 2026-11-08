/**
 * Complaint law: KK 3-bets and folds to a sized 4-bet 121bb deep in cash
 *
 * The complaint, as it was made: "When a horse opens and is 3-bet or 4-bet it almost always folds (owner report 2026-11-08); live hand d481b609"
 *
 * Hand d481b609-db1a-4754-bac9-30fecdf163a9 (cash nlh), extracted read-only with
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
import FIXTURE from './kk-three-bettor-folds-to-a-4-bet.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;

describe('complaint law: KK 3-bets and folds to a sized 4-bet 121bb deep in cash', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('d481b609-db1a-4754-bac9-30fecdf163a9');
    expect(recordedPathMatches(FX)).toBe(true);
  });

  it("today's brain never takes the forbidden path at the real nodes, for any profile or seed", () => {
    expect(complaintPathHits(FX)).toEqual([]);
  });

  it.skipIf(!FX.control)('control: with the governing rule off, the replay takes the path again', () => {
    expect(complaintPathHits(FX, FX.control ?? {}).length).toBeGreaterThan(0);
  });
});
