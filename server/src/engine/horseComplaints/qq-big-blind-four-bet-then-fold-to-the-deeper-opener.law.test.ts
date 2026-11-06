/**
 * Complaint law: QQ in the big blind 4-bets a 3-bet and folds to the deeper opener’s jam
 *
 * The complaint, as it was made: "The horse 4-bet QQ and then folded it to the jam (Phase 3 audit, hand d4ec1ccd, 2026-11-02)"
 *
 * Hand d4ec1ccd-bae9-47c7-9abc-b09ae2492667 (cash nlh), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (raise at decision 9, then fold at decision 12) at any seed.
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
import FIXTURE from './qq-big-blind-four-bet-then-fold-to-the-deeper-opener.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;

describe('complaint law: QQ in the big blind 4-bets a 3-bet and folds to the deeper opener’s jam', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('d4ec1ccd-bae9-47c7-9abc-b09ae2492667');
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
