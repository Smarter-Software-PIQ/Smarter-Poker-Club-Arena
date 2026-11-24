/**
 * LAW (2026-11-17): AN OPPONENT'S POSTFLOP PLAY IS KEPT BY STREET AND BY FLOP TEXTURE, DURABLY, AND REACHES THE
 * DECISION, on the path live decisions take. MEASUREMENT ONLY: no decision reads it yet.
 *
 * The gap. The exact opponent profile keeps one pooled postflop bet rate and one pooled fold-to-a-bet rate. A player
 * who bets most flops and slows down afterwards carries one label on every street and texture.
 *
 * What exists now. The accepted-hand database learner keeps a record beside the exact profile
 * (horse_exact_profiles.street_counters, migration 20261117175407: bet when no bet yet, fold to a bet and fold to a
 * raise by street; the continuation bet and the flop bet by flop texture; each cell its own hit and opportunity count,
 * a half-life of 30 opportunities, forward only, public actions and board cards only). The record arrives on the pooled
 * public row (worker boot and every accepted hand); an Omaha decision carries a detached copy in its own state
 * (HorseMindSandbox.pooledStreetRead) and read frame (v18); HorseMind.omahaStreetReadOf answers it with every thin
 * cell null.
 *
 * This file drives the entries the decision worker drives: HorseObserverReads.bootstrapPublicProfiles (the worker's
 * boot read), HorseObserverReads.complete (an accepted hand with its pooled row) and HorseObserverReads.run (the
 * decision). Synthetic players only.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseObserverReads } from './observerReads.js';
import { HorseMind, type OmahaStreetRead } from '../HorseMind.js';
import { counters } from '../HorseOpponentStyle.test-support.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { decodeHorseDecisionReads, encodeHorseDecisionReads } from '../HorseDecisionReadFrame.js';
import {
  addStreetReadEvidence,
  emptyStreetRead,
  STREET_READ_MIN_OPPORTUNITIES,
  type StreetReadCounters,
} from '../HorseOmahaStreetRead.js';
import { exploitEnvelopeFor } from '../HorseOpponentExploit.js';
import type { DurableOpponentProfile } from '../HorseOpponentMemory.js';
import type { HorsePublicMemoryDomain } from '../HorsePublicMemoryDomain.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

const table = '10000000-0000-4000-8000-000000000081';
const lease = '50000000-0000-4000-8000-000000000081';
const watcher = '20000000-0000-4000-8000-000000000081';
const reader = '20000000-0000-4000-8000-000000000082';
const bettor = '30000000-0000-4000-8000-000000000081';
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 17, 14, 0, 0);
type Format = 'cash' | 'mtt';
type Game = 'plo4' | 'plo5' | 'nlh';
const modeOf = (format: Format) => (format === 'cash' ? 'cash' : 'tournament');
const scopeOf = (game: Game) => (game === 'nlh' ? 'holdem:full' : 'omaha:full');

/**
 * The audited regular's shape as the database learner would have written it: on unpaired (rainbow) flops he bets
 * nearly every time he can, on paired flops rarely; he bets few turns; and he has seen only `rivers` rivers.
 */
function streetRecord(flops = 40, rivers = 3): StreetReadCounters {
  let r: StreetReadCounters | null = null;
  for (let i = 0; i < flops; i++) {
    const inc = emptyStreetRead();
    const paired = i % 4 === 3;
    const bets = paired ? i % 16 === 3 : i % 10 !== 9;
    inc.bet.flop = { hit: bets ? 1 : 0, opp: 1 };
    inc.flopBet[paired ? 'paired' : 'rainbow'] = { hit: bets ? 1 : 0, opp: 1 };
    inc.cbet[paired ? 'paired' : 'rainbow'] = { hit: bets ? 1 : 0, opp: 1 };
    inc.bet.turn = { hit: i % 5 === 0 ? 1 : 0, opp: 1 };
    inc.foldToBet.turn = { hit: i % 2, opp: 1 };
    if (i < rivers) inc.bet.river = { hit: 0, opp: 1 };
    r = addStreetReadEvidence(r, inc);
  }
  return r!;
}

