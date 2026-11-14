/**
 * PLO6: what a Horse recognises about an opponent and what it then does,
 * through HorseLogic.decide on matched inputs.
 *
 * One recorded production hand (58751512, PLO6 1/2 cash on a 50% VPIP floor
 * table; the anonymised fixture of PLO6-AUDIT-004) supplies two preflop nodes.
 * Cards, stacks, pot, price, position, legal menu and action history are held
 * fixed. Only one opponent's public record changes:
 *
 *   node 13  the button, 390 big blinds deep, faces a four-bet from seat 1;
 *            seat 2 (the first raiser) and seat 6 (a cold caller) are still
 *            in, seats 3 and 4 have folded; the table's 50% floor applies
 *   node 7   the button faces seat 2's open and two callers (this recorded
 *            node carries no floor)
 *
 * The opponent classes are built from public preflop actions with the same
 * functions the live memory uses (exploitHandIncrements, decayAndAdd) and are
 * installed as that player's durable PLO6 cash profile at the exact table
 * size only. Every profile and the fixed complaint seeds are replayed (six
 * profiles by ten seeds a cell).
 *
 * What is pinned, and why it matters for reading live hands:
 *   1. Recognition: unknown is presumed aggressive; a long record of limping
 *      or folding disproves it; raising every hand, or re-raising half the
 *      raises faced, is evidence; four raises are not evidence; a borrowed
 *      read expires on the player's hand clock.
 *   2. Attribution: only the seat whose raise the Horse faces moves the
 *      action. The same record on a player who raised earlier, called or
 *      folded changes nothing.
 *   3. Response: against proven tight play the Horse keeps exactly its
 *      unknown-opponent baseline (the engine has no preflop tight exploit);
 *      against an observed raiser it stops shoving and calls or folds; it
 *      re-raises the open of a player who raises every hand and calls the
 *      open of a selective re-raiser.
 *   4. The receipt maniac_pressure_preflop fires for an unknown opponent too
 *      (the Omaha presumption supplies the width), so that receipt alone does
 *      not show that a maniac was observed; observed_maniac_raiser_seen does.
 *
 * This file records behaviour; it is not a statement that each response is
 * the best play. If a deliberate change to the shared Omaha read or to these
 * nodes moves a cell, update that cell here in the same pull request and say
 * so; the attribution cases should not need to move. Node 13's baseline shove is driven by the VPIP floor
 * (PLO6-AUDIT-004), which is why the unfloored control is here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  COMPLAINT_SEEDS,
  replayProfiles,
  stateAt,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  decayAndAdd,
  exploitHandIncrements,
  freshExploitCounters,
  maniacRaiseWidth,
  MANIAC_MIN_RAISE_WIDTH,
  opponentExploitRead,
  presumedAggressorRead,
  PRESUMPTION_PROOF_MIN_OPPS,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import { blendOpponentMemoryWithExpiry } from './HorseOpponentMemory.js';
import FIXTURE from './fixtures/horse-plo6-floor-deep-stack-off-58751512.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const FOUR_BET_NODE = 13;
const OPEN_NODE = 7;
const FOUR_BETTOR = 1;
const FIRST_RAISER = 2;
const FOLDED_CALLER = 3;

const uid = (seat: number) => `40000000-0000-4000-8000-0000000000${(16 + seat).toString(16)}`;

type PublicHand = { action: 'raise' | 'call' | 'fold'; facingRaise?: boolean };

/** A player's decayed counters after these hands, oldest first. */
function record(hands: PublicHand[]): ExploitCounters {
  const id = 'the-player';
  const counters = freshExploitCounters();
  for (const hand of hands) {
    const actions = [
      ...(hand.facingRaise
        ? [{ userId: 'another', action: 'raise', stage: 'preflop', origin: 'player' }]
        : []),
      // origin 'player' is what the live log carries; a fold without it is not counted.
      { userId: id, action: hand.action, stage: 'preflop', origin: 'player' },
    ];
    const increment = exploitHandIncrements(actions as never).get(id);
    if (increment) decayAndAdd(counters, increment);
  }
  return counters;
}
const times = (n: number, hand: PublicHand): PublicHand[] => Array.from({ length: n }, () => hand);
const mostlyFolds = (n: number): PublicHand[] =>
  Array.from({ length: n }, (_, i) => ({ action: i % 6 === 0 ? 'call' : 'fold' }));

