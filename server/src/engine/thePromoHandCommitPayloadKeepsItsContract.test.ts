/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PROMO HAND-COMMIT PAYLOAD KEEPS ITS CONTRACT (2026-11-24, BINDING)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Promo Play Through reads the accepted hand's payload inside the hand's own
 * transaction: p_stacks (user_id, stack, stack_before) and
 * _accepted_post_commit_facts (contributions, returned_uncalled, insurance).
 * On 2026-11-17 an engine-side change to what those numbers mean (a
 * between-hand add-on rebased the written stack) refused every tournament
 * hand that straddled an add-on. The promo proofs could not see it: they
 * hand-write their payloads and do not run on engine changes.
 *
 * The payload therefore has one written contract,
 * scripts/ci/fixtures/promo-hand-commit-payload/contract.json. This file
 * drives the real settlement path (postHandTasks, with the database call
 * mocked at logHandHistory) on the contract's fixture hand and requires the
 * engine to emit exactly the contract's golden payload, key for key and value
 * for value. Add, drop or rename a field, or change what one means, and this
 * goes red until the contract changes. The contract is a promo input, so that
 * change runs every promo proof, and scripts/ci/test-promo-custody.py feeds
 * the same golden payload through the real promo capture.
 *
 * The meanings are also asserted from the poker itself, independently of the
 * golden values:
 *   - the stack change is what a seat won minus what it left at risk, so
 *     contributions are NET of the uncalled return;
 *   - contributions add up to the pot;
 *   - HandController takes an uncalled return off totalInvested (the source
 *     of contributions) and keeps it separately as returnedUncalled.
 * The promo readers subtracted returned_uncalled a second time from
 * 2026-11-16 (274 production rows, 21% of cash-hand funding rows;
 * migration 20261124180000 fixes them). That is the class this file closes.
 *
 * A Horse is a player (CLAUDE.md 10.5): Bob is a Horse and nothing below
 * treats him differently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  obligations: vi.fn(),
  leaves: vi.fn(),
  recount: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('../services/supabase.js', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../services/supabase.js')),
  logHandHistory: mocks.commit,
  processHandPostCommitObligations: mocks.obligations,
  processLeavePending: mocks.leaves,
  reconcileTableSeatCount: mocks.recount,
}));
vi.mock('../services/financialAlerts.js', () => ({
  raiseFinancialAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/errorReporter.js', () => ({
  reportError: vi.fn(),
  describeError: (error: unknown) => String(error),
}));
import { ServerTableEngine } from './ServerTableEngine.js';
import { HandController } from './HandController.js';
import { supabase } from '../services/supabase/client.js';
import type { HandConfig, HandEvent, SeatPlayer } from '../types.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
type FixturePlayer = {
  user_id: string;
  seat_id: string;
  seat_number: number;
  is_horse: boolean;
  dealt: number;
  ending: number;
  contributed: number;
  returned_uncalled: number;
  won: number;
};
const CONTRACT = JSON.parse(
  readFileSync(join(REPO, 'scripts/ci/fixtures/promo-hand-commit-payload/contract.json'), 'utf8')
) as {
  promo_reads: Record<string, { p_stacks: string[]; facts: string[] }>;
  fixture: {
    table_id: string;
    seated_joined_at: string;
    players: FixturePlayer[];
    pot: number;
  };
  golden: {
    p_stacks: Array<Record<string, unknown>>;
    accepted_post_commit_facts: Record<string, unknown>;
  };
};
const FIX = CONTRACT.fixture;

