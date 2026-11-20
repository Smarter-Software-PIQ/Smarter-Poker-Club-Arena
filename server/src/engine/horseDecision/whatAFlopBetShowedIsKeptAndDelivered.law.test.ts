/**
 * LAW (2026-11-19): WHAT AN OPPONENT SHOWED AFTER BETTING THE FLOP, WHAT CALLING HIS FLOP BETS RETURNED, AND THE
 * PRICE BEHIND HIS FOLD-TO-RAISE CELLS ARE KEPT DURABLY, FROM PUBLIC INFORMATION ONLY, AND REACH THE DECISION on
 * the path live decisions take. MEASUREMENT ONLY: no decision reads them.
 *
 * The gap. The flop facing-bet verdict prices a call against the bettor's range. A read of how often he bets a
 * flop was measured and did not help; what the verdict lacks is what he holds when he bets and what calls of his
 * bets returned. And a fold-to-raise cell did not say what the raises behind it cost.
 *
 * What exists now. The accepted-hand database learner keeps two records beside the exact profile (migration
 * 20261119192551): horse_exact_profiles.flop_shown (HorseOmahaFlopShown: shown first flop bets by line, texture
 * and hand class; calls of them by the caller's kind, class and position with their price and return; integers)
 * and horse_exact_profiles.street_counters_price (HorseOmahaStreetReadPrice: per street, the sum of the prices of
 * the raises he faced after betting or raising, and their count). The records arrive on the pooled public row; an
 * Omaha decision carries detached copies in its own state (HorseMindSandbox.pooledFlopShown, pooledStreetPrice)
 * and read frame (v20); HorseMind.omahaFlopShownOf and HorseMind.omahaFoldToRaisePriceOf answer them.
 *
 * This file drives the entries the decision worker drives: HorseObserverReads.bootstrapPublicProfiles,
 * HorseObserverReads.complete and HorseObserverReads.run. Synthetic players only.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseObserverReads } from './observerReads.js';
import { HorseMind } from '../HorseMind.js';
import { counters } from '../HorseOpponentStyle.test-support.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { decodeHorseDecisionReads, encodeHorseDecisionReads } from '../HorseDecisionReadFrame.js';
import {
  FLOP_SHOWN_LEARNED_VARIANTS,
  addFlopShownEvidence,
  emptyFlopShown,
  flopShownBetIndex,
  flopShownBetRead,
  flopShownCallIndex,
  flopShownCallRead,
  flopShownCarriedFor,
  flopShownShare,
  type FlopShownCounters,
} from '../HorseOmahaFlopShown.js';
import {
  addStreetPriceEvidence,
  emptyStreetPrice,
  type StreetPriceCounters,
  type StreetPriceMean,
} from '../HorseOmahaStreetReadPrice.js';
import type { DurableOpponentProfile } from '../HorseOpponentMemory.js';
import type { HorsePublicMemoryDomain } from '../HorsePublicMemoryDomain.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

const table = '10000000-0000-4000-8000-000000000091';
const lease = '50000000-0000-4000-8000-000000000091';
const watcher = '20000000-0000-4000-8000-000000000091';
const reader = '20000000-0000-4000-8000-000000000092';
const bettor = '30000000-0000-4000-8000-000000000091';
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 19, 14, 0, 0);
type Format = 'cash' | 'mtt';
type Game = 'plo4' | 'plo5' | 'nlh';
const modeOf = (format: Format) => (format === 'cash' ? 'cash' : 'tournament');
const scopeOf = (game: Game) => (game === 'nlh' ? 'holdem:full' : 'omaha:full');

/** `bets` shown continuation bets on rainbow flops, nine in ten of them the nuts, and the Horse calls they took
 *  out of position with a draw, which lost. */
