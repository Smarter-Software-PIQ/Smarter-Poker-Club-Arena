/**
 * THE MATH CORE'S OPPONENT-RECORD PROVIDER over the lifetime opponent HUD (lane CORE-EXTEND-5, 2026-11-21).
 *
 * The core names an opponent only by his seat (OmahaMathCoreOpponentRecords); this adapter, outside the core, finds
 * whose public record that is in the decision's installed HUD packet (the same packet every HUD reader reads) and
 * hands back raw lifetime counts. No packet, another game's packet or no profile of him = null (the core prices the
 * pooled response, exactly as before). Read only while a core street flag is on; every core flag is default OFF.
 */
import {
  setOmahaMathCoreOpponentRecords,
  type OmahaMathCoreOpponentRecords,
} from '../omahaMathCore/OmahaMathCore.js';
import { decisionHudFamily, hudCbetRaiseRecord } from './OpponentHud.js';

export const omahaMathCoreHudRecords: OmahaMathCoreOpponentRecords = {
  cbetAnswers(table, seat, game, players) {
    const gs = table as { players?: readonly { seat: number; user_id?: unknown }[] } | null;
    const id = (gs?.players ?? []).find((p) => p.seat === seat)?.user_id;
    if (id === undefined || id === null || String(id) === '') return null;
    const family = decisionHudFamily();
    if (family !== game) return null;
    const r = hudCbetRaiseRecord(String(id), family, players);
    return r ? { opps: r.opps, raises: r.raises } : null;
  },
};

setOmahaMathCoreOpponentRecords(omahaMathCoreHudRecords);