function engineOnTheFixtureHand(tournament: boolean) {
  const engine = new ServerTableEngine(FIX.table_id) as any;
  engine.tableInfo = {
    id: FIX.table_id,
    club_id: 'c0000000-0000-0000-0000-000000000001',
    tournament_id: tournament ? '70000000-0000-0000-0000-000000000001' : null,
    game_variant: 'nlh',
    small_blind: 1,
    big_blind: 2,
    max_players: 6,
    min_buy_in: 20,
    max_buy_in: 200,
  };
  const players = FIX.players.map((p) => ({
    user_id: p.user_id,
    seat_number: p.seat_number,
    is_horse: p.is_horse,
    seat_id: p.seat_id,
    seat_joined_at: FIX.seated_joined_at,
    stack: p.ending,
  }));
  engine.seatedPlayers = players;
  engine.handCount = 1000700;
  engine.currentHandVariant = 'nlh';
  engine.currentHandPotSize = FIX.pot;
  engine.currentHandRake = 0;
  engine.currentHandBBJFee = 0;
  engine.currentHandInsuranceNet = 0;
  engine.currentHandContributions = new Map(FIX.players.map((p) => [p.user_id, p.contributed]));
  engine.currentHandReturnedUncalled = new Map(
    FIX.players.filter((p) => p.returned_uncalled > 0).map((p) => [p.user_id, p.returned_uncalled])
  );
  engine.currentHandDealtStacks = new Map(FIX.players.map((p) => [p.user_id, p.dealt]));
  engine.currentHandSawFlopForMoney = false;
  engine.currentHandSeatGenerations = new Map(
    players.map((p) => [p.user_id, { seat_id: p.seat_id, seat_joined_at: p.seat_joined_at }])
  );
  engine.currentHandWinners = FIX.players
    .filter((p) => p.won > 0)
    .map((p) => ({ userId: p.user_id, amount: p.won }));
  engine.currentHandStartedAt = Date.now() - 1000;
  engine.lifecycleCanMutate = () => true;
  engine.hasCurrentEngineLeaseAuthority = () => true;
  engine.getEngineLeaseAuthority = () => ({
    verified: true,
    generation: 'generation',
    scope: tournament ? 'tournament' : 'cash',
  });
  engine.finishTerminalBoundaryPersistence = vi.fn();
  engine.announceEnvelopeResolvedAddOns = vi.fn().mockResolvedValue(undefined);
  engine.executePendingSeatMoves = vi.fn().mockResolvedValue(undefined);
  engine.wakeClusterGame = vi.fn();
  engine.killForRestart = vi.fn();
  engine.hub = { emitEvent: vi.fn(), sendToUser: vi.fn() };
  return { engine, players };
}

async function payloadSent(tournament: boolean) {
  const { engine, players } = engineOnTheFixtureHand(tournament);
  await engine.postHandTasks(players, 1);
  expect(mocks.commit).toHaveBeenCalledTimes(1);
  const atomicCommit = mocks.commit.mock.calls[0][0].atomicCommit;
  return {
    stacks: atomicCommit.stacks as Array<Record<string, unknown>>,
    facts: atomicCommit.acceptedPostCommitFacts as Record<string, unknown>,
  };
}

beforeEach(() => {
  mocks.commit.mockReset().mockResolvedValue({ handId: 'hand', settlementCommitted: true });
  mocks.obligations.mockReset().mockResolvedValue({ ok: true, pending_addons: 0 });
  mocks.leaves.mockReset().mockResolvedValue([]);
  mocks.recount.mockReset().mockResolvedValue(3);
  vi.spyOn(supabase, 'rpc').mockImplementation(mocks.rpc);
  vi.spyOn(supabase, 'from').mockImplementation((() => {
    const chain: any = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    return chain;
  }) as any);
});
afterEach(() => {
  vi.restoreAllMocks();
  mocks.rpc.mockReset();
});

