import { reportError } from './errorReporter.js';
import { PLO_LIGHTNING_GAME, type PloLightningDemand } from './PloLightningDemand.js';

/** The original immutable cash-out chooses once; a tick never rolls again. */
export async function readPloLightningDemand(
  read: () => PromiseLike<{ data: unknown; error: unknown }>
): Promise<PloLightningDemand | null> {
  try {
    const { data, error } = await read();
    const value = data as Partial<PloLightningDemand> | null;
    if (error) throw error;
    if (
      !value ||
      value.game_id !== PLO_LIGHTNING_GAME ||
      !(
        value.event_id === null ||
        (typeof value.event_id === 'string' && /^[0-9a-f-]{36}$/.test(value.event_id))
      ) ||
      typeof value.continues !== 'boolean' ||
      typeof value.wind_down !== 'boolean' ||
      (value.continues && value.wind_down) ||
      ((value.continues || value.wind_down) && !value.event_id)
    )
      throw new Error('PLO continuation demand is unavailable');
    return data as PloLightningDemand;
  } catch (error) {
    reportError(error, 'PloLightningDemand.read');
    return null; // unknown never admits extra players or starts a wind-down
  }
}
