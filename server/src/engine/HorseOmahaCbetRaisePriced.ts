/**
 * OMAHA C-BET RAISE IS PRICED (2026-11-21, EMERG lane CBET-DEFENCE; option
 * omahaCbetRaiseIsPriced, default OFF, read `=== true`). PLO4 / PLO5 cash only.
 *
 * The finding (repairs/EMERG/CBET-DEFENCE.md): an opponent who raises every
 * flop continuation bet beat the Horses because the Horse folded hands with
 * 0.46-0.52 all-in equity against his actual hand at a price of 0.33. The
 * fold was decided by omahaFlopFacingBetEv with the STATED raise row (value
 * share 0.18, non-value share 0.18): every raiser got the same range whether
 * he raises one c-bet in eight or every one.
 *
 * What this module measures and prices, one rule for every opponent (no
 * opponent kind, no name, no hand class, no size band as a decision):
 *
 *  RHO     the share of his holdings that raise a flop c-bet of this size,
 *          players heads-up or more: the population table (public hands,
 *          OMAHA_CBET_RAISE_SHARE_POP; one table for all opponents) shrunk by
 *          his own lifetime PUBLIC record when a provider supplies one:
 *          rho = (raises + K x pop) / (opps + K) (K = OMAHA_CBET_RAISE_PRIOR_WEIGHT).
 *          No provider or no record: the population exactly.
 *  RANGE   his raising range is the strongest min(1, W x rho) of holdings on
 *          the flop by the flop made-hand order (the sampler's top(share)),
 *          W = OMAHA_CBET_RAISE_RANGE_WIDTH fitted on measured raising hands
 *          (offline, aggregates): a rare raiser holds the top of his range, a
 *          raiser of everything holds everything. No bluff share is added.
 *  SIDE i  facing the raise of its own c-bet (omahaFlopFacingBetEv's verdict,
 *          HorseOmahaFlopFacingBetEvRule): the raise row is replaced by RANGE;
 *          the verdict's call / fold arithmetic is unchanged.
 *  SIDE ii the c-bet itself (v38 flop bet EV, HorseLogic): every bet size gets
 *          the raise branch rho(size) x [the better of the call and the fold
 *          against RANGE] (HorseOmahaPricedSites.omahaPricedSitesFlopRaiseAnswer),
 *          so a bet that must fold to the raise is worth less and a hand that
 *          is glad to be raised is worth more; the action is the EV argmax.
 *
 * Pure apart from the provider slot; a failure returns null (the caller then
 * decides exactly as with the option off).
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import type { EvRaiseBranch } from './HorseEvEngine.js';
import { omahaFlopEvCounts } from './HorseOmahaFlopFacingBetEv.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import {
  omahaPricedSitesFlopRaiseAnswer,
  omahaPricedSitesFlopRealization,
} from './HorseOmahaPricedSites.js';

export type OmahaCbetSize = 'small' | 'half' | 'twothirds' | 'pot';
export type OmahaCbetPlayers = 'hu' | 'mw';

/** c-bet size of a wager as a share of the pot before it (labels only: the table's rows). */
export function omahaCbetSizeOf(frac: number): OmahaCbetSize {
  return frac < 0.4 ? 'small' : frac < 0.6 ? 'half' : frac < 0.85 ? 'twothirds' : 'pot';
}

/**
 * POPULATION: share of c-bets raised by the first player facing them, public
 * PLO4/PLO5 cash hands, every opponent together. Source and intervals:
 * docs/horse-option-authority.d/omahaCbetRaiseIsPriced.CONSTANTS.md.
 */
export const OMAHA_CBET_RAISE_SHARE_POP: Readonly<
  Record<OmahaCbetPlayers, Readonly<Record<OmahaCbetSize, number>>>
> = {
  hu: { small: 0.1873, half: 0.1746, twothirds: 0.1112, pot: 0.1038 },
  mw: { small: 0.0384, half: 0.0337, twothirds: 0.0351, pot: 0.0226 },
};
/** K: the population prior's weight in his record (beta-binomial fit on public per-opponent counts). */
export const OMAHA_CBET_RAISE_PRIOR_WEIGHT = 200;
/** W: raising range width over rho (ML fit on measured raising hands by flop-strength percentile). */
export const OMAHA_CBET_RAISE_RANGE_WIDTH = 1.65;