const CLASSES = {
  unknown: null,
  sparse: record(times(4, { action: 'raise' })),
  tightFolder: record(mostlyFolds(240)),
  tightOneRaise: record([...mostlyFolds(240), { action: 'raise' }]),
  loosePassive: record(times(60, { action: 'call' })),
  sustained: record(times(120, { action: 'raise' })),
  selective: record(
    Array.from({ length: 120 }, (_, i) => ({
      action: i % 2 === 0 ? 'raise' : 'fold',
      facingRaise: true,
    }))
  ),
  wasRaisingNowQuiet: record([
    ...times(120, { action: 'raise' }),
    ...times(14, { action: 'call' }),
  ]),
  wasQuietNowRaising: record([
    ...times(120, { action: 'call' }),
    ...times(12, { action: 'raise' }),
  ]),
} satisfies Record<string, ExploitCounters | null>;
type OpponentClass = keyof typeof CLASSES;

function readOf(cls: OpponentClass) {
  const counters = CLASSES[cls];
  const own = counters ? opponentExploitRead(counters, 'omaha:full', 'plo6') : null;
  return presumedAggressorRead(own, counters ?? undefined, 'omaha:full', 'plo6');
}

interface Cell {
  actions: Record<string, number>;
  receipts: Record<string, number>;
}

/** Every profile and seed at one node with one seat's record set to a class. */
function decideAt(
  ord: number,
  cls: OpponentClass,
  seat: number,
  edit?: (gs: Record<string, unknown>) => void
): Cell {
  const st = stateAt(FX, FX.actions.find((a) => a.ord === ord)!);
  const gs = structuredClone(st.gs) as unknown as Record<string, unknown>;
  const hero = structuredClone(st.hero);
  for (const p of gs.players as { seat: number; user_id: string }[]) p.user_id = uid(p.seat);
  hero.user_id = uid(hero.seat);
  for (const a of gs.actionHistory as { seat: number; userId: string }[]) a.userId = uid(a.seat);
  if (Array.isArray(gs.humanUserIds))
    gs.humanUserIds = (gs.humanUserIds as string[]).map((id) => uid(Number(id.slice(1))));
  edit?.(gs);
  const cell: Cell = { actions: {}, receipts: {} };
  for (const profile of replayProfiles('cash')) {
    for (const seed of COMPLAINT_SEEDS) {
      seedFastRandom(seed);
      HorseMind.reset();
      const counters = CLASSES[cls];
      if (counters)
        // The exact context only (both nodes read omaha:full). The same record at a
        // sibling size would be blended in as a donor and count a thin record twice.
        HorseMind.importDurableOpponentProfiles([
          {
            user_id: uid(seat),
            variant: 'plo6',
            mode: 'cash',
            size: 'full',
            observed_hands: 300,
            initialized: true,
            counters,
          },
        ]);
      drainFires();
      const decision = HorseLogic.decide(hero, gs as never, profile.style, profile.mods, {
        telemetry: true,
      } as never);
      for (const fire of drainFires())
        cell.receipts[fire.feature] = (cell.receipts[fire.feature] ?? 0) + fire.fires;
      cell.actions[decision.action] = (cell.actions[decision.action] ?? 0) + 1;
    }
  }
  HorseMind.reset();
  return cell;
}

const CELL = replayProfiles('cash').length * COMPLAINT_SEEDS.length;
const ALL = Object.keys(CLASSES) as OpponentClass[];
const TIGHT: OpponentClass[] = ['tightFolder', 'tightOneRaise', 'loosePassive'];
const OBSERVED_RAISERS: OpponentClass[] = ['sustained', 'selective', 'wasRaisingNowQuiet'];