function request(
  decisionTimeMs: number,
  game: Game = 'plo4',
  format: Format = 'cash',
  id = reader
): FastHorseDecisionRequest {
  const seats = [1, 2, 3, 4, 5, 6];
  const others = [bettor, ...seats.slice(2).map((s) => `40000000-0000-4000-8000-00000000008${s}`)];
  return {
    type: 'DECIDE_FAST',
    requestId: 1,
    generation: 7,
    fence: `${table}:2000001:1:${lease}:7`,
    decisionKey: '',
    decisionTimeMs,
    handJournalContext: captureHorseHandJournalContext([]),
    player: { user_id: id, seat: 1 },
    gameState: {
      gameVariant: game,
      format,
      gameMode: modeOf(format),
      ...(format === 'cash' ? {} : { tournament: { contextStatus: 'complete' } }),
      publicMemoryDomain: TABLE,
      dealtSeatIds: seats,
      players: seats.map((seat) => ({ user_id: seat === 1 ? id : others[seat - 2]!, seat })),
    },
  } as never;
}

/** The bettor's exact pooled row: 80 hands of an ordinary player, and (when given) his street read. */
function row(
  street: StreetReadCounters | null | undefined | Record<string, unknown>,
  game: Game = 'plo4',
  format: Format = 'cash',
  observed = 80
): DurableOpponentProfile {
  return {
    public_memory_domain: TABLE,
    user_id: bettor,
    variant: game,
    mode: modeOf(format),
    size: 'full',
    observed_hands: observed,
    initialized: true,
    counters: counters({ hands: 80, vpip: 0.4, pfr: 0.2, betCheckedToOpp: 30, betCheckedTo: 12 }),
    ...(street === undefined ? {} : { street_counters: street as StreetReadCounters | null }),
  };
}

/** An accepted hand the bettor acted in, carrying his refreshed pooled row. */
function hand(n: number, profile: DurableOpponentProfile): ObserveCompletedHandRequest {
  const number = 1000000 + n;
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 2,
    generation: number,
    fence: `${table}:${number}:${lease}:observe`,
    handKey: `${table}:${number}`,
    committedHandId: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    publicMemoryDomain: TABLE,
    actions: [
      {
        userId: bettor,
        seat: 2,
        action: 'raise',
        origin: 'player',
        amount: 8,
        stage: 'preflop',
        timestamp: n,
      },
    ],
    bigBlind: 2,
    observerParticipants: {
      version: 1,
      handKey: `${table}:${number}:${lease}`,
      status: 'bound',
      contexts: [
        horseObserverReadContextFromRequest(request(0, profile.variant as Game, 'cash', watcher))!,
      ],
    },
    durableOpponentProfiles: [profile],
  } as never;
}

function bootedBank(
  profiles: DurableOpponentProfile[],
  at = NOW - DAY,
  clock = () => at
): HorseObserverReads {
  const bank = new HorseObserverReads(20, 20, clock);
  expect(bank.bootstrapPublicProfiles({ availableAtMs: at, profiles })).toBe(true);
  return bank;
}

const PLAYERS = [{ user_id: reader }, { user_id: bettor }];
interface Read {
  street: OmahaStreetRead | null;
  frame: { version: string; sha256: string; json: string };
}
/** What the decision carries about the bettor, inside the decision's own sandbox, and the frame it would journal. */
function readInDecision(game: Game = 'plo4', format: Format = 'cash'): Read {
  HorseMind.setDecisionScope(scopeOf(game) as never, game, modeOf(format));
  const street = HorseMind.omahaStreetReadOf(bettor, 'rainbow');
  const frame = encodeHorseDecisionReads(
    HorseMind.snapshotDecisionReads(PLAYERS as never, null, {
      variant: game,
      mode: modeOf(format),
      size: 'full',
    }),
    PLAYERS as never,
    null
  );
  HorseMind.setDecisionScope(null);
  return { street, frame: { version: frame.version, sha256: frame.sha256, json: frame.json } };
}