/** His lifetime public answers facing a flop c-bet: opportunities and raises (no card). */
export interface OmahaCbetRaiseRecordProvider {
  cbetRaiseRecord(
    opponentId: string,
    game: 'plo4' | 'plo5',
    players: OmahaCbetPlayers
  ): { opps: number; raises: number } | null;
}
let provider: OmahaCbetRaiseRecordProvider | null = null;
/** Installed by the wiring (or a benchmark); null = the population for everyone. */
export function setOmahaCbetRaiseRecordProvider(p: OmahaCbetRaiseRecordProvider | null): void {
  provider = p;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** rho for one opponent, size and players, and where it came from. */
export function omahaCbetRaiseShare(
  opponentId: string | null,
  game: 'plo4' | 'plo5',
  players: OmahaCbetPlayers,
  size: OmahaCbetSize
): { rho: number; pop: number; opps: number; raises: number } {
  const pop = OMAHA_CBET_RAISE_SHARE_POP[players][size];
  let opps = 0;
  let raises = 0;
  if (provider && opponentId) {
    try {
      const r = provider.cbetRaiseRecord(opponentId, game, players);
      if (r && fin(r.opps) && fin(r.raises) && r.opps > 0) {
        opps = r.opps;
        raises = Math.max(0, Math.min(r.raises, r.opps));
      }
    } catch {
      opps = 0;
      raises = 0;
    }
  }
  const K = OMAHA_CBET_RAISE_PRIOR_WEIGHT;
  return { rho: (raises + K * pop) / (opps + K), pop, opps, raises };
}

/** The raising range's share of holdings (the sampler's top region). */
export function omahaCbetRaiseRangeShare(rho: number): number {
  return Math.max(0.02, Math.min(0.95, OMAHA_CBET_RAISE_RANGE_WIDTH * Math.max(0, rho)));
}

const wager = (a: string) => a === 'bet' || a === 'raise' || a === 'all_in';

/**
 * The c-bet line on this flop: the Horse made the last preflop raise and the
 * first flop wager. With `raised`, exactly one raise followed, by `raiserSeat`
 * (the Horse faces it); without, no flop wager yet (the Horse may c-bet).
 * cbetFrac: the c-bet over the pot before it. Null outside the line.
 */
export function omahaCbetLineOf(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  raised: boolean
): { raiserSeat: number | null; cbetFrac: number | null; players: OmahaCbetPlayers } | null {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (variant !== 'plo4' && variant !== 'plo5') return null;
  if (omahaIsTournamentMode(gs)) return null;
  if (gs.stage !== 'flop' || (gs.communityCards ?? []).length !== 3) return null;
  let preLevel = 0;
  let preAggressor: number | null = null;
  const pre = new Map<number, number>();
  for (const a of gs.actionHistory ?? []) {
    if (String(a.stage) !== 'preflop' || !wager(a.action)) continue;
    const amt = fin(a.amount) ? Math.max(0, a.amount) : 0;
    const now = Math.max(pre.get(a.seat) ?? 0, amt);
    pre.set(a.seat, now);
    if (now > preLevel + 0.005) {
      preLevel = now;
      preAggressor = a.seat;
    }
  }
  if (preAggressor !== player.seat) return null;
  let level = 0;
  let cbet: number | null = null;
  let raiserSeat: number | null = null;
  let wagers = 0;
  let callsBetween = 0;
  for (const a of gs.actionHistory ?? []) {
    if (String(a.stage) !== 'flop') continue;
    if (a.action === 'call' && wagers === 1 && fin(a.amount)) callsBetween += Math.max(0, a.amount);
    if (!wager(a.action)) continue;
    const amt = fin(a.amount) ? Math.max(0, a.amount) : 0;
    if (amt <= level + 0.005) continue;
    level = amt;
    wagers++;
    if (wagers === 1) {
      if (a.seat !== player.seat) return null;
      cbet = amt;
    } else if (wagers === 2) raiserSeat = a.seat;
  }
  const live = (gs.players ?? []).filter((p) => !p.is_folded && !p.is_sitting_out).length;
  const players: OmahaCbetPlayers = live <= 2 ? 'hu' : 'mw';
  if (raised) {
    if (wagers !== 2 || raiserSeat === null || cbet === null) return null;
    // the pot before the c-bet: the pot before the raise (v81StreetWager, the spot's own measure) less the
    // c-bet and the calls of it
    const bets = new Map((gs.players ?? []).map((p) => [p.seat, p.bet]));
    const faced = v81StreetWager(gs.actionHistory, 'flop', bets, gs.pot);
    const potAtFlop = faced ? faced.potBefore - cbet - callsBetween : 0;
    const frac = potAtFlop > 0.005 ? cbet / potAtFlop : null;
    return { raiserSeat, cbetFrac: frac !== null && fin(frac) ? frac : null, players };
  }
  if (wagers !== 0) return null;
  return { raiserSeat: null, cbetFrac: null, players };
}

/** SIDE i: the measured raising range for the raise of the Horse's c-bet, or null outside the line. */
export function omahaCbetRaiseRangeOf(
  player: SeatPlayer,
  gs: HorseGameStateV2
): { valueShare: number; rho: number; pop: number; opps: number } | null {
  try {
    const line = omahaCbetLineOf(player, gs, true);
    if (!line || line.raiserSeat === null) return null;
    const raiser = (gs.players ?? []).find((p) => p.seat === line.raiserSeat);
    const game = String(gs.gameVariant).toLowerCase() as 'plo4' | 'plo5';
    // the c-bet's size row; a pot that cannot be measured is the population's most common heads-up row
    const size = line.cbetFrac !== null ? omahaCbetSizeOf(line.cbetFrac) : 'half';
    const r = omahaCbetRaiseShare(raiser?.user_id ?? null, game, line.players, size);
    return { valueShare: omahaCbetRaiseRangeShare(r.rho), rho: r.rho, pop: r.pop, opps: r.opps };
  } catch {
    return null;
  }
}

/**
 * SIDE ii: the raise branch of every flop c-bet size heads-up (EvSpot.raiseBranch of the v38 engine),
 * or null outside the line / when it cannot be priced (the engine then prices exactly as without it).
 */
export function omahaCbetRaiseBranchOf(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  pot: number,
  effective: number,
  inPosition: boolean,
  rake: number
): ((wager: number) => EvRaiseBranch | null) | null {
  if (opts.omahaCbetRaiseIsPriced !== true) return null;
  try {
    const line = omahaCbetLineOf(player, gs, false);
    if (!line || line.players !== 'hu') return null;
    const opp = (gs.players ?? []).find(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    if (!opp || opp.is_all_in || !fin(opp.stack) || !(opp.stack > 0)) return null;
    if (!fin(pot) || !(pot > 0) || !fin(effective) || !(effective > 0)) return null;
    const board = gs.communityCards ?? [];
    const hole: Card[] = player.cards ?? [];
    const counts = omahaFlopEvCounts(hole, board, player.knownDeadCards ?? [], 0.5);
    if (counts === null) return null;
    const game = String(gs.gameVariant).toLowerCase() as 'plo4' | 'plo5';
    const rk = fin(rake) ? Math.max(0, Math.min(0.5, rake)) : 0;
    return (w: number): EvRaiseBranch | null => {
      if (!fin(w) || !(w > 0)) return null;
      const b = Math.min(w, effective);
      const r = omahaCbetRaiseShare(opp.user_id, game, 'hu', omahaCbetSizeOf(b / pot));
      const t = counts.top(omahaCbetRaiseRangeShare(r.rho));
      const equityRaise = t.win + t.tie / 2;
      if (!fin(equityRaise)) return null;
      if (b >= effective - 0.005) return { share: 0, equityRaise, evFacingRaise: -b };
      const real = omahaPricedSitesFlopRealization(inPosition, pot, b, effective);
      const answer = omahaPricedSitesFlopRaiseAnswer(pot, b, effective, equityRaise, real, rk);
      return { share: r.rho, equityRaise, evFacingRaise: answer.ev };
    };
  } catch {
    return null;
  }
}
