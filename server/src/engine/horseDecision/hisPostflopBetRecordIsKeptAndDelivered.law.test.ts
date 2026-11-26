/**
 * LAW (2026-11-25): HOW AN NLH OPPONENT ANSWERS A POSTFLOP BET AND WHAT HIS CALLED, SHOWN BETS WERE IS KEPT DURABLY,
 * FROM PUBLIC INFORMATION ONLY, AND REACHES THE DECISION on the path live decisions take (bootstrap -> run), with its
 * read frame (v22). Unknown stays unknown: no record, a null record or a malformed one read null and keep the older
 * frame byte for byte; a non-NLH decision never carries it. Synthetic players only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseObserverReads } from './observerReads.js';
import { HorseMind } from '../HorseMind.js';
import { counters } from '../HorseOpponentStyle.test-support.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { decodeHorseDecisionReads, encodeHorseDecisionReads } from '../HorseDecisionReadFrame.js';
import {
  addPostflopBetEvidence,
  emptyPostflopBets,
  raiseToBetShare,
  shownBetAir,
  type PostflopBetCounters,
} from '../HorsePostflopBetRecord.js';
import type { DurableOpponentProfile } from '../HorseOpponentMemory.js';
import type { HorsePublicMemoryDomain } from '../HorsePublicMemoryDomain.js';
import type { FastHorseDecisionRequest } from './protocol.js';

const table = '10000000-0000-4000-8000-000000000093';
const lease = '50000000-0000-4000-8000-000000000093';
const reader = '20000000-0000-4000-8000-000000000094';
const bettor = '30000000-0000-4000-8000-000000000093';
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 25, 14, 0, 0);
type Game = 'nlh' | 'plo4';

/** 40 turn raises faced (10 raised) and 20 called, shown large river bets (12 air). */
function record(): PostflopBetCounters {
  let r: PostflopBetCounters | null = null;
  for (let i = 0; i < 40; i++) {
    const inc = emptyPostflopBets();
    inc.raiseToBet.turn = { opp: 1, raise: i % 4 === 0 ? 1 : 0 };
    if (i < 20) inc.shownBet.river.large = { called: 1, shown: 1, air: i < 12 ? 1 : 0 };
    r = addPostflopBetEvidence(r, inc);
  }
  return r!;
}

function request(decisionTimeMs: number, game: Game): FastHorseDecisionRequest {
  const seats = [1, 2];
  return {
    type: 'DECIDE_FAST',
    requestId: 1,
    generation: 7,
    fence: `${table}:2000001:1:${lease}:7`,
    decisionKey: '',
    decisionTimeMs,
    handJournalContext: captureHorseHandJournalContext([]),
    player: { user_id: reader, seat: 1 },
    gameState: {
      gameVariant: game,
      format: 'cash',
      gameMode: 'cash',
      publicMemoryDomain: TABLE,
      dealtSeatIds: seats,
      players: [
        { user_id: reader, seat: 1 },
        { user_id: bettor, seat: 2 },
      ],
    },
  } as never;
}

function row(bets: unknown, game: Game = 'nlh'): DurableOpponentProfile {
  return {
    public_memory_domain: TABLE,
    user_id: bettor,
    variant: game,
    mode: 'cash',
    size: 'hu',
    observed_hands: 80,
    initialized: true,
    counters: counters({ hands: 80, vpip: 0.4, pfr: 0.2, betCheckedToOpp: 30, betCheckedTo: 12 }),
    ...(bets === undefined ? {} : { postflop_bets: bets as PostflopBetCounters | null }),
  };
}

function bootedBank(profiles: DurableOpponentProfile[]): HorseObserverReads {
  const at = NOW - DAY;
  const bank = new HorseObserverReads(20, 20, () => at);
  expect(bank.bootstrapPublicProfiles({ availableAtMs: at, profiles })).toBe(true);
  return bank;
}

const PLAYERS = [{ user_id: reader }, { user_id: bettor }];
function readInDecision(game: Game = 'nlh') {
  HorseMind.setDecisionScope((game === 'nlh' ? 'holdem:hu' : 'omaha:hu') as never, game, 'cash');
  const bets = HorseMind.postflopBetsOf(bettor);
  const frame = encodeHorseDecisionReads(
    HorseMind.snapshotDecisionReads(PLAYERS as never, null, {
      variant: game,
      mode: 'cash',
      size: 'hu',
    }),
    PLAYERS as never,
    null
  );
  HorseMind.setDecisionScope(null);
  return {
    bets,
    frame: { version: frame.version, bytes: frame.bytes, sha256: frame.sha256, json: frame.json },
  };
}

beforeEach(() => HorseMind.reset());
afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('his postflop bet record is kept and delivered', () => {
  it('1. the durable record reaches an NLH decision as stored; the readers answer it; the frame is v22 and round-trips', () => {
    const rec = record();
    const { bets, frame } = bootedBank([row(rec)]).run(request(NOW, 'nlh'), () => readInDecision());
    expect(bets).toEqual(rec);
    expect(bets).not.toBe(rec);
    expect(raiseToBetShare(bets, 'turn', 0.1).share).toBeGreaterThan(0.15);
    expect(shownBetAir(bets, 'river', 'large')!.air).toBeGreaterThan(0.5);
    expect(frame.version).toBe('horse-decision-reads-v22');
    expect(frame.json).toContain('"postflopBets"');
    const decoded = decodeHorseDecisionReads(frame as never, PLAYERS as never, null);
    expect(decoded.pooledPostflopBets?.get([...decoded.pooledPostflopBets.keys()][0]!)).toEqual(
      rec
    );
  });

  it('2. unknown stays unknown: no record, a null record or a malformed one read null and keep the frame byte for byte', () => {
    const absent = bootedBank([row(undefined)]).run(request(NOW, 'nlh'), () => readInDecision());
    HorseMind.reset();
    const nulled = bootedBank([row(null)]).run(request(NOW, 'nlh'), () => readInDecision());
    HorseMind.reset();
    const junk = bootedBank([row({ raiseToBet: 7, shownBet: [] })]).run(request(NOW, 'nlh'), () =>
      readInDecision()
    );
    for (const r of [absent, nulled, junk]) expect(r.bets).toBeNull();
    expect(absent.frame.version).not.toBe('horse-decision-reads-v22');
    expect(absent.frame.json).not.toContain('postflopBets');
    expect(nulled.frame).toEqual(absent.frame);
    expect(junk.frame).toEqual(absent.frame);
  });

  it('3. a non-NLH decision never carries it', () => {
    const r = bootedBank([row(record(), 'plo4')]).run(request(NOW, 'plo4'), () =>
      readInDecision('plo4')
    );
    expect(r.bets).toBeNull();
    expect(r.frame.json).not.toContain('postflopBets');
  });
});