// Armed at load: the baseline cells below are computed while the suite is collected.
enableBrainTelemetry();
afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('PLO6 recognition: what each public record reads as', () => {
  it('an unknown opponent is presumed an aggressive raiser at the minimum maniac width', () => {
    const r = readOf('unknown');
    expect(r.outcome).toBe('presumed');
    expect(maniacRaiseWidth(r.read)).toBeCloseTo(MANIAC_MIN_RAISE_WIDTH, 6);
  });

  it.each(TIGHT)('%s: enough quiet hands disprove the presumption', (cls) => {
    expect(CLASSES[cls]!.hands).toBeGreaterThanOrEqual(PRESUMPTION_PROOF_MIN_OPPS);
    const r = readOf(cls);
    expect(r.outcome).toBe('disproved');
    expect(maniacRaiseWidth(r.read)).toBeNull();
  });

  it('a tight player who raises once is still read as tight', () => {
    expect(readOf('tightOneRaise').outcome).toBe('disproved');
  });

  it('raising every hand, and re-raising half of the raises faced, are evidence', () => {
    const sustained = readOf('sustained');
    expect(sustained.outcome).toBe('evidenced');
    expect(maniacRaiseWidth(sustained.read)).toBeGreaterThan(0.8);
    expect(sustained.read!.stats.threeBet.engaged).toBeNull();
    const selective = readOf('selective');
    expect(selective.outcome).toBe('evidenced');
    expect(selective.read!.stats.threeBet.engaged).toBe('high');
    expect(maniacRaiseWidth(selective.read)).toBeGreaterThanOrEqual(MANIAC_MIN_RAISE_WIDTH);
    expect(maniacRaiseWidth(selective.read)).toBeLessThan(maniacRaiseWidth(sustained.read)!);
  });

  it('four raises are not evidence: the read stays presumed, though wider', () => {
    const r = readOf('sparse');
    expect(CLASSES.sparse.hands).toBeLessThan(PRESUMPTION_PROOF_MIN_OPPS);
    expect(r.outcome).toBe('presumed');
    expect(r.read!.presumed).toBe(true);
    expect(maniacRaiseWidth(r.read)).toBeGreaterThan(MANIAC_MIN_RAISE_WIDTH);
  });

  it('conflicting records: recent quiet narrows a raiser; twelve recent raises do not yet make one', () => {
    const cooled = readOf('wasRaisingNowQuiet');
    expect(cooled.outcome).toBe('evidenced');
    expect(maniacRaiseWidth(cooled.read)).toBeLessThan(maniacRaiseWidth(readOf('sustained').read)!);
    const heating = readOf('wasQuietNowRaising');
    expect(heating.outcome).toBe('presumed');
    expect(maniacRaiseWidth(heating.read)).toBeCloseTo(MANIAC_MIN_RAISE_WIDTH, 6);
  });

  it('a stale borrowed read expires on the hand clock', () => {
    const width = (age: number) => {
      const blended = blendOpponentMemoryWithExpiry(undefined, [CLASSES.sustained], age);
      return maniacRaiseWidth(blended ? opponentExploitRead(blended, 'omaha:full', 'plo6') : null);
    };
    expect(width(0)).toBeGreaterThan(0.8);
    expect(width(120)).toBeLessThan(width(0)!);
    expect(width(600)).toBeNull();
  });
});

describe('PLO6 attribution: only the raiser the Horse faces moves the action', () => {
  const baseline13 = decideAt(FOUR_BET_NODE, 'unknown', FOUR_BETTOR);
  const baseline7 = decideAt(OPEN_NODE, 'unknown', FIRST_RAISER);

  it('the fixture nodes are the recorded ones', () => {
    const at = (ord: number) => FX.actions.find((a) => a.ord === ord)!;
    expect(FX.variant).toBe('plo6');
    expect(at(9)).toMatchObject({ seat: FOUR_BETTOR, action: 'raise' });
    expect(at(4)).toMatchObject({ seat: FIRST_RAISER, action: 'raise' });
    expect(at(11)).toMatchObject({ seat: FOLDED_CALLER, action: 'fold' });
    expect(at(FOUR_BET_NODE).seat).toBe(5);
    expect(at(OPEN_NODE).seat).toBe(5);
  });

  it.each(ALL)('four-bet node, %s on the earlier raiser who is still in: no change', (cls) => {
    expect(decideAt(FOUR_BET_NODE, cls, FIRST_RAISER).actions).toEqual(baseline13.actions);
  });

  it.each(ALL)('four-bet node, %s on a player who has folded: no change', (cls) => {
    expect(decideAt(FOUR_BET_NODE, cls, FOLDED_CALLER).actions).toEqual(baseline13.actions);
  });

  it.each(ALL)('open node, %s on a caller who is not the raiser: no change', (cls) => {
    expect(decideAt(OPEN_NODE, cls, FOLDED_CALLER).actions).toEqual(baseline7.actions);
  });
});