function shownRecord(bets = 40): FlopShownCounters {
  let r: FlopShownCounters | null = null;
  for (let i = 0; i < bets; i++) {
    const inc = emptyFlopShown();
    inc.bet[flopShownBetIndex('cbet', 'rainbow', i % 10 ? 'nut' : 'air')] = 1;
    const at = flopShownCallIndex('horse', 'drawOop');
    inc.call[at] = 1;
    inc.call[at + 1] = 600;
    inc.call[at + 2] = -500;
    inc.call[at + 3] = 1;
    r = addFlopShownEvidence(r, inc);
  }
  return r!;
}
/** `raises` flop raises he faced after betting, each at a price of 0.3. */
function priceRecord(raises = 20): StreetPriceCounters {
  let r: StreetPriceCounters | null = null;
  for (let i = 0; i < raises; i++) {
    const inc = emptyStreetPrice();
    inc.foldToRaise.flop = { sum: 0.3, opp: 1 };
    r = addStreetPriceEvidence(r, inc);
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

/** The bettor's exact pooled row: 80 hands of an ordinary player, and (when given) his two records. */
function row(
  shown: unknown,
  price: unknown = undefined,
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
    ...(shown === undefined ? {} : { flop_shown: shown as FlopShownCounters | null }),
    ...(price === undefined ? {} : { street_counters_price: price as StreetPriceCounters | null }),
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
  shown: FlopShownCounters | null;
  price: Record<'flop' | 'turn' | 'river', StreetPriceMean | null> | null;
  frame: { version: string; sha256: string; json: string };
}
/** What the decision carries about the bettor, inside the decision's own sandbox, and the frame it would journal. */
function readInDecision(game: Game = 'plo4', format: Format = 'cash'): Read {
  HorseMind.setDecisionScope(scopeOf(game) as never, game, modeOf(format));
  const shown = HorseMind.omahaFlopShownOf(bettor);
  const price = HorseMind.omahaFoldToRaisePriceOf(bettor);
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
  return {
    shown,
    price,
    frame: { version: frame.version, sha256: frame.sha256, json: frame.json },
  };
}

beforeEach(() => HorseMind.reset());
afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('what a flop bet showed, what calling it returned and the price of a raise faced are kept and delivered', () => {
  it('1. the durable records reach an Omaha decision as stored, and the readers answer them', () => {
    const record = shownRecord();
    const prices = priceRecord();
    const bank = bootedBank([row(record, prices)]);
    const { shown, price, frame } = bank.run(request(NOW), () => readInDecision());
    expect(shown).toEqual(record);
    expect(shown).not.toBe(record);
    const bets = flopShownBetRead(shown, 'cbet', 'rainbow')!;
    expect(bets.shown).toBeGreaterThan(8);
    expect(bets.byClass.nut / bets.shown).toBeGreaterThan(0.8);
    expect(flopShownShare(bets, ['nut', 'strong'], 0.4)!.share).toBeGreaterThan(0.7);
    // a line and texture he has not shown a bet on is unknown
    expect(flopShownShare(flopShownBetRead(shown, 'first', 'paired'), ['nut'], 0.4)).toBeNull();
    const calls = flopShownCallRead(shown, 'horse', 'drawOop')!;
    expect(calls.n).toBe(40);
    expect(calls.netPerCallBb).toBeCloseTo(-5, 1);
    expect(flopShownCallRead(shown, 'person', 'drawOop')!.calls).toBe(0);
    expect(price!.flop!.price).toBeCloseTo(0.3, 12);
    expect(price!.flop!.opportunities).toBeGreaterThan(8);
    expect(price!.turn).toBeNull();
    expect(frame.version).toBe('horse-decision-reads-v20');
    expect(frame.json).toContain('"flopShown"');
    expect(frame.json).toContain('"streetPrice"');
  });

  it('2. unknown stays unknown: no record, a null record and columns not yet installed read null and keep the frame byte for byte', () => {
    const absent = bootedBank([row(undefined)]).run(request(NOW), () => readInDecision());
    HorseMind.reset();
    const nulled = bootedBank([row(null, null)]).run(request(NOW), () => readInDecision());
    HorseMind.reset();
    const nobody = bootedBank([]).run(request(NOW), () => readInDecision());
    for (const r of [absent, nulled, nobody]) {
      expect(r.shown).toBeNull();
      expect(r.price).toBeNull();
    }
    expect(absent.frame.version).not.toBe('horse-decision-reads-v20');
    expect(absent.frame.json).not.toContain('flopShown');
    expect(absent.frame.json).not.toContain('streetPrice');
    expect(nulled.frame).toEqual(absent.frame);
  });

  it('3. a malformed record is dropped, not trusted, and the row still reads exactly as a row with none', () => {
    const none = bootedBank([row(undefined)]).run(request(NOW), () => readInDecision());
    const good = shownRecord();
    for (const junk of [
      { bet: [], call: [] },
      'x',
      7,
      { ...good, extra: 1 },
      { ...good, bet: good.bet.map((v, i) => (i ? v : 0.5)) },
      { ...good, call: good.call.map((v, i) => (i ? v : -1)) },
    ]) {
      HorseMind.reset();
      const got = bootedBank([row(junk, { foldToRaise: { flop: { sum: 5, opp: 1 } } })]).run(
        request(NOW),
        () => readInDecision()
      );
      expect(got.shown, JSON.stringify(junk).slice(0, 40)).toBeNull();
      expect(got.price).toBeNull();
      expect(got.frame).toEqual(none.frame);
    }
  });

  it("4. a Hold'em decision carries nothing; another Omaha game is its own row", () => {
    const withRecord = bootedBank([row(shownRecord(), priceRecord(), 'nlh')]).run(
      request(NOW, 'nlh'),
      () => readInDecision('nlh')
    );
    HorseMind.reset();
    const without = bootedBank([row(undefined, undefined, 'nlh')]).run(request(NOW, 'nlh'), () =>
      readInDecision('nlh')
    );
    expect(withRecord.shown).toBeNull();
    expect(withRecord.price).toBeNull();
    expect(withRecord.frame).toEqual(without.frame);
    const sandbox = {
      ...HorseMind.createSandbox(),
      pooledFlopShown: new Map([[`nlh:cash:full|${bettor}`, shownRecord()]]),
      pooledStreetPrice: new Map([[`nlh:cash:full|${bettor}`, priceRecord()]]),
    };
    expect(
      HorseMind.runInSandbox(sandbox, () => {
        HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
        return [HorseMind.omahaFlopShownOf(bettor), HorseMind.omahaFoldToRaisePriceOf(bettor)];
      })
    ).toEqual([null, null]);
    HorseMind.reset();
    const plo5 = bootedBank([
      row(shownRecord(), priceRecord(), 'plo4'),
      row(undefined, undefined, 'plo5'),
    ]).run(request(NOW, 'plo5'), () => readInDecision('plo5'));
    expect(plo5.shown).toBeNull();
    expect(plo5.price).toBeNull();
  });

  it('5. availability: they arrive with an accepted hand, and a decision reads only what was accepted before its own time', () => {
    let clock = NOW - DAY;
    const early = shownRecord(10);
    const later = shownRecord(30);
    const bank = bootedBank([row(early)], NOW - DAY, () => clock);
    const T = NOW - DAY / 2;
    const before = bank.run(request(T - 1), () => readInDecision());
    expect(before.shown).toEqual(early);
    expect(before.price).toBeNull();
    clock = T;
    bank.complete(hand(1, row(later, priceRecord(), 'plo4', 'cash', 81)), () => {});
    const after = bank.run(request(T), () => readInDecision());
    expect(after.shown).toEqual(later);
    expect(after.price!.flop).not.toBeNull();
    expect(bank.run(request(T - 1), () => readInDecision()).shown).toBeNull();
    expect(bank.run(request(NOW - DAY - 1), () => readInDecision()).shown).toBeNull();
  });

  it('6. cash and tournament stay apart', () => {
    const bank = bootedBank([
      row(shownRecord(), priceRecord(), 'plo4', 'mtt'),
      row(null, null, 'plo4', 'cash'),
    ]);
    expect(bank.run(request(NOW), () => readInDecision()).shown).toBeNull();
    const mtt = bank.run(request(NOW, 'plo4', 'mtt'), () => readInDecision('plo4', 'mtt'));
    expect(mtt.shown).toEqual(shownRecord());
    expect(mtt.price!.flop).not.toBeNull();
    expect(mtt.frame.version).toBe('horse-decision-reads-v20');
  });

  it('7. the second look and an exact replay carry what the first look carried (read frame v20)', () => {
    const bank = bootedBank([row(shownRecord(), priceRecord())]);
    const first = bank.run(request(NOW), () => {
      const read = readInDecision();
      const view = HorseMind.snapshotDecisionReads(PLAYERS as never, null, {
        variant: 'plo4',
        mode: 'cash',
        size: 'full',
      });
      return { read, frame: encodeHorseDecisionReads(view, PLAYERS as never, null) };
    });
    expect(first.frame.version).toBe('horse-decision-reads-v20');
    // a process that holds none of this one's rows
    HorseMind.reset();
    const decoded = decodeHorseDecisionReads(first.frame, PLAYERS as never, null);
    expect(decoded.pooledFlopShown?.size).toBe(1);
    expect(decoded.pooledStreetPrice?.size).toBe(1);
    expect(decoded.pooledReraiseResponse).toBeUndefined();
    expect(decoded.pooledStreetRead).toBeUndefined();
    const again = HorseMind.runInSandbox(decoded, () => readInDecision());
    expect(again.shown).toEqual(first.read.shown);
    expect(again.price).toEqual(first.read.price);
    expect(again.frame).toEqual(first.read.frame);
    // the frame refuses a row that is not one, or that names a row the frame does not carry
    const body = JSON.parse(first.frame.json);
    const reseal = (b: unknown) => {
      const json = JSON.stringify(b);
      return {
        version: first.frame.version,
        bytes: Buffer.byteLength(json),
        sha256: createHash('sha256').update(json).digest('hex'),
        json,
      };
    };
    const edit = (f: (b: any) => void) => {
      const b = structuredClone(body);
      f(b);
      return b;
    };
    for (const bad of [
      edit((b) => b.flopShown[0][1].pop()),
      edit((b) => (b.flopShown[0][1][0] = 0.5)),
      edit((b) => (b.flopShown[0][1][0] = 60000)),
      edit((b) => (b.flopShown[0][0] = `plo4:cash:hu|${bettor}`)),
      edit((b) => (b.streetPrice[0][1][0] = 99)),
      edit((b) => b.streetPrice[0][1].pop()),
      edit((b) => (b.streetPrice[0][0] = `plo4:cash:hu|${bettor}`)),
      edit((b) => {
        b.flopShown = [];
        b.streetPrice = [];
      }),
      edit((b) => delete b.streetPrice),
    ])
      expect(() => decodeHorseDecisionReads(reseal(bad) as never, PLAYERS as never, null)).toThrow(
        'Horse decision read frame is invalid'
      );
    for (const good of [
      body,
      edit((b) => (b.flopShown = [])),
      edit((b) => (b.streetPrice = [])),
      // a return is a signed number
      edit((b) => (b.flopShown[0][1][40 + 2] = -77)),
    ])
      expect(() =>
        decodeHorseDecisionReads(reseal(good) as never, PLAYERS as never, null)
      ).not.toThrow();
  });

  it('8. ONE GATED READER: outside their owners and their transport, no engine source names the records but the street cells', () => {
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
    // the flop-shown accessor is defined in HorseMind and called by nothing
    expect(naming(/omahaFlopShownOf\(/)).toEqual(['engine/HorseMind.ts']);
    const mind = readFileSync(join(root, 'engine/HorseMind.ts'), 'utf8');
    expect(mind.match(/omahaFlopShownOf\(/g)).toHaveLength(1);
    expect(mind.match(/omahaFoldToRaisePriceOf\(/g)).toHaveLength(1);
    // the price accessor has ONE caller (horse decisions stack 2): the street-cell source of
    // omahaReadIsByStreetAndTexture, which asks it once, only with omahaSampledRaiseIsPricedAtEverySize === true
    // and only for a fold-to-raise cell that exists (the decisions it can move are proved in
    // HorseOmahaFoldToRaisePriceWired.test.ts)
    expect(naming(/omahaFoldToRaisePriceOf\(/)).toEqual([
      'engine/HorseMind.ts',
      'engine/HorseOmahaReadByStreetRule.ts',
    ]);
    const rule = readFileSync(join(root, 'engine/HorseOmahaReadByStreetRule.ts'), 'utf8');
    expect(rule.match(/omahaFoldToRaisePriceOf\(/g)).toHaveLength(1);
    expect(rule).toContain('const priced = opts.omahaSampledRaiseIsPricedAtEverySize === true;');
    expect(rule).toContain('if (!priced || !rates?.foldToRaise || !mode.street) return rates;');
    expect(rule.indexOf('if (!priced')).toBeLessThan(rule.indexOf('omahaFoldToRaisePriceOf('));
    // the readers of the records are called by nothing but HorseMind's price accessor
    expect(naming(/flopShownBetRead\(|flopShownCallRead\(|flopShownShare\(/)).toEqual([
      'engine/HorseOmahaFlopShown.ts',
    ]);
    expect(naming(/foldToRaisePrice\(/)).toEqual([
      'engine/HorseMind.ts',
      'engine/HorseOmahaStreetReadPrice.ts',
    ]);
    // the decision's carried state is touched only by its owner, the observer reads that fill it and the frame
    expect(naming(/pooledFlopShown|pooledStreetPrice/)).toEqual([
      'engine/HorseDecisionReadFrame.ts',
      'engine/HorseMind.ts',
      'engine/HorseOmahaFlopShown.ts',
      'engine/HorseOmahaStreetReadPrice.ts',
      'engine/horseDecision/observerReads.ts',
    ]);
    // the stored columns are named only by the profile copies (boot read, pooled rows) and the observer reads
    expect(
      naming(/flop_shown|street_counters_price|copyFlopShownRecord|copyStreetPriceRecord/)
    ).toEqual([
      'engine/HorseMind.ts',
      'engine/HorseOmahaFlopShown.ts',
      'engine/HorseOmahaStreetReadPrice.ts',
      'engine/HorseOpponentMemory.ts',
      'engine/horseDecision/observerReads.ts',
      'engine/horseDecision/pooledPublicProfiles.ts',
      'services/HorsePooledPublicBootstrap.ts',
    ]);
    // the modules are imported only by those files
    expect(
      naming(/from '\.\.?\/(?:engine\/)?(?:HorseOmahaFlopShown|HorseOmahaStreetReadPrice)\.js'/)
    ).toEqual([
      'engine/HorseDecisionReadFrame.ts',
      'engine/HorseMind.ts',
      'engine/HorseOpponentMemory.ts',
      'engine/horseDecision/observerReads.ts',
    ]);
    // the decision files, the flop verdict among them, do not name the records
    for (const f of [
      'HorseLogic.ts',
      'HorseOmahaFacingBetEv.ts',
      'HorseOmahaFlopFacingBetEv.ts',
      'HorseOmahaFlopFacingBetEvRule.ts',
      'HorseOmahaPricedRules.ts',
      'HorseOmahaReadByStreet.ts',
      'HorseOmahaCardImpact.ts',
      'HorseOmahaOopReraisedPot.ts',
    ])
      expect(readFileSync(join(root, 'engine', f), 'utf8')).not.toMatch(
        /FlopShown|flop_shown|StreetPrice|street_counters_price|FoldToRaisePrice/
      );
  });

  it('9. PUBLIC ONLY: the learner is passed the public columns of the hand and nothing else', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../supabase/migrations/20261119192551_the_exact_opponent_profile_keeps_what_a_flop_bet_showed.sql'
      ),
      'utf8'
    );
    // what the accepted-hand learner hands the two reducers: never hand_history.players, where a dealt hand sits
    expect(migration).toContain(
      'flop_shown_inc:=public.fn_horse_flop_shown_increments(h.actions,h.community_cards,h.community_cards2,h.hole_cards,h.showdown,h.winners,h.big_blind);'
    );
    expect(migration).toContain(
      'street_price_inc:=public.fn_horse_street_price_increments(h.actions,h.pot_size);'
    );
    expect(migration).not.toMatch(/h\.players|holeCardsAll|hand_facts/);
    // a hand is read only through the one function that requires the revealed holdings AND a showdown entry that
    // is not mucked
    const calls = migration.match(/fn_horse_flop_shown_class\(/g) ?? [];
    // its definition, its header line, the public gate's one call, and the privilege list
    expect(
      migration.match(/RETURN public\.fn_horse_flop_shown_class\(p_hole_cards->p_user,p_flop\);/g)
    ).toHaveLength(1);
    expect(migration.match(/:=public\.fn_horse_flop_shown_class\(/g)).toBeNull();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain(
      "IF sd IS NULL OR (sd->'mucked')='true'::jsonb THEN RETURN NULL; END IF;"
    );
    // the engine twin reads the same record and no private field
    const twin = readFileSync(resolve(process.cwd(), 'src/engine/HorseOmahaFlopShown.ts'), 'utf8');
    expect(twin).not.toMatch(/holeCardsAll|\.players\b|hole_cards_all/);
    // shown means mucked=false written out (20261119213206, review note N4): the twin reads the same rule
    expect(twin).toContain('entry.mucked !== false');
    expect(twin).not.toContain('entry.mucked === true');
  });

  it('10. HARDENED: one pass per list, the Omaha family only, shown only with mucked=false, no float8 overflow', () => {
    // 20261119213206 replaces what 20261119192551 defined (review notes N1, N2, N4, N6 of de83d3abf89); it is the
    // newest file to define the learner's functions, so its definitions are the ones production runs.
    const dir = resolve(process.cwd(), '../supabase/migrations');
    const name = '20261119213206_the_flop_shown_learner_reads_omaha_only_shown_only_when_unmu.sql';
    const hardening = readFileSync(join(dir, name), 'utf8');
    const definers = (fn: string): string[] =>
      readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .filter((f) =>
          readFileSync(join(dir, f), 'utf8').includes(`CREATE OR REPLACE FUNCTION public.${fn}(`)
        );
    for (const fn of [
      'fn_horse_flop_shown_add',
      'fn_horse_flop_shown_public_class',
      'fn_horse_street_price_add',
    ])
      expect(definers(fn).at(-1), fn).toBe(name);
    const body = (fn: string): string => {
      const start = hardening.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(start, fn).toBeGreaterThan(0);
      return hardening.slice(start, hardening.indexOf('$fn$;', start));
    };
    // N1: the add rule reads each of its four lists once, in one set-based pass, and never number by number
    const add = body('fn_horse_flop_shown_add');
    expect(add.match(/public\.fn_horse_flop_shown_wholes\(/g)).toHaveLength(4);
    expect(add).not.toContain('fn_horse_flop_shown_whole(');
    expect(add).not.toMatch(/\bFOR\b[^;]*\bLOOP\b[^;]*fn_horse_flop_shown_wholes/);
    const wholes = body('fn_horse_flop_shown_wholes');
    expect(wholes).toContain('LANGUAGE plpgsql IMMUTABLE');
    // and the one pass calls no function of ours per number
    expect(wholes.split('AS $fn$')[1]).not.toMatch(/public\.fn_/);
    // N2: both increments are computed only for the games whose decisions carry the records, and that list is
    // exactly the engine's FLOP_SHOWN_LEARNED_VARIANTS: every variant the learner admits that the transport carries
    const admitted = [
      'nlh',
      'plo4',
      'plo5',
      'plo6',
      'plo8',
      'flh',
      'flo8',
      'short_deck',
      'pineapple',
    ];
    expect([...FLOP_SHOWN_LEARNED_VARIANTS].sort()).toEqual(
      admitted.filter((v) => flopShownCarriedFor(v)).sort()
    );
    for (const v of ['nlh', 'flh', 'short_deck', 'pineapple'])
      expect(FLOP_SHOWN_LEARNED_VARIANTS, v).not.toContain(v);
    const gate = `IF h.game_variant IN (${FLOP_SHOWN_LEARNED_VARIANTS.map((v) => `'${v}'`).join(',')}) THEN
 flop_shown_inc:=public.fn_horse_flop_shown_increments(h.actions,h.community_cards,h.community_cards2,h.hole_cards,h.showdown,h.winners,h.big_blind);
 street_price_inc:=public.fn_horse_street_price_increments(h.actions,h.pot_size);
 END IF;`;
    expect(hardening.split(gate)).toHaveLength(2);
    expect(hardening.split('-- @live-proof:')[1].split('\n')[0]).toContain(
      gate.split('\n')[0].replace(/'/g, "''")
    );
    // N4: a showdown entry is shown only when mucked is the JSON boolean false
    const pub = body('fn_horse_flop_shown_public_class');
    expect(pub).toContain(
      "IF sd IS NULL OR (sd->'mucked') IS DISTINCT FROM 'false'::jsonb THEN RETURN NULL; END IF;"
    );
    expect(pub).not.toContain("='true'::jsonb");
    // N6: every float8 cast of a stored or supplied number sits behind a size guard under 1e12
    const priceAdd = body('fn_horse_street_price_add');
    expect(priceAdd).not.toContain('::double precision ELSE');
    expect(priceAdd.match(/public\.fn_horse_street_price_number\(/g)).toHaveLength(4);
    const num = body('fn_horse_street_price_number');
    expect(num.match(/::double precision/g)).toHaveLength(1);
    expect(num).toContain(
      "THEN CASE WHEN abs((p_value#>>'{}')::numeric)<1e12 THEN (p_value#>>'{}')::double precision"
    );
    // the engine twins hold the same rules
    const record = {
      foldToRaise: { flop: { sum: 1e400, opp: 1e308 }, turn: { sum: -1e13, opp: 5 } },
    };
    const after = addStreetPriceEvidence(record as unknown as StreetPriceCounters, {
      foldToRaise: {
        flop: { sum: 0.4, opp: 1 },
        turn: { sum: 0, opp: 0 },
        river: { sum: 0, opp: 0 },
      },
    });
    expect(after?.foldToRaise).toEqual({
      flop: { sum: 0.4, opp: 1 },
      turn: { sum: 0, opp: 5 },
      river: { sum: 0, opp: 0 },
    });
    // nothing outside the Omaha family carries either record to a decision
    for (const v of admitted)
      expect(flopShownCarriedFor(v), v).toBe(FLOP_SHOWN_LEARNED_VARIANTS.includes(v));
  });
});
