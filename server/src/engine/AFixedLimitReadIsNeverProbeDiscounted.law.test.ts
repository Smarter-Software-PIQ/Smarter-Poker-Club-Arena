/**
 * LAW: A FIXED-LIMIT READ IS NEVER PROBE-DISCOUNTED (2026-11-15, Fixed-Limit
 * lane, "F1b"; the read-time half of A FIXED-LIMIT BET IS NEVER A PROBE).
 *
 * The probe tallies (OpponentStats.ctBets / ctProbes) are pooled per player
 * across every game he plays. With HorseMind.setFixedLimitBetsAreNeverProbes
 * on, a fixed-limit hand adds nothing to them (count time), so they hold only
 * his no-limit and pot-limit bets. Before this law the read still applied
 * that pooled share to every read (HorseMind.probeAdjusted and the three
 * direct uses in omahaTightReadOf, styleRead and streetBullyRead), so a player
 * who min-bets at no limit had his FIXED-LIMIT betCheckedTo cut by his
 * no-limit probe share although every fixed-limit bet is the street's one
 * legal size.
 *
 * Law: F1b is its OWN decide option since 2026-11-16,
 * HorseDecideOpts.fixedLimitReadIgnoresProbes, default OFF and registered in
 * the live option switch (owner Fixed-Limit), because its value is not
 * demonstrated (AB-EVALUATION-2.md 3.1, 3.10). (a) With the option off (the
 * default) every fixed-limit read is probe-adjusted exactly as main reads it
 * with the F1 process switch on. (b) With the option on AND the F1 switch on,
 * when the decision in flight is fixed limit by its BETTING STRUCTURE (the
 * game state's bettingStructure, the variant only when the state gives none),
 * no probe discount is applied to the read and the withholding is receipted
 * (fixed_limit_read_probe_discount_withheld); with the switch off the
 * fixed-limit read is discounted exactly as before. (c) No-limit and
 * pot-limit reads are byte-identical in every state of the option and the
 * switch. (d) The option's default is off.
 *
 * The structure, not the variant name: a four-card fixed-limit Omaha built as
 * plo4 card rules with fixed-limit betting (main cannot deal flo4; #10865 adds
 * it) is a fixed-limit read, through HorseLogic.prepareOriginalReads too, and
 * the same plo4 decision without a fixed-limit structure is pot limit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT,
  HorseMind,
  type ReadScope,
} from './HorseMind.js';
import {
  exploitEnvelopeFor,
  isPostflopManiac,
  opponentExploitRead,
  probeAdjustedCounters,
  statRead,
} from './HorseOpponentExploit.js';
import { omahaTightRead } from './HorseOmahaTightOpponent.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { OPTION_SWITCH_REGISTRY } from './HorseOptionSwitch.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { BettingStructure } from './BettingStructure.js';
import type { ActionRecord, SeatPlayer } from '../types.js';

const BB = 2;
const HERO = '10000000-0000-4000-8000-0000000000a1';
const OPP = '10000000-0000-4000-8000-0000000000a2';
let ts = 5_000_000;

function line(preflopRaise: number, streets: ReadonlyArray<readonly [string, number]>) {
  const out: ActionRecord[] = [];
  const push = (userId: string, action: string, amount: number, stage: string) =>
    out.push({
      seat: userId === HERO ? 1 : 2,
      userId,
      action,
      amount,
      timestamp: ts++,
      stage,
    } as ActionRecord);
  push(OPP, 'raise', preflopRaise, 'preflop');
  push(HERO, 'call', preflopRaise - BB / 2, 'preflop');
  for (const [stage, bet] of streets) {
    push(HERO, 'check', 0, stage);
    push(OPP, 'bet', bet, stage);
    push(HERO, 'call', bet, stage);
  }
  return out;
}

/** Fixed limit 1/2: OPP bets one fixed bet into every checked street. */
const fixedLimitManiacHand = () =>
  line(4, [
    ['flop', 2],
    ['turn', 4],
    ['river', 4],
  ]);
/** No limit: one-big-blind probes on every street (three probes). */
const noLimitProbeHand = () =>
  line(5, [
    ['flop', BB],
    ['turn', BB],
    ['river', BB],
  ]);
/** No limit: pot-sized bets on every street (three bets, no probe). */
const noLimitPotBetHand = () =>
  line(5, [
    ['flop', 10],
    ['turn', 30],
    ['river', 90],
  ]);

