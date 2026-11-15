/**
 * Complaint law: PLO5 set does not raise a pot-sized turn lead on the card that made straights possible
 *
 * The complaint, as it was made: "Horses must know straights beat two pair and sets; raising the turn there is a clear call only (owner ruling 2026-11-14, in substance)"
 *
 * Hand cef65c81-46d4-4366-a816-b51725cf045c (cash plo5), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (raise at decision 19) at any seed.
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
import FIXTURE from './plo5-set-raises-a-pot-turn-lead-on-the-straight-card.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
// The governing rule ships OFF (opt-in) until its paired evaluation passes
// (owner 2026-11-14 23:40: no default without the evidence), so this law
// replays the brain with the rule switched on; the control is the default.
const RULE_ON = { omahaBeatenMadeHandDefense: true };

describe('complaint law: PLO5 set does not raise a pot-sized turn lead on the card that made straights possible', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('cef65c81-46d4-4366-a816-b51725cf045c');
    expect(recordedPathMatches(FX)).toBe(true);
  });

  it('with the rule switched on the brain never takes the forbidden path at the real nodes, for any profile or seed', () => {
    expect(complaintPathHits(FX, RULE_ON)).toEqual([]);
  });

  // Added by hand to the generated law: the recorded raise needs the opponent
  // memory present (with it off this node already called before the rule
  // existed), so the law above is only half of it. With the memory on and
  // empty, where the raise came from, no profile raises either. This is the
  // assertion that fails on the source before the rule.
  it('with the opponent memory on, where the recorded raise came from, no profile raises either', () => {
    expect(complaintPathHits(FX, { ...RULE_ON, mind: true })).toEqual([]);
  });

  it.skipIf(!FX.control)(
    'control: with the governing rule off, the replay takes the path again',
    () => {
      expect(complaintPathHits(FX, FX.control ?? {}).length).toBeGreaterThan(0);
    }
  );
});