describe('the engine sends promo exactly the contracted hand-commit payload', () => {
  for (const tournament of [false, true]) {
    const kind = tournament ? 'tournament' : 'cash';

    it(`${kind}: p_stacks is the golden roster, key for key and value for value`, async () => {
      const { stacks } = await payloadSent(tournament);
      expect(stacks).toEqual(CONTRACT.golden.p_stacks);
    });

    it(`${kind}: the accepted facts are the golden facts`, async () => {
      const { facts } = await payloadSent(tournament);
      expect(facts).toEqual(CONTRACT.golden.accepted_post_commit_facts);
    });

    it(`${kind}: every field a promo reader reads is present on every element`, async () => {
      const { stacks, facts } = await payloadSent(tournament);
      for (const [reader, reads] of Object.entries(CONTRACT.promo_reads)) {
        for (const element of stacks) {
          for (const key of reads.p_stacks) {
            expect(Object.hasOwn(element, key), `${reader} reads p_stacks[].${key}`).toBe(true);
          }
        }
        for (const key of reads.facts) {
          expect(Object.hasOwn(facts, key), `${reader} reads facts.${key}`).toBe(true);
        }
      }
    });

    it(`${kind}: a stack change is winnings minus the NET chips left at risk`, async () => {
      const { stacks, facts } = await payloadSent(tournament);
      const contributions = facts.contributions as Record<string, number>;
      for (const p of FIX.players) {
        const row = stacks.find((s) => s.user_id === p.user_id)!;
        expect(Number(row.stack) - Number(row.stack_before), p.user_id).toBe(
          p.won - (contributions[p.user_id] ?? 0)
        );
      }
    });

    it(`${kind}: contributions add up to the pot, with the uncalled return outside them`, async () => {
      const { facts } = await payloadSent(tournament);
      const contributions = Object.values(facts.contributions as Record<string, number>);
      expect(contributions.reduce((a, b) => a + b, 0)).toBe(FIX.pot);
      const returned = Object.values(facts.returned_uncalled as Record<string, number>);
      expect(returned.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    });
  }
});

describe('the contribution the engine records is already net of an uncalled return', () => {
  /* The source of `contributions` is HandController's totalInvested
     (ServerTableEngineHandEvents copies it per seat). The figures are the
     arithmetic of PartialIndividualAnte.test.ts's PLO6 heads-up hand: BB 2.00
     plus ante 1.00 against a 0.70 ante all-in, so 2.30 comes back. */
  it('totalInvested keeps only the matched 0.70, returnedUncalled keeps the 2.30, and they sum to the pot', () => {
    const events: HandEvent[] = [];
    const seats = (stacks: Record<number, number>) =>
      Object.entries(stacks).map(([seat, stack]) => ({
        seat: Number(seat),
        user_id: `u${seat}`,
        username: `P${seat}`,
        stack,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      })) as SeatPlayer[];
    const h = new HandController(
      {
        tableId: 'promo-net-contribution',
        handNumber: 1,
        gameVariant: 'plo6',
        smallBlind: 1,
        bigBlind: 2,
        ante: 1,
        bigBlindAnte: false,
        rakeConfig: { percent: 10, cap: 5, noFlopNoDrop: true },
      } as HandConfig,
      seats({ 1: 100, 3: 0.7 }),
      3
    );
    h.onEvent((e) => events.push(e));
    h.start();
    const seat = (n: number) => h.getState().players.find((p) => p.seat === n)!;
    expect(seat(1).returnedUncalled).toBe(2.3);
    expect(seat(1).totalInvested).toBe(0.7);
    expect(seat(3).totalInvested).toBe(0.7);
    expect(seat(1).totalInvested + seat(3).totalInvested).toBe(h.getState().pot);
  });
});

describe('the database call forwards the payload unchanged', () => {
  const source = readFileSync(join(REPO, 'server/src/services/supabase/handHistory.ts'), 'utf8');
  it('p_stacks is atomicCommit.stacks', () => {
    expect(source).toContain('p_stacks: atomicCommit.stacks,');
  });
  it('the accepted facts ride verbatim on p_hand_row', () => {
    expect(source).toContain('_accepted_post_commit_facts: atomicCommit.acceptedPostCommitFacts,');
  });
});