function feed(
  hands: number,
  make: () => ActionRecord[],
  scope: ReadScope,
  variant: string,
  structure: BettingStructure
): void {
  for (let h = 0; h < hands; h++) {
    const history = make();
    HorseMind.setDecisionScope(scope, variant, 'cash');
    HorseMind.observe(history, [], undefined, undefined, BB, structure);
    HorseMind.setDecisionScope(null);
    HorseMind.observeHandComplete(`flread:${h}:${ts}`, history, BB, null, scope);
  }
}

/**
 * The player: 100 fixed-limit maniac hands at a fixed-limit table (FL scope),
 * 30 no-limit probe hands and 10 no-limit pot-bet hands at a no-limit table
 * (NL scope, a different table size so the two exploit rows stay apart).
 * Counted with the switch ON (production): ctBets 120, ctProbes 90, a 75
 * percent no-limit probe share, nothing from fixed limit.
 */
function buildPlayer(fl: { scope: ReadScope; variant: string; structure: BettingStructure }) {
  HorseMind.setFixedLimitBetsAreNeverProbes(true);
  feed(100, fixedLimitManiacHand, fl.scope, fl.variant, fl.structure);
  const nlScope = (fl.scope.startsWith('omaha') ? 'omaha:full' : 'holdem:full') as ReadScope;
  const nlVariant = fl.scope.startsWith('omaha') ? 'plo4' : 'nlh';
  const nlStructure: BettingStructure = fl.scope.startsWith('omaha') ? 'pot_limit' : 'no_limit';
  feed(30, noLimitProbeHand, nlScope, nlVariant, nlStructure);
  feed(10, noLimitPotBetHand, nlScope, nlVariant, nlStructure);
  const s = HorseMind.getStats(OPP)!;
  expect(s.ctBets).toBe(120);
  expect(s.ctProbes).toBe(90);
  return { nlScope, nlVariant, nlStructure };
}

/** The F1b option for the reads below: the (b) cases run it on; the (a) cases set it off. */
let f1bOption = true;
function readAt(
  scope: ReadScope,
  variant: string,
  structure?: BettingStructure,
  read: () => unknown = () => HorseMind.opponentRead(OPP)
) {
  HorseMind.setDecisionScope(scope, variant, 'cash');
  if (structure) HorseMind.setDecisionBettingStructure(structure);
  HorseMind.setDecisionFixedLimitReadIgnoresProbes(f1bOption);
  try {
    return read();
  } finally {
    HorseMind.setDecisionScope(null);
  }
}

function expected(scope: ReadScope, variant: string, discounted: boolean) {
  const raw = HorseMind.getExploitCounters(OPP, scope)!;
  const s = HorseMind.getStats(OPP)!;
  return opponentExploitRead(
    discounted ? probeAdjustedCounters(raw, s.ctBets, s.ctProbes) : raw,
    scope,
    variant
  );
}

