/**
 * Complaint law: PLO5 set does not bet the river into the player who led the turn straight card
 *
 * The complaint, as it was made: "Horses must play defense or be more cautious when the straight card comes: no river value bet with a set into the player who led the straight card (owner ruling 2026-11-14, in substance)"
 *
 * Hand cef65c81-46d4-4366-a816-b51725cf045c (cash plo5), extracted read-only with
 * `horse-release-verify.py sql complaint-extract` and anonymised to seat
 * numbers by `horse-complaint-replay.ts --emit-law`. The fixture holds every
 * recorded action and the public table snapshot the engine recorded at every
 * horse decision. Today's brain is replayed EXACTLY at the real nodes for the
 * live hybrid profile of the format and every base style, over the fixture's
 * seeds, with opponent memory off so the replay is deterministic.
 *
 * The law: no profile takes the forbidden path (raise at decision 22) at any seed.
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
import FIXTURE from './plo5-set-bets-the-river-into-the-turn-leader.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
// The governing rule ships OFF (opt-in) until its paired evaluation passes
// (owner 2026-11-14 23:40: no default without the evidence), so this law
// replays the brain with the rule switched on; the control is the default.
const RULE_ON = { omahaBeatenMadeHandDefense: true };

describe('complaint law: PLO5 set does not bet the river into the player who led the turn straight card', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded hand, and the recorded hand took the forbidden path', () => {
    expect(FX.handId).toBe('cef65c81-46d4-4366-a816-b51725cf045c');
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
