/**
 * LAW: no switchable Omaha rule keys on whether an opponent is a person or a Horse (owner rule 8).
 *
 * Every legacy dark Omaha option on main that reads `omahaOpponentKindOf`, `humanUserIds`, or
 * opponent `.is_horse` MUST stay locked in `OPTION_SWITCH_OFF_ONLY` (never switchable ON and never
 * release-default ON), and no new Omaha rule file or `HorseLogic.ts` call site may introduce a
 * person-vs-Horse check.
 *
 * The one live option that shares `HorseOmahaPreflopReraiseDefenceRule.ts`
 * (`omahaPreflopReraiseDefencePricedInPosition`) enters only on a given `'fold'` (`risk === null`,
 * never the 4-bet branch), so its output is proved invariant when the 3-bettor switches between
 * person (`humanUserIds` / `is_horse: false`) and Horse (`is_horse: true`).
 *
 * Also pins the twice-failed PLO4/PLO5 options ruled OFF-ONLY by PLO-OWNER lead-4 (2026-11-21):
 * `omahaBluffIsPricedAgainstTheTarget`, `omahaFacingBetValueShareIsMeasured`, and
 * `omahaMultiwayIsPricedInTournaments`.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  OPTION_SWITCH_OFF_ONLY,
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_RELEASE_DEFAULT_ON,
} from './HorseOptionSwitch.js';
import { omahaPreflopReraiseDefenceRule } from './HorseOmahaPreflopReraiseDefenceRule.js';

const ENGINE_DIR = __dirname;

/**
 * Legacy Omaha options whose implementation reads person vs Horse (`omahaOpponentKindOf` or
 * opponent `.is_horse`). Every one MUST stay in `OPTION_SWITCH_OFF_ONLY` until de-keyed or deleted.
 */
const LEGACY_PERSON_VS_HORSE_OMAHA_OPTIONS = [
  // AUDIT-B item 22 (9 dark options)
  'omahaBluffShareFromBetRate',
  'omahaPricedPriorsByOpponentKind',
  'omahaFlopBetUsesMeasuredFoldShare',
  'omahaFlopBetPricesTheRaise',
  'omahaFoldModelFittedOnPeople',
  'omahaFlopDefenceIsPriced',
  'omahaFlopVerdictReadsTheBettor',
  'omahaCheckedToBetIsPriced',
  'omahaBluffIsPricedAgainstTheTarget',
  // Exhaustive scan additions (6 dark options)
  'omahaFacingBetValueShareIsMeasured',
  'omahaPairedBoardRiverIsPriced',
  'omahaFacingBetValueIsRangeRelative',
  'omahaFacingBetIsPricedByEquity',
  'omahaMultiwayCheckedToBetIsPriced',
  'omahaSmallBetIsPriced',
  // AUDIT-B item 21 (parent option; already OFF-ONLY under owner preflop hold)
  'omahaPreflopReraiseDefencePriced',
] as const;

/** Twice-failed PLO4/PLO5 options ruled OFF-ONLY by PLO-OWNER lead-4 (2026-11-21). */
const TWICE_FAILED_PLO45_OFF_ONLY_OPTIONS = [
  'omahaBluffIsPricedAgainstTheTarget',
  'omahaFacingBetValueShareIsMeasured',
  'omahaMultiwayIsPricedInTournaments',
] as const;

/**
 * Shrinking legacy allowlist of non-test files under `server/src/engine/` permitted to call
 * `omahaOpponentKindOf(` (excluding its own definition in `HorseOmahaPricedMode.ts`).
 * Removing a file from this list is welcome; adding a new caller fails the law.
 */
const LEGACY_KIND_CALLER_FILES = new Set<string>([
  'HorseLogic.ts',
  'HorseOmahaBluffPricedAgainstTheTarget.ts',
  'HorseOmahaCheckedToBet.ts',
  'HorseOmahaFacingBetEv.ts',
  'HorseOmahaFlopBetMeasuredFoldShare.ts',
  'HorseOmahaFlopBetRaiseBranch.ts',
  'HorseOmahaFlopFacingBetEvRule.ts',
  'HorseOmahaFoldModelFittedOnPeople.ts',
  'HorseOmahaPreflopReraiseDefenceRule.ts',
  'HorseOmahaPricedWiring.ts',
]);

