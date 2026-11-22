/**
 * TURN 4B OMAHA LIFETIME-HUD PROVIDERS (PLO-OWNER lead-4, 2026-11-22).
 *
 * Bridges the worker's installed decision HUD packet (OpponentHud.ts) to the three Turn 4B
 * lifetime-HUD rule providers in production:
 *  - HorseMind.setOmahaLifetimeStreetRecordProvider (consumed by omahaStabDefenceIsPriced and
 *    omahaRiverBetFoldIsHisRecord / omahaStrongHandCheckIsPriced)
 *  - setOmahaCbetRaiseRecordProvider (consumed by omahaCbetRaiseIsPriced)
 *
 * Pure read-only mapping over the already-installed decision packet. No packet installed,
 * wrong game family, or missing profile = null (exact population prior). Zero DB/clock reads,
 * zero person-vs-Horse keys, zero unshown card reads; never throws.
 */
import { HorseMind } from '../HorseMind.js';
import { omahaLifetimeProviderFromHud } from '../HorseOmahaLifetimeHudAdapter.js';
import {
  setOmahaCbetRaiseRecordProvider,
  type OmahaCbetRaiseRecordProvider,
} from '../HorseOmahaCbetRaisePriced.js';
import {
  decisionHudFamily,
  hudCbetRaiseRecord,
  hudFirstWagerRecord,
  hudLifetimeCount,
} from './OpponentHud.js';

export const omahaLifetimeStreetRecordHudProvider = omahaLifetimeProviderFromHud({
  hudFirstWagerRecord,
  hudLifetimeCount,
});

export const omahaCbetRaiseHudProvider: OmahaCbetRaiseRecordProvider = {
  cbetRaiseRecord(opponentId, game, players) {
    try {
      if (decisionHudFamily() !== game) return null;
      const r = hudCbetRaiseRecord(opponentId, game, players);
      return r ? { opps: r.opps, raises: r.raises } : null;
    } catch {
      return null;
    }
  },
};

/** Wire both Turn 4B HUD providers onto the decision worker's installed OpponentHud packet. */
export function installOmahaTurn4bHudProviders(): void {
  HorseMind.setOmahaLifetimeStreetRecordProvider(omahaLifetimeStreetRecordHudProvider);
  setOmahaCbetRaiseRecordProvider(omahaCbetRaiseHudProvider);
}
