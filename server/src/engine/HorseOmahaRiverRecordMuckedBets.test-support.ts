/**
 * Test support for omahaRiverRecordCountsMuckedBets (PLO-OWNER lead-9 lane RV 2026-11-27): the committed real
 * heads-up river facing-bet states the people-measured price reads, a public-only hand in which a bettor's river bet
 * is called and mucked at the showdown, and the engine's own decide with the option on or off.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import { withDecisionFireScope } from './BrainTelemetry.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaBetReadLearn, omahaBetReadReset } from './HorseOmahaBetRead.js';
import { loadPricedStates, type PricedState } from './HorseOmahaFacingBetPriced.test-support.js';
import { FLOP_RAISE_FIXTURE } from './HorseOmahaFlopRaisePriced.test-support.js';

const MODS = { tightness: 0.98, aggression: 1.18, bluffFreq: 0.91, sizingMultiplier: 0.94 };

/** One completed hand, public fields only: `bettor` bets the turn and the river at `frac` of the pot, is called twice,
 *  and at the showdown is listed as mucked (`mucked`) or wins the river bet uncontested (`called` false). */
export function riverBetHand(
  handKey: string,
  variant: string,
  bettor: string,
  frac: number,
  outcome: 'mucked' | 'uncontested' | 'folded_to_raise'
): Record<string, unknown> {
  const act = (userId: string, stage: string, action: string, amount: number, pot: number) => ({
    userId,
    stage,
    action,
    amount,
    publicNode: { pot, toCall: action === 'call' || action === 'fold' ? amount : 0 },
  });
  const t = Math.round(20 * frac * 100) / 100;
  const potR = 20 + 2 * t;
  const r = Math.round(potR * frac * 100) / 100;
  const actions = [
    act(bettor, 'flop', 'check', 0, 20),
    act('caller', 'flop', 'check', 0, 20),
    act(bettor, 'turn', 'bet', t, 20),
    act('caller', 'turn', 'call', t, 20 + t),
    act(bettor, 'river', 'bet', r, potR),
  ];
  if (outcome === 'mucked') actions.push(act('caller', 'river', 'call', r, potR + r));
  else if (outcome === 'uncontested') actions.push(act('caller', 'river', 'fold', 0, potR + r));
  else {
    actions.push({
      ...act('caller', 'river', 'raise', 3 * r, potR + r),
      publicNode: { pot: potR + r, toCall: r },
    });
    actions.push({
      ...act(bettor, 'river', 'fold', 0, potR + 4 * r),
      publicNode: { pot: potR + 4 * r, toCall: 2 * r },
    });
  }
  return {
    handKey,
    variant,
    mode: 'cash',
    board: null,
    shown: new Map(),
    showdown:
      outcome === 'mucked' ? [{ user_id: 'caller' }, { user_id: bettor, mucked: true }] : [],
    actions,
  };
}

/** Teach the bet read `n` mucked called river bets of `bettor` at each size bucket (small, mid, big). */
export function learnMuckedRiverBets(variant: string, bettor: string, n: number): void {
  let k = 0;
  for (const frac of [0.4, 0.7, 1])
    for (let i = 0; i < n; i++)
      omahaBetReadLearn(
        riverBetHand(`rv-${bettor}-${k++}`, variant, bettor, frac, 'mucked') as never
      );
}

/** The engine's own decide on one state: fresh memory, then `mucked` mucked called river bets of the bettor learned. */
export function decideRiver(
  s: PricedState,
  on: boolean,
  telemetry: boolean,
  mucked: number
): HorseDecision {
  HorseMind.reset();
  omahaBetReadReset();
  const bettor = (s.gs.players ?? []).find(
    (p) => p.seat !== (s.player as SeatPlayer).seat && !p.is_folded
  );
  if (mucked > 0 && bettor)
    learnMuckedRiverBets(String(s.gs.gameVariant ?? '').toLowerCase(), bettor.user_id, mucked);
  seedFastRandom(1);
  return HorseLogic.decide(
    structuredClone(s.player),
    structuredClone(s.gs) as HorseGameStateV2,
    'grinder' as never,
    MODS as never,
    {
      ...FLOP_RAISE_FIXTURE.opts,
      omahaFacingBetPriorIsPeopleMeasured: true,
      ...(on ? { omahaRiverRecordCountsMuckedBets: true } : {}),
      telemetry,
    } as never
  ) as HorseDecision;
}

/** The committed river states where the option's read fires once the bettor's record holds mucked called bets. */
export function riverStatesTheOptionReads(limit: number): PricedState[] {
  const out: PricedState[] = [];
  for (const s of loadPricedStates()) {
    if (s.gs.stage !== 'river') continue;
    if (
      withDecisionFireScope(() => decideRiver(s, true, true, 6)).fired.has(
        'omaha_river_mucked_bets_record_read'
      )
    )
      out.push(s);
    if (out.length >= limit) break;
  }
  omahaBetReadReset();
  HorseMind.reset();
  return out;
}
