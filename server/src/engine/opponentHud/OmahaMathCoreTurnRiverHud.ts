/**
 * B3 MATH CORE TURN/RIVER HUD ADAPTER (lane core-repair, PLO-OWNER lead-4).
 *
 * Lives outside omahaMathCore/ so the math core remains 100% identity-free (seat-only interface).
 * Reads ONLY public lifetime action counters already shipped in OpponentHudPacket:
 *   - hudFirstWagerSizeCounts (exact fw1 14-bin first-wager sizes + unopened opps)
 *   - hudBarrelRecord (exact double/triple-barrel counts after prior-street wager)
 *   - hudStat(..., false).prior (family population prior rate)
 * Zero unshown cards, zero person/Horse labels, zero DB/clock reads. Never throws.
 */
import {
  setOmahaMathCoreTurnRiverProvider,
  type OmahaMathCoreTurnRiverProvider,
} from '../omahaMathCore/OmahaMathCoreTurnRiver.js';
import {
  decisionHudFamily,
  hudBarrelRecord,
  hudFirstWagerRecord,
  hudFirstWagerSizeCounts,
  hudStat,
} from './OpponentHud.js';

function seatUserId(table: unknown, seat: number): string | null {
  const gs = table as { players?: readonly { seat: number; user_id?: unknown }[] } | null;
  const id = (gs?.players ?? []).find((p) => p.seat === seat)?.user_id;
  if (id === undefined || id === null || String(id) === '') return null;
  return String(id);
}

export const omahaMathCoreTurnRiverHud: OmahaMathCoreTurnRiverProvider = {
  active(game) {
    return decisionHudFamily() === game;
  },
  firstWager(table, seat, game, street, players, line) {
    try {
      const id = seatUserId(table, seat);
      if (!id) return null;
      const family = decisionHudFamily();
      if (family !== game) return null;
      const sz = hudFirstWagerSizeCounts(id, family, {
        street,
        players,
        ...(line ? { line } : {}),
      });
      if (!sz) return null;
      const sk = street === 'turn' ? 't' : 'r';
      const priorStat = line ? `${sk}.${line}.${players}` : `${sk}.stab.${players}`;
      const priorRead = hudStat(id, family, priorStat, undefined, false);
      return {
        opps: sz.opps,
        bets: sz.bets,
        bins: sz.bins,
        priorRate: priorRead.prior,
      };
    } catch {
      return null;
    }
  },
  barrel(table, seat, game, street, players) {
    try {
      const id = seatUserId(table, seat);
      if (!id) return null;
      const family = decisionHudFamily();
      if (family !== game) return null;
      const brl = hudBarrelRecord(id, family, { street, players });
      return brl ? { opps: brl.opps, bets: brl.bets } : null;
    } catch {
      return null;
    }
  },
  riverRate(table, seat, game, players) {
    try {
      const id = seatUserId(table, seat);
      if (!id) return null;
      const family = decisionHudFamily();
      if (family !== game) return null;
      const r = hudFirstWagerRecord(id, family, 'river', players);
      return r ? { opps: r.opps, bets: r.bets } : null;
    } catch {
      return null;
    }
  },
};

setOmahaMathCoreTurnRiverProvider(omahaMathCoreTurnRiverHud);
