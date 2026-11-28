/**
 * Test support for omahaMultiwayRiverBetPriorIsPeopleMeasured (PLO-OWNER lead-9 lanes MWR + RV + RV2 2026-11-27): the
 * committed real river facing-bet states, each also as a MULTIWAY pot (one folded player of the hand put back in,
 * still to act behind the Horse; nothing else of the state changes) and as a multiway re-raised pot, a public-only
 * completed hand that teaches the bet read a shown river bet, and the engine's own decide.
 */
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaBetReadLearn, omahaBetReadReset } from './HorseOmahaBetRead.js';
import { loadPricedStates, type PricedState } from './HorseOmahaFacingBetPriced.test-support.js';
import { FLOP_RAISE_FIXTURE } from './HorseOmahaFlopRaisePriced.test-support.js';
import { omahaPeoplePriorFlopPotOf } from './HorseOmahaPeoplePriorHidden.js';

export const MW_RIVER_OPTION = 'omahaMultiwayRiverBetPriorIsPeopleMeasured';
export const MW_RIVER_PRICED = 'omaha_mw_river_people_prior_priced';
export const MW_RIVER_RECORD = 'omaha_mw_river_people_prior_record_read';

const MODS = { tightness: 0.98, aggression: 1.18, bluffFreq: 0.91, sizingMultiplier: 0.94 };
const SUITS: Record<string, CardSuit> = { h: 'hearts', s: 'spades', d: 'diamonds', c: 'clubs' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]!]! });
  return out;
}
const BOARD = 'KhQs8d7c3h';
const AIR = 'Js9c6h5d2s'; // nothing on Kh Qs 8d 7c 3h
const SET = 'KdKcAs4d2h'; // top set

export interface MwRiverState extends PricedState {
  live: number;
  pot: string;
}
type Act = { stage?: unknown; seat?: number; action?: string; amount?: number };

function withPreflopReraise(s: PricedState): PricedState {
  const gs = structuredClone(s.gs);
  const hist = (gs.actionHistory ?? []) as Act[];
  const live = (gs.players ?? []).filter((p) => !p.is_folded).map((p) => p.seat);
  const level = Math.max(2, ...hist.filter((a) => a.stage === 'preflop').map((a) => a.amount ?? 0));
  let at = -1;
  hist.forEach((a, i) => {
    if (a.stage === 'preflop') at = i;
  });
  hist.splice(
    at + 1,
    0,
    { stage: 'preflop', seat: live[0], action: 'raise', amount: level * 3 },
    { stage: 'preflop', seat: live[1] ?? live[0], action: 'raise', amount: level * 9 }
  );
  (gs as { actionHistory?: unknown }).actionHistory = hist;
  return { ...s, gs };
}

/** The same river state with one folded player of the hand back in it, still to act behind the Horse. */
function asMultiway(s: PricedState): PricedState | null {
  const gs = structuredClone(s.gs);
  const back = (gs.players ?? []).find(
    (p) => p.is_folded && p.seat !== s.player.seat && Number(p.stack) > 0
  );
  if (!back) return null;
  back.is_folded = false;
  return { ...s, gs };
}

/** Every committed river state: as recorded (heads-up), as a multiway pot, and as a multiway re-raised pot. */
export function mwRiverStates(): MwRiverState[] {
  const out: MwRiverState[] = [];
  const tag = (s: PricedState): MwRiverState => ({
    ...s,
    live: (s.gs.players ?? []).filter((p) => !p.is_folded).length,
    pot: omahaPeoplePriorFlopPotOf(s.gs.actionHistory as never),
  });
  for (const s of loadPricedStates()) {
    if (s.gs.stage !== 'river') continue;
    out.push(tag(s));
    const mw = asMultiway(s);
    if (!mw) continue;
    out.push(tag(mw));
    if (tag(mw).pot !== 'reraised' && out.length % 5 === 0) out.push(tag(withPreflopReraise(mw)));
  }
  return out;
}

/** Teach the bet read `n` shown river bets of `bettor` at each size (small, mid, big): all air or all top set. */
export function learnShownRiverBets(
  variant: string,
  bettor: string,
  n: number,
  kind: 'air' | 'value'
): void {
  const hole = (kind === 'air' ? AIR : SET).slice(0, variant === 'plo4' ? 8 : 10);
  let k = 0;
  for (const frac of [0.3, 0.67, 1])
    for (let i = 0; i < n; i++) {
      const key = `mwr-${bettor}-${kind}-${k++}`;
      const caller = `${bettor}-caller-${key}`;
      const act = (stage: string, userId: string, action: string, amount: number) => ({
        stage,
        userId,
        action,
        amount,
        origin: 'player',
      });
      omahaBetReadLearn({
        handKey: key,
        variant,
        mode: 'cash',
        actions: [
          act('preflop', bettor, 'raise', 6),
          act('preflop', caller, 'call', 6),
          act('flop', caller, 'check', 0),
          act('flop', bettor, 'check', 0),
          act('turn', caller, 'check', 0),
          act('turn', bettor, 'check', 0),
          act('river', caller, 'check', 0),
          act('river', bettor, 'bet', 12 * frac),
          act('river', caller, 'call', 12 * frac),
        ],
        board: cards(BOARD),
        shown: new Map([
          [bettor, cards(hole)],
          [caller, cards(variant === 'plo4' ? '2c3d4h5s' : '2c3d4h5s6c')],
        ]),
        showdown: [
          { user_id: bettor, mucked: false },
          { user_id: caller, mucked: false },
        ],
      } as never);
    }
}

/** The river bettor of a state: the player with the highest current bet who is not the Horse. */
export function riverBettorOf(s: PricedState): string | null {
  const last = [...((s.gs.actionHistory ?? []) as Array<Act & { userId?: string }>)]
    .reverse()
    .find((a) => a.stage === 'river' && (a.action === 'bet' || a.action === 'all_in'));
  const p = (s.gs.players ?? []).find((q) => q.seat === last?.seat);
  return p ? p.user_id : null;
}

/** The engine's own decide on one state: fresh memory, then `n` shown river bets of the bettor learned per size. */
export function decideMwRiver(
  s: PricedState,
  on: boolean,
  telemetry: boolean,
  record: { n: number; kind: 'air' | 'value' } | null = null
): HorseDecision {
  HorseMind.reset();
  omahaBetReadReset();
  const bettor = riverBettorOf(s);
  if (record && bettor)
    learnShownRiverBets(
      String(s.gs.gameVariant ?? '').toLowerCase(),
      bettor,
      record.n,
      record.kind
    );
  seedFastRandom(1);
  return HorseLogic.decide(
    structuredClone(s.player),
    structuredClone(s.gs) as HorseGameStateV2,
    'grinder' as never,
    MODS as never,
    {
      ...FLOP_RAISE_FIXTURE.opts,
      ...(on ? { [MW_RIVER_OPTION]: true } : {}),
      telemetry,
    } as never
  ) as HorseDecision;
}
