/**
 * Test support for the corrected PLO4/PLO5 facing-bet price (PLO-OWNER lead-6 2026-11-24): the committed state set
 * and the verdicts of today's build and of the new options, priced with no opponent memory and no rake.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaFacingBetEvSpot, omahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import {
  omahaFlopFacingBetEvSpot,
  omahaFlopFacingBetEvVerdict,
} from './HorseOmahaFlopFacingBetEv.js';
import { omahaPricedFacingVerdict } from './HorseOmahaFacingBetPriced.js';
import { omahaFlopCallTreeVerdict } from './HorseOmahaFlopCallTree.js';
import {
  omahaMeasuredBucketOf,
  omahaMeasuredLineOf,
  type OmahaMeasuredRecord,
} from './HorseOmahaMeasuredBettorRange.js';

export interface PricedState {
  k: string;
  legacy: string | null;
  gs: HorseGameStateV2;
  player: SeatPlayer;
}

export function loadPricedStates(): PricedState[] {
  const raw = gunzipSync(
    readFileSync(join(__dirname, 'HorseOmahaFacingBetPriced.states.ndjson.gz'))
  ).toString('utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as PricedState);
}

function inPosition(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  const live = (gs.players ?? [])
    .filter((p) => !p.is_folded && !p.is_sitting_out)
    .map((p) => p.seat)
    .sort((a, b) => a - b);
  const i = live.findIndex((x) => x > gs.dealerSeat);
  const at = i < 0 ? 0 : i;
  const rot = [...live.slice(at), ...live.slice(0, at)];
  return rot.indexOf(player.seat) === rot.length - 1;
}

export type PricedConfig = 'today' | 'on' | 'onWithRecord' | 'onKnownBettor';

export interface PricedOutcome {
  variant: string;
  street: 'flop' | 'turn' | 'river';
  bucket: string;
  potFrac: number;
  /** the decision folds (a raise the replay made stays a raise: never a fold) */
  fold: boolean;
  call: boolean | null;
}

/** A record of a bettor who was value on 59 of 60 shown bets (weak share about 1.6%). */
export const STRONG_RECORD: OmahaMeasuredRecord = { shown: 60, value: 59 };

/** `raises`: price a raise too (the law counts first wagers only). */
export function pricedOutcome(
  s: PricedState,
  config: PricedConfig,
  raises = false
): PricedOutcome | null {
  const { gs, player } = s;
  const street = gs.stage as 'flop' | 'turn' | 'river';
  const variant = String(gs.gameVariant).toLowerCase();
  const raised =
    s.legacy === 'raise' ||
    (s.legacy === 'all_in' &&
      player.stack > Math.max(0, (gs.currentBet ?? 0) - (player.bet ?? 0)) + 0.005);
  const record = config === 'onWithRecord' ? STRONG_RECORD : null;
  // onKnownBettor: priced on the measured population itself (no F6 bound), as against a bettor whose record is the
  // population's: the measure the root-cause report's independent check used
  const minDefence = config !== 'onKnownBettor';
  let call: boolean | null = null;
  let potFrac = 0;
  if (street === 'flop') {
    const spot = omahaFlopFacingBetEvSpot(player, gs);
    if (!spot || (spot.isRaise && !raises)) return null;
    potFrac = spot.potFrac;
    if (config === 'today') {
      const v = omahaFlopFacingBetEvVerdict(
        spot,
        player.cards ?? [],
        gs.communityCards ?? [],
        [],
        null,
        {
          rake: 0,
          inPosition: inPosition(player, gs),
        }
      );
      call = v ? v.call : null;
    } else {
      const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
      const v = omahaFlopCallTreeVerdict(
        {
          variant,
          spot,
          hole: player.cards ?? [],
          board: gs.communityCards ?? [],
          dead: [],
          line: omahaMeasuredLineOf(gs.actionHistory, 'flop', spot.bettorSeat, spot.isRaise),
          record,
          readFactor: 1,
          rake: 0,
          left: Math.min(player.stack - spot.paid, bettor?.stack ?? Infinity),
          counters: null,
        },
        { minDefence, indifference: true, nutShare: true }
      );
      call = v ? v.call : null;
    }
  } else {
    const spot = omahaFacingBetEvSpot(player, gs);
    if (!spot || (spot.isRaise && !raises)) return null;
    potFrac = spot.potFrac;
    const base = omahaFacingBetEvVerdict(
      spot,
      player.cards ?? [],
      gs.communityCards ?? [],
      [],
      null,
      {
        rake: 0,
        realization: street === 'turn' ? (inPosition(player, gs) ? 0.92 : 0.85) : 1,
      }
    );
    if (!base) return null;
    if (config === 'today') call = base.call;
    else {
      const v = omahaPricedFacingVerdict(
        {
          variant,
          spot,
          base,
          hole: player.cards ?? [],
          board: gs.communityCards ?? [],
          dead: [],
          line: omahaMeasuredLineOf(gs.actionHistory, street, spot.bettorSeat, spot.isRaise),
          record,
          readFactor: 1,
          rake: 0,
        },
        { range: true, indifference: true, minDefence, jointField: true, nutShare: true }
      );
      call = v ? v.call : base.call;
    }
  }
  if (call === null) return null;
  return {
    variant,
    street,
    bucket: omahaMeasuredBucketOf(potFrac),
    potFrac,
    fold: raised ? false : !call,
    call,
  };
}

export interface CellRate {
  n: number;
  fold: number;
  bound: number;
}

/** Fold share and the minimum-defence bound (mean s / (1 + s) + 0.05) by game, street and size bucket. */
export function foldRates(
  states: readonly PricedState[],
  config: PricedConfig
): Map<string, CellRate> {
  const acc = new Map<string, { n: number; f: number; b: number }>();
  for (const s of states) {
    const o = pricedOutcome(s, config);
    if (!o) continue;
    const key = `${o.variant}|${o.street}|${o.bucket}`;
    const a = acc.get(key) ?? { n: 0, f: 0, b: 0 };
    a.n++;
    if (o.fold) a.f++;
    a.b += o.potFrac / (1 + o.potFrac);
    acc.set(key, a);
  }
  const out = new Map<string, CellRate>();
  for (const [k, a] of acc) out.set(k, { n: a.n, fold: a.f / a.n, bound: a.b / a.n + 0.05 });
  return out;
}
