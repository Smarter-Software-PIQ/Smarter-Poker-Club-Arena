/**
 * LAW (ledger L-017, 2026-11-15). RED on the host before the fix in
 * LightningHandHost.offerHorseEarlyLooks, green with it.
 *
 * THE DEFECT. LightningHandHost.offerHorseEarlyLooks started a Horse big blind's
 * preflop early look at the first raise, while the seats between the raiser and
 * the big blind are still to act, and priced it "as if to act now"
 * (getAuthoritativeActionState asIfToAct). A fold there goes through the
 * Lightning Fold door, the seat leaves the hand and the held fold is published
 * at its turn without asking again: the big blind never sees the callers that
 * improve its price. Probe evidence (development seeds, PROBES.md Q1): in
 * hold'em the same policy, asked on the real turn, defends in about 10% of
 * these final early folds (31% when callers came in), about 2 big-blind VPIP
 * points; in PLO4 / PLO5 in none of 467.
 *
 * THE CORRECT BEHAVIOUR pinned here: the big blind's PREFLOP early look is not
 * offered while a seat between the last raiser and the big blind is still to
 * act. The big blind then decides once, on its own turn, at its real price
 * (the callers in), and that decision is executed. Other early looks (any seat
 * at the deal, any later street) are outside this test.
 *
 * The lane is scripted (as in AHorseThatIsAlreadyFoldingFoldsRightAway): an
 * early look answers fold, the turn answers call, so the test is about timing
 * and never about the brain's cards.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the Lightning host fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the Lightning host fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), describeError: String }));

const { hosts, sixHandedOpenThenTwoCalls } = await import('./bigBlindLookScenario.test-support.js');
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.abort('test_complete').catch(() => undefined);
  vi.useRealTimers();
});

describe("a Horse big blind's preflop look waits for its price (L-017)", () => {
  it('is not asked an early look while seats between the raiser and the big blind are still to act', async () => {
    const { asked } = await sixHandedOpenThenTwoCalls();
    const premature = asked.filter((a) => a.early && a.stillToAct.length > 0);
    expect(premature, JSON.stringify(asked)).toEqual([]);
  });

  it('decides once, on its own turn, at the price the two callers made, and that answer stands', async () => {
    const { t, bbId, asked, bbPreflop } = await sixHandedOpenThenTwoCalls();
    // Its first preflop answer is asked on the turn: nobody left to act, two
    // callers in (pot 1 + 2 + ante 2 + 3 x 6 = 23, 4 to call).
    expect(asked[0], JSON.stringify(asked)).toMatchObject({
      early: false,
      stillToAct: [],
      toCall: 4,
      pot: 23,
    });
    // ... and the answer it gave there is what the hand records.
    expect(bbPreflop).toEqual(['call']);
    expect(t.calls.fastFold.filter((f) => f.playerId === bbId)).toEqual([]);
  });
});
