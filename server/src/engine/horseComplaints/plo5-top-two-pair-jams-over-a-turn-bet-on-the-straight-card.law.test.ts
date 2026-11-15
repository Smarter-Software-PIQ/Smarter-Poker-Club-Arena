/**
 * Complaint law: PLO5 top two pair does not raise a turn bet on the card that made a straight possible
 *
 * The complaint, as it was made: "Horses must know straights beat two pair and sets; both should play defense or be more cautious when the straight card comes (owner ruling 2026-11-14, in substance)"
 *
 * Hand a23949c2-acf4-4299-9d81-303ee96fc1d1 (cash plo5), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (jam at decision 19) at any seed.
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
import FIXTURE from './plo5-top-two-pair-jams-over-a-turn-bet-on-the-straight-card.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
// The governing rule ships OFF (opt-in) until its paired evaluation passes
// (owner 2026-11-14 23:40: no default without the evidence), so this law
// replays the brain with the rule switched on; the control is the default.
const RULE_ON = { omahaBeatenMadeHandDefense: true };

describe('complaint law: PLO5 top two pair does not raise a turn bet on the card that made a straight possible', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('a23949c2-acf4-4299-9d81-303ee96fc1d1');
    expect(recordedPathMatches(FX)).toBe(true);
  });

  it('with the rule switched on the brain never takes the forbidden path at the real nodes, for any profile or seed', () => {
    expect(complaintPathHits(FX, RULE_ON)).toEqual([]);
  });

  it.skipIf(!FX.control)(
    'control: with the governing rule off, the replay takes the path again',
    () => {
      expect(complaintPathHits(FX, FX.control ?? {}).length).toBeGreaterThan(0);
    }
  );
});