beforeEach(() => HorseMind.reset());
afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('an opponent is read by street and by flop texture', () => {
  it('1. the durable record reaches an Omaha decision: its cells as stored, a label per street, null where thin', () => {
    const record = streetRecord();
    const bank = bootedBank([row(record)]);
    const { street, frame } = bank.run(request(NOW), () => readInDecision());
    expect(street).not.toBeNull();
    expect(street!.counters).toEqual(record);
    expect(street!.counters).not.toBe(record);
    // the rainbow flop cell and the turn cell hold well over 8 decayed opportunities; the river cell holds 3
    const means = exploitEnvelopeFor('omaha:full' as never, 'plo4')!;
    expect(record.flopBet.rainbow.opp).toBeGreaterThan(STREET_READ_MIN_OPPORTUNITIES);
    expect(street!.flop).not.toBeNull();
    expect(street!.flop!.valueLeader).toBe(false);
    expect(street!.flop!.betRatio).toBeGreaterThan(1.5);
    expect(street!.flop!.opportunities).toBeCloseTo(record.flopBet.rainbow.opp, 12);
    expect(street!.turn).not.toBeNull();
    expect(street!.turn!.betRatio).toBeLessThan(street!.flop!.betRatio);
    expect(record.bet.river.opp).toBeLessThan(STREET_READ_MIN_OPPORTUNITIES);
    expect(street!.river).toBeNull();
    expect(means.betCheckedTo.mean).toBeGreaterThan(0);
    // the texture selects the flop cell: the same player is a different bettor on a paired flop
    const paired = bank.run(request(NOW), () => {
      HorseMind.setDecisionScope('omaha:full' as never, 'plo4', 'cash');
      const read = HorseMind.omahaStreetReadOf(bettor, 'paired');
      HorseMind.setDecisionScope(null);
      return read;
    })!;
    expect(paired.flop).not.toBeNull();
    expect(paired.flop!.betRatio).toBeLessThan(street!.flop!.betRatio / 2);
    // a texture he has not been seen on is unknown
    const mono = bank.run(request(NOW), () => {
      HorseMind.setDecisionScope('omaha:full' as never, 'plo4', 'cash');
      const read = HorseMind.omahaStreetReadOf(bettor, 'monotone');
      HorseMind.setDecisionScope(null);
      return read;
    })!;
    expect(mono.flop).toBeNull();
    expect(frame.version).toBe('horse-decision-reads-v18');
    expect(frame.json).toContain('"streetRead"');
  });

  it('2. unknown stays unknown: no record, a null record and a column not yet installed read null and keep the frame byte for byte', () => {
    const absent = bootedBank([row(undefined)]).run(request(NOW), () => readInDecision());
    HorseMind.reset();
    const nulled = bootedBank([row(null)]).run(request(NOW), () => readInDecision());
    HorseMind.reset();
    const nobody = bootedBank([]).run(request(NOW), () => readInDecision());
    expect(absent.street).toBeNull();
    expect(nulled.street).toBeNull();
    expect(nobody.street).toBeNull();
    expect(absent.frame.version).not.toBe('horse-decision-reads-v18');
    expect(absent.frame.json).not.toContain('streetRead');
    expect(nulled.frame).toEqual(absent.frame);
    // a record whose every cell is still empty is carried as it is and answers null on every street
    HorseMind.reset();
    const empty = bootedBank([row(emptyStreetRead())]).run(request(NOW), () => readInDecision());
    expect(empty.street).toMatchObject({ flop: null, turn: null, river: null });
    expect(empty.street!.counters).toEqual(emptyStreetRead());
  });

  it('3. a malformed record is dropped, not trusted, and the row still reads exactly as a row with none', () => {
    const none = bootedBank([row(undefined)]).run(request(NOW), () => readInDecision());
    const broken = streetRecord() as unknown as Record<string, any>;
    for (const junk of [
      { bet: {} },
      'x',
      7,
      { ...broken, bet: { ...broken.bet, flop: { hit: 30, opp: 2 } } },
      { ...broken, extra: 1 },
      { ...broken, cbet: { ...broken.cbet, rainbow: { hit: -1, opp: 4 } } },
    ]) {
      HorseMind.reset();
      const got = bootedBank([row(junk as never)]).run(request(NOW), () => readInDecision());
      expect(got.street, JSON.stringify(junk).slice(0, 40)).toBeNull();
      expect(got.frame).toEqual(none.frame);
    }
  });

  it("4. a Hold'em decision carries nothing: its read and its frame are byte-identical to a row with no record", () => {
    const withRecord = bootedBank([row(streetRecord(), 'nlh')]).run(request(NOW, 'nlh'), () =>
      readInDecision('nlh')
    );
    HorseMind.reset();
    const without = bootedBank([row(undefined, 'nlh')]).run(request(NOW, 'nlh'), () =>
      readInDecision('nlh')
    );
    expect(withRecord.street).toBeNull();
    expect(withRecord.frame).toEqual(without.frame);
    expect(withRecord.frame.json).not.toContain('streetRead');
    // and inside a Hold'em scope the accessor answers null whatever the state holds
    const sandbox = {
      ...HorseMind.createSandbox(),
      pooledStreetRead: new Map([[`nlh:cash:full|${bettor}`, streetRecord()]]),
    };
    expect(
      HorseMind.runInSandbox(sandbox, () => {
        HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
        return HorseMind.omahaStreetReadOf(bettor);
      })
    ).toBeNull();
    // PLO5 is its own row: a PLO4 record is not read at a PLO5 table
    HorseMind.reset();
    const plo5 = bootedBank([row(streetRecord(), 'plo4'), row(undefined, 'plo5')]).run(
      request(NOW, 'plo5'),
      () => readInDecision('plo5')
    );
    expect(plo5.street).toBeNull();
  });

  it('5. availability: it arrives with an accepted hand, and a decision reads only the record accepted before its own time', () => {
    let clock = NOW - DAY;
    const early = streetRecord(12, 0);
    const later = streetRecord(40, 12);
    const bank = bootedBank([row(early)], NOW - DAY, () => clock);
    const T = NOW - DAY / 2;
    expect(bank.run(request(T - 1), () => readInDecision()).street!.counters).toEqual(early);
    clock = T;
    bank.complete(hand(1, row(later, 'plo4', 'cash', 81)), () => {});
    const after = bank.run(request(T), () => readInDecision()).street!;
    expect(after.counters).toEqual(later);
    expect(after.river).not.toBeNull();
    // a decision fenced before the refreshed row was accepted never reads it
    expect(bank.run(request(T - 1), () => readInDecision()).street).toBeNull();
    // nor does a decision fenced before the boot read was available read anything
    expect(bank.run(request(NOW - DAY - 1), () => readInDecision()).street).toBeNull();
  });

  it('6. cash and tournament stay apart', () => {
    const bank = bootedBank([row(streetRecord(), 'plo4', 'mtt'), row(null, 'plo4', 'cash')]);
    expect(bank.run(request(NOW), () => readInDecision()).street).toBeNull();
    const mtt = bank.run(request(NOW, 'plo4', 'mtt'), () => readInDecision('plo4', 'mtt'));
    expect(mtt.street!.counters).toEqual(streetRecord());
    expect(mtt.frame.version).toBe('horse-decision-reads-v18');
  });

  it('7. the second look and an exact replay carry what the first look carried (read frame v18)', () => {
    const record = streetRecord();
    const bank = bootedBank([row(record)]);
    const first = bank.run(request(NOW), () => {
      const read = readInDecision();
      const view = HorseMind.snapshotDecisionReads(PLAYERS as never, null, {
        variant: 'plo4',
        mode: 'cash',
        size: 'full',
      });
      return { read, frame: encodeHorseDecisionReads(view, PLAYERS as never, null) };
    });
    expect(first.frame.version).toBe('horse-decision-reads-v18');
    // a process that holds none of this one's rows
    HorseMind.reset();
    const decoded = decodeHorseDecisionReads(first.frame, PLAYERS as never, null);
    expect(decoded.pooledStreetRead?.size).toBe(1);
    expect(decoded.pooledProfileIncomplete).toBeUndefined();
    expect(decoded.pooledShownRiver).toBeUndefined();
    const again = HorseMind.runInSandbox(decoded, () => readInDecision());
    expect(again.street).toEqual(first.read.street);
    expect(again.frame).toEqual(first.read.frame);
    // the frame refuses a street row that is not one, or that names a row the frame does not carry
    const body = JSON.parse(first.frame.json);
    const reseal = (b: unknown) => {
      const json = JSON.stringify(b);
      const sealed = encodeHorseDecisionReads(
        HorseMind.runInSandbox(decoded, () =>
          HorseMind.snapshotDecisionReads(PLAYERS as never, null, {
            variant: 'plo4',
            mode: 'cash',
            size: 'full',
          })
        ),
        PLAYERS as never,
        null
      );
      // same wrapper, the altered body and its own digest
      return {
        version: sealed.version,
        bytes: Buffer.byteLength(json),
        sha256: createHash('sha256').update(json).digest('hex'),
        json,
      };
    };
    const tooShort = structuredClone(body);
    tooShort.streetRead[0][1].pop();
    const hitAboveOpp = structuredClone(body);
    hitAboveOpp.streetRead[0][1][0] = hitAboveOpp.streetRead[0][1][1] + 5;
    const stranger = structuredClone(body);
    stranger.streetRead[0][0] = `plo4:cash:hu|${bettor}`;
    const none = structuredClone(body);
    none.streetRead = [];
    for (const bad of [tooShort, hitAboveOpp, stranger, none])
      expect(() => decodeHorseDecisionReads(reseal(bad) as never, PLAYERS as never, null)).toThrow(
        'Horse decision read frame is invalid'
      );
    expect(() =>
      decodeHorseDecisionReads(reseal(body) as never, PLAYERS as never, null)
    ).not.toThrow();
  });

  it('8. ONLY ITS OPTIONS READ IT: outside its owner, its transport, omahaReadIsByStreetAndTexture and omahaFlopVerdictReadsTheBettor, no engine source names the read', () => {
    const root = resolve(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.ts$/.test(name) && !/\.test\.ts$|test-support\.ts$|\.d\.ts$/.test(name))
          files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(300);
    const naming = (needle: RegExp) =>
      files
        .filter((f) => needle.test(readFileSync(f, 'utf8')))
        .map((f) => f.slice(root.length + 1))
        .sort();
    // the accessor is defined in HorseMind; since 2026-11-18 (omahaReadIsByStreetAndTexture, default off) it is
    // called only by HorseMind's own two per-street readers (the value-leader label and the facing-bet bet rate,
    // each behind omahaReadByStreetNow().on) and by the option's per-decision installer; and, since the dark batch
    // of 2026-11-18, by the default-off flop defence tree (omahaFlopDefenceIsPriced), which reads the bettor's
    // counters only inside its own `ctx.flopDefenceTree === true` branch;
    // and, since 2026-11-19 (omahaFlopVerdictReadsTheBettor, default off) also by the flop facing-bet rule, behind
    // ctx.readsTheBettor === true, for the bettor alone;
    // and, since 2026-11-19 (omahaFacingBetValueShareIsMeasured, default off) by that option's one wiring
    // function, which HorseLogic's facing-bet count calls behind that option and the mind, for the bettor alone;
    // and, since 2026-11-19 (omahaBluffIsPricedAgainstTheTarget, default off) by that option's module, which reads
    // the target's foldToBet street cell only when the option is on and its wager is priced;
    // and, since 2026-11-24 (omahaFlopRealizationIsPriced, default off) by the flop call tree's rule, which HorseLogic
    // calls only behind that option, reading the bettor's own per-street bet counters (with the mind on) to shrink
    // the measured later-street bet rates toward them, for the bettor alone
    expect(naming(/omahaStreetReadOf\(/)).toEqual([
      'engine/HorseMind.ts',
      'engine/HorseOmahaBluffPricedAgainstTheTarget.ts',
      'engine/HorseOmahaFacingBetValueShareMeasuredRule.ts',
      'engine/HorseOmahaFlopCallTree.ts',
      'engine/HorseOmahaFlopFacingBetEvRule.ts',
      'engine/HorseOmahaReadByStreetRule.ts',
    ]);
    const flopRule = readFileSync(join(root, 'engine/HorseOmahaFlopFacingBetEvRule.ts'), 'utf8');
    // two calls, each after its own default-off guard: the bettor read (readsTheBettor), then the tree (flopDefenceTree)
    const flopReads = [...flopRule.matchAll(/omahaStreetReadOf\(/g)].map((m) => m.index ?? -1);
    expect(flopReads).toHaveLength(2);
    const bettorGuard = flopRule.indexOf('ctx.readsTheBettor === true');
    const treeGuard = flopRule.indexOf('ctx.flopDefenceTree === true');
    expect(bettorGuard).toBeGreaterThan(-1);
    expect(treeGuard).toBeGreaterThan(-1);
    expect(bettorGuard).toBeLessThan(flopReads[0]);
    expect(flopReads[0]).toBeLessThan(treeGuard);
    expect(treeGuard).toBeLessThan(flopReads[1]);
    const logic = readFileSync(join(root, 'engine/HorseLogic.ts'), 'utf8');
    const logicReads = [...logic.matchAll(/omahaMeasuredBettorRecord\(/g)].map(
      (m) => m.index ?? -1
    );
    expect(logicReads).toHaveLength(1);
    const measuredGuard = logic.indexOf('opts.omahaFacingBetValueShareIsMeasured === true &&');
    expect(measuredGuard).toBeGreaterThan(-1);
    expect(measuredGuard).toBeLessThan(logicReads[0]);
    const mind = readFileSync(join(root, 'engine/HorseMind.ts'), 'utf8');
    // since 2026-11-19 (lane HU-OMAHA, omahaEvFoldModelHeadsUp, default off) HorseMind reads it once more, inside
    // omahaEvFoldHeadsUpMulOf, whose only call sits behind `omahaEvFoldModelHeadsUp === true`
    expect(mind.match(/omahaStreetReadOf\(/g)).toHaveLength(4);
    expect(mind.match(/this\.omahaStreetReadOf\(/g)).toHaveLength(3);
    const huDef = mind.indexOf('private static omahaEvFoldHeadsUpMulOf(');
    const huCalls = [...mind.matchAll(/this\.omahaEvFoldHeadsUpMulOf\(/g)].map(
      (m) => m.index ?? -1
    );
    expect(huDef).toBeGreaterThan(-1);
    expect(huCalls).toHaveLength(1);
    const huGuard = mind.lastIndexOf('omahaEvFoldModelHeadsUp === true', huCalls[0]);
    expect(huGuard).toBeGreaterThan(-1);
    expect(huCalls[0] - huGuard).toBeLessThan(200);
    const mindReads = [...mind.matchAll(/this\.omahaStreetReadOf\(/g)].map((m) => m.index ?? -1);
    expect(mindReads.filter((i) => i > huDef && i < mind.indexOf('\n  }\n', huDef))).toHaveLength(
      1
    );
    // the decision's carried state is touched only by its owner, the observer reads that fill it and the frame
    expect(naming(/pooledStreetRead/)).toEqual([
      // the league's stand-in for the accepted-hand learner (2026-11-18), filling a league sandbox only
      'benchmark/HorseLeagueStreetRead.ts',
      // the opponent-memory replay (2026-11-21, HORSE DECISIONS): the same stand-in keyed by the hand's mode,
      // filling one replay sandbox only; no engine path imports it
      'benchmark/ReplayOpponentMemory.ts',
      'engine/HorseDecisionReadFrame.ts',
      'engine/HorseMind.ts',
      'engine/HorseOmahaStreetRead.ts',
      'engine/horseDecision/observerReads.ts',
    ]);
    // the stored column is named only by the profile copies (boot read, pooled rows) and the observer reads
    expect(naming(/street_counters|copyStreetCounters/)).toEqual([
      'engine/HorseMind.ts',
      'engine/HorseOmahaStreetRead.ts',
      // the price behind the fold-to-raise cells (2026-11-19, street_counters_price), its own record and law
      'engine/HorseOmahaStreetReadPrice.ts',
      'engine/HorseOpponentMemory.ts',
      'engine/horseDecision/observerReads.ts',
      'engine/horseDecision/pooledPublicProfiles.ts',
      'services/HorsePooledPublicBootstrap.ts',
    ]);
    // the module is imported only by those files (and the memory copy)
    expect(naming(/from '\.\.?\/(?:engine\/)?HorseOmahaStreetRead\.js'/)).toEqual([
      'benchmark/HorseLeagueStreetRead.ts',
      // the opponent-memory replay (2026-11-21, HORSE DECISIONS) imports the reducer for its replay sandbox only
      'benchmark/ReplayOpponentMemory.ts',
      'engine/HorseDecisionReadFrame.ts',
      'engine/HorseMind.ts',
      // omahaFacingBetValueShareIsMeasured's pure read (2026-11-19): the record's validation and the flop texture
      'engine/HorseOmahaFacingBetValueShareMeasured.ts',
      // and its one wiring function: the counters' TYPE only
      'engine/HorseOmahaFacingBetValueShareMeasuredRule.ts',
      // omahaFlopVerdictReadsTheBettor's pure read (2026-11-19)
      'engine/HorseOmahaFlopBettorRead.ts',
      // the default-off flop defence tree (omahaFlopDefenceIsPriced, dark batch 2026-11-18): the counters' TYPE only
      // the flop call tree (omahaFlopRealizationIsPriced, default off, 2026-11-24): the counters' type only
      'engine/HorseOmahaFlopCallTree.ts',
      'engine/HorseOmahaFlopDefenceTree.ts',
      // the flop rule that asks for the bettor read (flopTextureOf)
      'engine/HorseOmahaFlopFacingBetEvRule.ts',
      // the flop-shown record (2026-11-19) takes the flop texture and the public flop from it
      'engine/HorseOmahaFlopShown.ts',
      // omahaReadIsByStreetAndTexture's pure read (2026-11-18)
      'engine/HorseOmahaReadByStreet.ts',
      // its per-decision mode (types only), the one part HorseMind imports
      'engine/HorseOmahaReadByStreetMode.ts',
      // the price behind the fold-to-raise cells (2026-11-19) takes the streets and the decay from it
      'engine/HorseOmahaStreetReadPrice.ts',
      'engine/HorseOpponentMemory.ts',
      'engine/horseDecision/observerReads.ts',
    ]);
    expect(readFileSync(join(root, 'engine/HorseOmahaFlopDefenceTree.ts'), 'utf8')).toMatch(
      /import type \{ StreetReadCounters \} from '\.\/HorseOmahaStreetRead\.js';/
    );
    // the four decision files another lane is editing are not touched by this read
    for (const f of [
      'HorseLogic.ts',
      'HorseOmahaFacingBetEv.ts',
      'HorseOmahaCardImpact.ts',
      'HorseOmahaOopReraisedPot.ts',
    ])
      expect(readFileSync(join(root, 'engine', f), 'utf8')).not.toMatch(
        /StreetRead|street_counters/
      );
  });
});