afterEach(() => {
  f1bOption = true;
  HorseMind.setFixedLimitBetsAreNeverProbes(FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT);
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('a fixed-limit read is never probe-discounted', () => {
  it('(d) is its own option, registered default OFF (owner Fixed-Limit), on top of the F1 switch whose source default is on', () => {
    expect(FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT).toBe(true);
    expect(HorseMind.fixedLimitBetsAreNeverProbesOn()).toBe(true);
    const entry = OPTION_SWITCH_REGISTRY.find((e) => e.name === 'fixedLimitReadIgnoresProbes');
    expect(entry?.releaseDefault).toBe('off');
    expect(entry?.owner).toBe('Fixed-Limit');
    expect(entry?.offOnly).toBeUndefined();
    // Without the setter in a fresh scope the option is off: the read is discounted.
    buildPlayer({ scope: 'holdem:hu', variant: 'flh', structure: 'fixed_limit' });
    HorseMind.setDecisionScope('holdem:hu', 'flh', 'cash');
    HorseMind.setDecisionBettingStructure('fixed_limit');
    try {
      expect(HorseMind.opponentRead(OPP)).toEqual(expected('holdem:hu', 'flh', true));
    } finally {
      HorseMind.setDecisionScope(null);
    }
    // The option does not outlive its scope.
    HorseMind.setDecisionScope('holdem:hu', 'flh', 'cash');
    HorseMind.setDecisionFixedLimitReadIgnoresProbes(true);
    HorseMind.setDecisionScope('holdem:hu', 'flh', 'cash');
    HorseMind.setDecisionBettingStructure('fixed_limit');
    try {
      expect(HorseMind.opponentRead(OPP)).toEqual(expected('holdem:hu', 'flh', true));
    } finally {
      HorseMind.setDecisionScope(null);
    }
  });

  for (const fl of [
    { name: 'flh', scope: 'holdem:hu', variant: 'flh', structure: 'fixed_limit' },
    { name: 'flo8', scope: 'omaha:hu', variant: 'flo8', structure: 'fixed_limit' },
  ] as const) {
    it(`(a) ${fl.name}: with the option off (default) and F1 on, the fixed-limit read is probe-adjusted exactly as main`, () => {
      enableBrainTelemetry();
      buildPlayer(fl);
      drainFires();
      f1bOption = false;
      const off = readAt(fl.scope, fl.variant) as ReturnType<typeof expected>;
      const fires = drainFires().map((f) => f.feature);
      expect(fires).not.toContain('fixed_limit_read_probe_discount_withheld');
      expect(fires).toContain('opponent_read_probe_bets_discounted');
      expect(off!.stats.betCheckedTo.mean).toBeCloseTo(
        expected(fl.scope, fl.variant, true)!.stats.betCheckedTo.mean,
        12
      );
      if (fl.variant === 'flh') {
        expect(off).toEqual(expected(fl.scope, fl.variant, true));
        expect(isPostflopManiac(off)).toBe(false);
      }
      // Identical to the F1-switch-off read (main before F1b), whatever the switch says.
      HorseMind.setFixedLimitBetsAreNeverProbes(false);
      expect(readAt(fl.scope, fl.variant)).toEqual(off);
    });
  }

  it('(a) with the option off, the Omaha tight read, the style read and the streetBullyRead fallback are probe-adjusted as main', () => {
    buildPlayer({ scope: 'omaha:hu', variant: 'flo8', structure: 'fixed_limit' });
    const raw = HorseMind.getExploitCounters(OPP, 'omaha:hu')!;
    const s = HorseMind.getStats(OPP)!;
    const adjusted = probeAdjustedCounters(raw, s.ctBets, s.ctProbes);
    f1bOption = false;
    const tight = readAt('omaha:hu', 'flo8', undefined, () => HorseMind.omahaTightReadOf(OPP));
    expect(tight).toEqual(
      omahaTightRead(
        adjusted,
        'omaha:hu',
        'flo8',
        opponentExploitRead(adjusted, 'omaha:hu', 'flo8')
      )
    );
    const style = readAt('omaha:hu', 'flo8', undefined, () => HorseMind.styleRead(OPP));
    const bully = readAt('omaha:hu', 'flo8', 'fixed_limit', () => HorseMind.streetBullyRead(OPP));
    HorseMind.setFixedLimitBetsAreNeverProbes(false);
    expect(readAt('omaha:hu', 'flo8', undefined, () => HorseMind.styleRead(OPP))).toEqual(style);
    expect(readAt('omaha:hu', 'flo8', 'fixed_limit', () => HorseMind.streetBullyRead(OPP))).toEqual(
      bully
    );
  });

  it('(c) no-limit and pot-limit reads are byte-identical in every state of the option and the switch', () => {
    const { nlScope, nlVariant } = buildPlayer({
      scope: 'holdem:hu',
      variant: 'flh',
      structure: 'fixed_limit',
    });
    f1bOption = false;
    const base = readAt(nlScope, nlVariant);
    const ploStyle = readAt('omaha:hu', 'plo4', 'pot_limit', () => HorseMind.styleRead(OPP));
    const ploRead = readAt('omaha:hu', 'plo4', 'pot_limit');
    expect(base).toEqual(expected(nlScope, nlVariant, true));
    for (const option of [false, true])
      for (const sw of [false, true]) {
        f1bOption = option;
        HorseMind.setFixedLimitBetsAreNeverProbes(sw);
        expect(readAt(nlScope, nlVariant)).toEqual(base);
        expect(readAt('omaha:hu', 'plo4', 'pot_limit')).toEqual(ploRead);
        expect(readAt('omaha:hu', 'plo4', 'pot_limit', () => HorseMind.styleRead(OPP))).toEqual(
          ploStyle
        );
      }
  });

  for (const fl of [
    { name: 'flh', scope: 'holdem:hu', variant: 'flh', structure: 'fixed_limit' },
    { name: 'flo8', scope: 'omaha:hu', variant: 'flo8', structure: 'fixed_limit' },
  ] as const) {
    it(`${fl.name}: (b) option on: a heavy no-limit prober's fixed-limit read is not discounted (switch on), and is discounted exactly as before (switch off)`, () => {
      enableBrainTelemetry();
      buildPlayer(fl);
      drainFires();
      // ON: the read is the raw fixed-limit counters' read.
      const on = readAt(fl.scope, fl.variant) as ReturnType<typeof expected>;
      const fires = drainFires().map((f) => f.feature);
      expect(fires).toContain('fixed_limit_read_probe_discount_withheld');
      expect(fires).not.toContain('opponent_read_probe_bets_discounted');
      if (fl.variant === 'flh') {
        expect(on).toEqual(expected(fl.scope, fl.variant, false));
        expect(on!.stats.betCheckedTo.mean).toBeGreaterThanOrEqual(0.9);
        expect(isPostflopManiac(on)).toBe(true);
      } else {
        expect(on?.stats.betCheckedTo.mean).toBeCloseTo(
          expected(fl.scope, fl.variant, false)!.stats.betCheckedTo.mean,
          12
        );
      }
      // OFF (read time only: the counts above stay as they are): today's read.
      HorseMind.setFixedLimitBetsAreNeverProbes(false);
      const off = readAt(fl.scope, fl.variant) as ReturnType<typeof expected>;
      expect(drainFires().map((f) => f.feature)).toContain('opponent_read_probe_bets_discounted');
      if (fl.variant === 'flh') {
        expect(off).toEqual(expected(fl.scope, fl.variant, true));
        expect(isPostflopManiac(off)).toBe(false);
      }
      expect(off!.stats.betCheckedTo.mean).toBeLessThan(on!.stats.betCheckedTo.mean);
      expect(off!.stats.betCheckedTo.mean).toBeCloseTo(
        expected(fl.scope, fl.variant, true)!.stats.betCheckedTo.mean,
        12
      );
    });
  }

  it("the same player's no-limit read is still discounted, byte-identical with the switch on or off", () => {
    const { nlScope, nlVariant } = buildPlayer({
      scope: 'holdem:hu',
      variant: 'flh',
      structure: 'fixed_limit',
    });
    const on = readAt(nlScope, nlVariant);
    expect(on).toEqual(expected(nlScope, nlVariant, true));
    expect(on).not.toEqual(expected(nlScope, nlVariant, false));
    HorseMind.setFixedLimitBetsAreNeverProbes(false);
    expect(readAt(nlScope, nlVariant)).toEqual(on);
    // Pot-limit Omaha likewise.
    HorseMind.reset();
    const plo = buildPlayer({ scope: 'omaha:hu', variant: 'flo8', structure: 'fixed_limit' });
    HorseMind.setFixedLimitBetsAreNeverProbes(true);
    const ploOn = readAt(plo.nlScope, plo.nlVariant);
    HorseMind.setFixedLimitBetsAreNeverProbes(false);
    expect(readAt(plo.nlScope, plo.nlVariant)).toEqual(ploOn);
  });

  it('the Omaha tight read and the style read take no probe share at fixed limit, and keep it at pot limit', () => {
    buildPlayer({ scope: 'omaha:hu', variant: 'flo8', structure: 'fixed_limit' });
    const raw = HorseMind.getExploitCounters(OPP, 'omaha:hu')!;
    const s = HorseMind.getStats(OPP)!;
    const adjusted = probeAdjustedCounters(raw, s.ctBets, s.ctProbes);
    const tightOn = readAt('omaha:hu', 'flo8', undefined, () => HorseMind.omahaTightReadOf(OPP));
    expect(tightOn).toEqual(
      omahaTightRead(raw, 'omaha:hu', 'flo8', opponentExploitRead(raw, 'omaha:hu', 'flo8'))
    );
    const styleOn = readAt('omaha:hu', 'flo8', undefined, () => HorseMind.styleRead(OPP));
    HorseMind.setFixedLimitBetsAreNeverProbes(false);
    const tightOff = readAt('omaha:hu', 'flo8', undefined, () => HorseMind.omahaTightReadOf(OPP));
    expect(tightOff).toEqual(
      omahaTightRead(
        adjusted,
        'omaha:hu',
        'flo8',
        opponentExploitRead(adjusted, 'omaha:hu', 'flo8')
      )
    );
    const styleOff = readAt('omaha:hu', 'flo8', undefined, () => HorseMind.styleRead(OPP));
    expect(styleOff).not.toEqual(styleOn);
    // Pot limit (the same counters read as a plo4 decision): identical on and off.
    const ploOff = readAt('omaha:hu', 'plo4', undefined, () => HorseMind.styleRead(OPP));
    HorseMind.setFixedLimitBetsAreNeverProbes(true);
    expect(readAt('omaha:hu', 'plo4', undefined, () => HorseMind.styleRead(OPP))).toEqual(ploOff);
  });

  it('streetBullyRead: the counter fallback (presumed read, no flop-stab row) takes no probe share at fixed limit, and keeps it at pot limit', () => {
    // The fallback inside streetBullyRead runs only when the read gives no
    // betCheckedTo of its own (an Omaha read the presumption supplied) and
    // there is no flop-stab row for this scope and player (as after a worker
    // boot, when the counters come from the durable store and no flop has
    // been seen yet). Ten passive fixed-limit hands keep the preflop evidence
    // under PRESUMPTION_PROOF_MIN_OPPS, so the flo8 read stays presumed.
    HorseMind.setFixedLimitBetsAreNeverProbes(true);
    const passiveBettorHand = () => {
      const out: ActionRecord[] = [];
      const push = (userId: string, action: string, amount: number, stage: string) =>
        out.push({
          seat: userId === HERO ? 1 : 2,
          userId,
          action,
          amount,
          timestamp: ts++,
          stage,
        } as ActionRecord);
      push(OPP, 'call', BB / 2, 'preflop');
      push(HERO, 'check', 0, 'preflop');
      for (const [stage, bet] of [
        ['flop', 2],
        ['turn', 4],
        ['river', 4],
      ] as const) {
        push(HERO, 'check', 0, stage);
        push(OPP, 'bet', bet, stage);
        push(HERO, 'call', bet, stage);
      }
      return out;
    };
    feed(10, passiveBettorHand, 'omaha:hu', 'flo8', 'fixed_limit');
    feed(30, noLimitProbeHand, 'omaha:full', 'plo4', 'pot_limit');
    feed(10, noLimitPotBetHand, 'omaha:full', 'plo4', 'pot_limit');
    const s = HorseMind.getStats(OPP)!;
    expect(s.ctBets).toBe(120);
    expect(s.ctProbes).toBe(90);
    (HorseMind as unknown as { flopStabCounters: Map<string, unknown> }).flopStabCounters.delete(
      `omaha:hu|${OPP}`
    );
    expect(HorseMind.getFlopStabCounters(OPP, 'omaha:hu')).toBeUndefined();
    const raw = HorseMind.getExploitCounters(OPP, 'omaha:hu')!;
    expect(raw.betCheckedToOpp).toBeGreaterThan(0);
    const adjusted = probeAdjustedCounters(raw, s.ctBets, s.ctProbes);
    const want = (c: typeof raw, variant: string) =>
      statRead(
        c.betCheckedTo,
        c.betCheckedToOpp,
        exploitEnvelopeFor('omaha:hu', variant)!.betCheckedTo,
        ['high']
      ).mean;
    const bully = () => HorseMind.streetBullyRead(OPP);
    // The path is the presumed one.
    const presumed = readAt('omaha:hu', 'flo8', 'fixed_limit') as { presumed?: boolean } | null;
    expect(presumed?.presumed).toBe(true);
    // Fixed limit, switch on: the whole counters.
    const on = readAt('omaha:hu', 'flo8', 'fixed_limit', bully) as { stabRate: number };
    expect(on.stabRate).toBeCloseTo(want(raw, 'flo8'), 12);
    // Switch off: discounted exactly as before.
    HorseMind.setFixedLimitBetsAreNeverProbes(false);
    const off = readAt('omaha:hu', 'flo8', 'fixed_limit', bully) as { stabRate: number };
    expect(off.stabRate).toBeCloseTo(want(adjusted, 'flo8'), 12);
    expect(on.stabRate).toBeGreaterThan(off.stabRate);
    // Pot limit (the same counters read as a plo4 decision): discounted, identical on and off.
    const ploOff = readAt('omaha:hu', 'plo4', 'pot_limit', bully);
    HorseMind.setFixedLimitBetsAreNeverProbes(true);
    const ploOn = readAt('omaha:hu', 'plo4', 'pot_limit', bully) as { stabRate: number };
    expect(ploOn).toEqual(ploOff);
    expect(ploOn.stabRate).toBeCloseTo(want(adjusted, 'plo4'), 12);
  });

  it('keys on the betting structure, not the variant name: plo4 card rules with fixed-limit betting are a fixed-limit read', () => {
    enableBrainTelemetry();
    buildPlayer({ scope: 'omaha:hu', variant: 'plo4', structure: 'fixed_limit' });
    drainFires();
    // The four-card fixed-limit Omaha: plo4 rules, structure fixed_limit.
    const fixed = readAt('omaha:hu', 'plo4', 'fixed_limit') as ReturnType<typeof expected>;
    expect(drainFires().map((f) => f.feature)).toContain(
      'fixed_limit_read_probe_discount_withheld'
    );
    // The same plo4 decision with no structure given is pot limit: discounted.
    const pot = readAt('omaha:hu', 'plo4') as ReturnType<typeof expected>;
    expect(drainFires().map((f) => f.feature)).toContain('opponent_read_probe_bets_discounted');
    expect(fixed!.stats.betCheckedTo.mean).toBeGreaterThan(pot!.stats.betCheckedTo.mean);
    expect(fixed!.stats.betCheckedTo.mean).toBeCloseTo(
      expected('omaha:hu', 'plo4', false)!.stats.betCheckedTo.mean,
      12
    );
    expect(pot!.stats.betCheckedTo.mean).toBeCloseTo(
      expected('omaha:hu', 'plo4', true)!.stats.betCheckedTo.mean,
      12
    );
    // Without a scope the structure is not kept.
    HorseMind.setDecisionBettingStructure('fixed_limit');
    expect(HorseMind.decisionBettingStructure()).toBe('no_limit');
  });

  it('HorseLogic hands the state structure to the read: a plo4 fixed-limit state counts no probe and reads undiscounted', () => {
    const players = [
      { seat: 1, user_id: HERO },
      { seat: 2, user_id: OPP },
    ] as SeatPlayer[];
    const prepare = (bettingStructure?: BettingStructure) =>
      HorseLogic.prepareOriginalReads(
        players[0]!,
        {
          gameVariant: 'plo4',
          ...(bettingStructure ? { bettingStructure } : {}),
          players,
          actionHistory: fixedLimitManiacHand(),
          bigBlind: BB,
        } as unknown as HorseGameStateV2,
        { fixedLimitReadIgnoresProbes: true }
      );
    prepare('fixed_limit');
    try {
      expect(HorseMind.decisionBettingStructure()).toBe('fixed_limit');
      // Count time (F1): the fixed-limit plo4 hand adds no probe tally.
      expect(HorseMind.getStats(OPP)!.ctBets ?? 0).toBe(0);
    } finally {
      HorseMind.setDecisionScope(null);
    }
    expect(HorseMind.decisionBettingStructure()).toBe('no_limit');
    prepare();
    try {
      expect(HorseMind.decisionBettingStructure()).toBe('pot_limit');
      expect(HorseMind.getStats(OPP)!.ctBets).toBe(3);
    } finally {
      HorseMind.setDecisionScope(null);
    }
  });

  it('HorseLogic carries the option to the read: off by default, on only with fixedLimitReadIgnoresProbes', () => {
    buildPlayer({ scope: 'holdem:hu', variant: 'flh', structure: 'fixed_limit' });
    const players = [
      { seat: 1, user_id: HERO },
      { seat: 2, user_id: OPP },
    ] as SeatPlayer[];
    const readThrough = (opts: { fixedLimitReadIgnoresProbes?: boolean }) => {
      HorseLogic.prepareOriginalReads(
        players[0]!,
        {
          gameVariant: 'flh',
          bettingStructure: 'fixed_limit',
          players,
          actionHistory: [],
          bigBlind: BB,
        } as unknown as HorseGameStateV2,
        opts
      );
      try {
        expect(HorseMind.currentScope()).toBe('holdem:hu');
        return HorseMind.opponentRead(OPP);
      } finally {
        HorseMind.setDecisionScope(null);
      }
    };
    expect(readThrough({})).toEqual(expected('holdem:hu', 'flh', true));
    expect(readThrough({ fixedLimitReadIgnoresProbes: false })).toEqual(
      expected('holdem:hu', 'flh', true)
    );
    expect(readThrough({ fixedLimitReadIgnoresProbes: true })).toEqual(
      expected('holdem:hu', 'flh', false)
    );
  });

  it('a style read is never served across a change of the option or the structure inside one decision (memo key, Hand Analysis D4)', () => {
    buildPlayer({ scope: 'omaha:hu', variant: 'flo8', structure: 'fixed_limit' });
    // References, each from a fresh scope.
    f1bOption = false;
    const offRef = readAt('omaha:hu', 'flo8', undefined, () => HorseMind.styleRead(OPP));
    f1bOption = true;
    const onRef = readAt('omaha:hu', 'flo8', undefined, () => HorseMind.styleRead(OPP));
    expect(onRef).not.toEqual(offRef);
    const plo4Ref = readAt('omaha:hu', 'plo4', undefined, () => HorseMind.styleRead(OPP));
    const plo4FlRef = readAt('omaha:hu', 'plo4', 'fixed_limit', () => HorseMind.styleRead(OPP));
    expect(plo4FlRef).not.toEqual(plo4Ref);
    // The option flips inside one decision with the memo open (as HorseLogic opens it): the read after each flip is
    // recomputed, and an unchanged repeat is a memo hit (so the memo is live in this case).
    HorseMind.setDecisionScope('omaha:hu', 'flo8', 'cash');
    HorseMind.beginStyleReadMemo();
    HorseMind.takeStyleReadMemoCounts();
    try {
      HorseMind.setDecisionFixedLimitReadIgnoresProbes(false);
      expect(HorseMind.styleRead(OPP)).toEqual(offRef);
      expect(HorseMind.styleRead(OPP)).toEqual(offRef);
      expect(HorseMind.takeStyleReadMemoCounts()).toEqual({ hits: 1, misses: 1 });
      HorseMind.setDecisionFixedLimitReadIgnoresProbes(true);
      expect(HorseMind.styleRead(OPP)).toEqual(onRef);
      HorseMind.setDecisionFixedLimitReadIgnoresProbes(false);
      expect(HorseMind.styleRead(OPP)).toEqual(offRef);
      expect(HorseMind.takeStyleReadMemoCounts()).toEqual({ hits: 0, misses: 2 });
    } finally {
      HorseMind.setDecisionScope(null);
    }
    // The structure changes inside one decision (option on, memo open): recomputed too.
    HorseMind.setDecisionScope('omaha:hu', 'plo4', 'cash');
    HorseMind.beginStyleReadMemo();
    HorseMind.takeStyleReadMemoCounts();
    try {
      HorseMind.setDecisionFixedLimitReadIgnoresProbes(true);
      expect(HorseMind.styleRead(OPP)).toEqual(plo4Ref);
      HorseMind.setDecisionBettingStructure('fixed_limit');
      expect(HorseMind.styleRead(OPP)).toEqual(plo4FlRef);
      expect(HorseMind.takeStyleReadMemoCounts()).toEqual({ hits: 0, misses: 2 });
    } finally {
      HorseMind.setDecisionScope(null);
    }
  });

  it('the fixed-limit Omaha presumption option keys on the structure too', () => {
    enableBrainTelemetry();
    drainFires();
    HorseMind.setDecisionScope('omaha:hu', 'plo4', 'cash');
    HorseMind.setDecisionBettingStructure('fixed_limit');
    HorseMind.setDecisionReadOptions({ fixedLimitOmahaNoPresumption: true });
    const fixed = HorseMind.opponentRead(OPP);
    HorseMind.setDecisionScope(null);
    expect(fixed?.presumed === true).toBe(false);
    expect(drainFires().map((f) => f.feature)).toContain('fixed_limit_omaha_presumption_withheld');
    HorseMind.setDecisionScope('omaha:hu', 'plo4', 'cash');
    HorseMind.setDecisionReadOptions({ fixedLimitOmahaNoPresumption: true });
    const pot = HorseMind.opponentRead(OPP);
    HorseMind.setDecisionScope(null);
    expect(pot?.presumed).toBe(true);
  });
});