describe('PLO6 response: the same node against each class of raiser', () => {
  const baseline13 = decideAt(FOUR_BET_NODE, 'unknown', FOUR_BETTOR);
  const baseline7 = decideAt(OPEN_NODE, 'unknown', FIRST_RAISER);

  it('baseline against an unknown raiser: shoves the four-bet node, mostly folds the open', () => {
    expect(baseline13.actions).toEqual({ all_in: CELL });
    expect(baseline7.actions.fold).toBeGreaterThan(baseline7.actions.call ?? 0);
    expect(baseline7.actions.raise).toBeUndefined();
  });

  it.each(TIGHT)(
    '%s: proven tight play keeps the unknown-opponent baseline at both nodes',
    (cls) => {
      const four = decideAt(FOUR_BET_NODE, cls, FOUR_BETTOR);
      expect(four.actions).toEqual(baseline13.actions);
      expect(four.receipts.plo_opponent_presumption_disproved).toBeGreaterThan(0);
      expect(four.receipts.maniac_pressure_preflop).toBeUndefined();
      expect(decideAt(OPEN_NODE, cls, FIRST_RAISER).actions).toEqual(baseline7.actions);
    }
  );

  it.each(OBSERVED_RAISERS)(
    '%s: an observed raiser is called or folded to, never shoved on',
    (cls) => {
      const four = decideAt(FOUR_BET_NODE, cls, FOUR_BETTOR);
      expect(four.actions.all_in).toBeUndefined();
      expect(four.actions.call).toBeGreaterThan(four.actions.fold ?? 0);
      expect(four.receipts.plo_opponent_presumption_disproved).toBeUndefined();
    }
  );

  it.each(['sustained', 'wasRaisingNowQuiet'] as const)(
    "%s: that player's open is re-raised, never folded to",
    (cls) => {
      const open = decideAt(OPEN_NODE, cls, FIRST_RAISER);
      expect(open.actions.fold).toBeUndefined();
      expect(open.actions.raise).toBeGreaterThan(open.actions.call ?? 0);
      expect(open.receipts.v53_pressure_preflop).toBeGreaterThan(0);
    }
  );

  it("a selective re-raiser's open is called: not folded, and not re-raised", () => {
    expect(decideAt(OPEN_NODE, 'selective', FIRST_RAISER).actions).toEqual({ call: CELL });
  });

  it('twelve recent raises after a quiet record do not move either node off the baseline', () => {
    expect(decideAt(FOUR_BET_NODE, 'wasQuietNowRaising', FOUR_BETTOR).actions).toEqual(
      baseline13.actions
    );
    expect(decideAt(OPEN_NODE, 'wasQuietNowRaising', FIRST_RAISER).actions).toEqual(
      baseline7.actions
    );
  });

  it('four raises leave the deep node on its baseline but already move the open node', () => {
    // Recorded as a sensitivity of the widened presumed read, not endorsed.
    expect(decideAt(FOUR_BET_NODE, 'sparse', FOUR_BETTOR).actions).toEqual(baseline13.actions);
    const open = decideAt(OPEN_NODE, 'sparse', FIRST_RAISER);
    expect(open.actions).not.toEqual(baseline7.actions);
    expect(open.actions.raise).toBeGreaterThan(0);
  });

  it('the maniac receipt fires for an unknown raiser as well, so it is not proof of observation', () => {
    expect(baseline13.receipts.maniac_pressure_preflop).toBe(CELL);
    expect(baseline13.receipts.plo_opponent_presumed_aggressive).toBeGreaterThan(0);
    expect(decideAt(FOUR_BET_NODE, 'sustained', FOUR_BETTOR).receipts.maniac_pressure_preflop).toBe(
      CELL
    );
  });

  it('observed_maniac_raiser_seen fires only for an observed raiser the Horse faces (PLO6-AUDIT-015)', () => {
    const fires = (cell: Cell) => cell.receipts.observed_maniac_raiser_seen ?? 0;
    expect(fires(baseline13)).toBe(0);
    expect(fires(baseline7)).toBe(0);
    for (const cls of ['sparse', 'wasQuietNowRaising', ...TIGHT] as const)
      expect(fires(decideAt(FOUR_BET_NODE, cls, FOUR_BETTOR)), cls).toBe(0);
    for (const cls of OBSERVED_RAISERS) {
      expect(fires(decideAt(FOUR_BET_NODE, cls, FOUR_BETTOR)), cls).toBe(CELL);
      expect(fires(decideAt(OPEN_NODE, cls, FIRST_RAISER)), cls).toBe(CELL);
      // The same record on a player who is not the raiser faced is not counted.
      expect(fires(decideAt(FOUR_BET_NODE, cls, FIRST_RAISER)), cls).toBe(0);
      expect(fires(decideAt(FOUR_BET_NODE, cls, FOLDED_CALLER)), cls).toBe(0);
    }
  });

  it('floor control: without the table VPIP floor the baseline is not a shove', () => {
    const unfloored = decideAt(FOUR_BET_NODE, 'unknown', FOUR_BETTOR, (gs) => {
      gs.vpipFloor = 0;
      delete gs.ownVpip;
    });
    expect(baseline13.receipts.vpip_floor).toBe(CELL);
    expect(unfloored.receipts.vpip_floor).toBeUndefined();
    expect(unfloored.actions.all_in).toBeUndefined();
  });
});