/**
 * Shrinking legacy allowlist of `HorseOmaha*.ts` files permitted to inspect `.is_horse` or
 * `humanUserIds` directly (excluding `HorseOmahaPricedMode.ts`, which defines `omahaOpponentKindOf`).
 */
const LEGACY_OMAHA_DIRECT_KIND_FILES = new Set<string>([
  'HorseOmahaFacingBetEquity.ts',
  'HorseOmahaMultiwayDiscipline.ts',
  'HorseOmahaSmallBet.ts',
]);

/** Exact upper bound on `omahaOpponentKindOf(` calls in `HorseLogic.ts` (all 3 are OFF-ONLY). */
const MAX_HORSE_LOGIC_KIND_CALLS = 3;

function nonTestEngineTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__fixtures__') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...nonTestEngineTsFiles(full));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test-support.ts') &&
      !entry.name.endsWith('.fixtures.ts')
    ) {
      out.push(relative(ENGINE_DIR, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((t) => ({
    rank: (t[0] === 'T' ? '10' : t[0]) as CardRank,
    suit: SUIT[t[1]!]!,
  }));

function buildInPositionThreeBetSpot(raiserIsHorse: boolean): {
  hero: SeatPlayer;
  gs: HorseGameStateV2;
} {
  const HERO = '86000001-0000-4000-8000-0000000000a1';
  const VILLAIN = '40000000-0000-4000-8000-0000000000b2';
  const OTHER = (n: number) => `4000000${n}-0000-4000-8000-0000000000c${n}`;
  const seats = [1, 2, 3, 4, 5, 6];
  const bet: Record<number, number> = { 1: 1, 2: 22, 3: 0, 4: 0, 5: 0, 6: 7 };
  const hist = [
    { stage: 'preflop', seat: 1, userId: OTHER(1), action: 'sb', amount: 1, timestamp: 1 },
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'bb', amount: 2, timestamp: 2 },
    { stage: 'preflop', seat: 3, userId: OTHER(3), action: 'fold', amount: 0, timestamp: 3 },
    { stage: 'preflop', seat: 4, userId: OTHER(4), action: 'fold', amount: 0, timestamp: 4 },
    { stage: 'preflop', seat: 5, userId: OTHER(5), action: 'fold', amount: 0, timestamp: 5 },
    {
      stage: 'preflop',
      seat: 6,
      userId: HERO,
      action: 'raise',
      amount: 7,
      isFullRaise: true,
      timestamp: 6,
    },
    { stage: 'preflop', seat: 1, userId: OTHER(1), action: 'fold', amount: 0, timestamp: 7 },
    {
      stage: 'preflop',
      seat: 2,
      userId: VILLAIN,
      action: 'raise',
      amount: 22,
      isFullRaise: true,
      timestamp: 8,
    },
  ];
  const players = seats.map(
    (n) =>
      ({
        seat: n,
        user_id: n === 6 ? HERO : n === 2 ? VILLAIN : OTHER(n),
        username: `P${n}`,
        stack: 400 - bet[n]!,
        bet: bet[n],
        totalInvested: bet[n],
        cards: n === 6 ? cards('AsKsQhJhTh') : [],
        is_folded: n !== 6 && n !== 2,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: n === 6 || (n === 2 && raiserIsHorse),
      }) as SeatPlayer
  );
  const humanUserIds = raiserIsHorse
    ? [OTHER(1), OTHER(3), OTHER(4), OTHER(5)]
    : [OTHER(1), VILLAIN, OTHER(3), OTHER(4), OTHER(5)];
  const gs = {
    players,
    communityCards: [],
    pot: 30,
    currentBet: 22,
    toCall: 15,
    minRaise: 15,
    minRaiseTo: 37,
    maxRaiseTo: 67,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: 'plo5',
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 6,
    humanUserIds,
    gameMode: 'cash',
    publicMemoryDomain: { speed: 'table' },
    actionHistory: hist,
  } as unknown as HorseGameStateV2;
  return { hero: players.find((p) => p.seat === 6)!, gs };
}

describe('LAW: no switchable Omaha rule keys on person vs Horse (owner rule 8)', () => {
  it('locks every legacy person-vs-Horse Omaha option in OPTION_SWITCH_OFF_ONLY and never default-ON', () => {
    const unlocked = LEGACY_PERSON_VS_HORSE_OMAHA_OPTIONS.filter(
      (name) =>
        !OPTION_SWITCH_OFF_ONLY_NAMES.includes(name) || !Object.hasOwn(OPTION_SWITCH_OFF_ONLY, name)
    );
    expect(
      unlocked,
      'Every Omaha option keying on person vs Horse must be locked in OPTION_SWITCH_OFF_ONLY'
    ).toEqual([]);

    const defaultOn = LEGACY_PERSON_VS_HORSE_OMAHA_OPTIONS.filter((name) =>
      OPTION_SWITCH_RELEASE_DEFAULT_ON.includes(name)
    );
    expect(defaultOn).toEqual([]);
  });

  it('locks the twice-failed PLO4/PLO5 options in OPTION_SWITCH_OFF_ONLY and never default-ON', () => {
    const unlocked = TWICE_FAILED_PLO45_OFF_ONLY_OPTIONS.filter(
      (name) =>
        !OPTION_SWITCH_OFF_ONLY_NAMES.includes(name) || !Object.hasOwn(OPTION_SWITCH_OFF_ONLY, name)
    );
    expect(unlocked).toEqual([]);

    const defaultOn = TWICE_FAILED_PLO45_OFF_ONLY_OPTIONS.filter((name) =>
      OPTION_SWITCH_RELEASE_DEFAULT_ON.includes(name)
    );
    expect(defaultOn).toEqual([]);
  });

  it('forbids any new engine file or new HorseLogic.ts call site from calling omahaOpponentKindOf', () => {
    const files = nonTestEngineTsFiles(ENGINE_DIR);
    const unexpectedCallers: string[] = [];
    let horseLogicCalls = 0;

    for (const rel of files) {
      if (rel === 'HorseOmahaPricedMode.ts') continue;
      const raw = readFileSync(join(ENGINE_DIR, rel), 'utf8');
      if (!raw.includes('omahaOpponentKindOf')) continue;
      const code = stripCommentsAndStrings(raw);
      const matches = code.match(/\bomahaOpponentKindOf\s*\(/g);
      if (!matches) continue;
      if (rel === 'HorseLogic.ts') horseLogicCalls = matches.length;
      if (!LEGACY_KIND_CALLER_FILES.has(rel)) {
        unexpectedCallers.push(`${rel} (${matches.length} call(s))`);
      }
    }

    expect(
      unexpectedCallers,
      'New Omaha code must never call omahaOpponentKindOf (owner rule 8: no rule keyed on person vs Horse)'
    ).toEqual([]);
    expect(
      horseLogicCalls,
      'HorseLogic.ts must not add new omahaOpponentKindOf call sites beyond the 3 locked OFF-ONLY sites'
    ).toBeLessThanOrEqual(MAX_HORSE_LOGIC_KIND_CALLS);
  });

  it('forbids any new HorseOmaha*.ts file from reading .is_horse or humanUserIds directly', () => {
    const files = nonTestEngineTsFiles(ENGINE_DIR).filter(
      (rel) => rel.startsWith('HorseOmaha') && rel !== 'HorseOmahaPricedMode.ts'
    );
    const unexpected: string[] = [];

    for (const rel of files) {
      const raw = readFileSync(join(ENGINE_DIR, rel), 'utf8');
      if (!raw.includes('is_horse') && !raw.includes('humanUserIds')) continue;
      const code = stripCommentsAndStrings(raw);
      if (
        /\.\s*is_horse\b|\bhumanUserIds\b/.test(code) &&
        !LEGACY_OMAHA_DIRECT_KIND_FILES.has(rel)
      ) {
        unexpected.push(rel);
      }
    }

    expect(
      unexpected,
      'New HorseOmaha*.ts files must never branch on opponent .is_horse or humanUserIds (owner rule 8)'
    ).toEqual([]);
  });

  it('proves the live omahaPreflopReraiseDefencePricedInPosition path is invariant to person vs Horse', () => {
    const asPerson = buildInPositionThreeBetSpot(false);
    const asHorse = buildInPositionThreeBetSpot(true);
    const givenFold = { action: 'fold' as const, thinkTime: 0 };
    const resPerson = omahaPreflopReraiseDefenceRule(givenFold, asPerson.hero, asPerson.gs, {
      mind: false,
      telemetry: false,
    });
    const resHorse = omahaPreflopReraiseDefenceRule(givenFold, asHorse.hero, asHorse.gs, {
      mind: false,
      telemetry: false,
    });
    expect(resPerson).not.toBeNull();
    expect(resHorse).toEqual(resPerson);
  });
});
