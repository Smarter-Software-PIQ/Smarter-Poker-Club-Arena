import {
  offerablePrebuiltStructures,
  parsePrebuiltStructureKey,
  prebuiltStartingChips,
  prebuiltStructureKey,
} from '../../config/prebuiltStructures';

import { prebuiltStructureOption } from '../../lib/mttCreationProfile';

export interface PrebuiltStructureValues {
  blindStructure: `prebuilt:${string}`;
  blindsUpMinutes: number;
  startingChips: number;
}

/**
 * The Table Manager structure picker.
 *
 * Writes the SAME three config fields the existing setup preset writes -
 * blindStructure (a preset key, never a ladder), blindsUpMinutes and
 * startingChips - so storage and the creation consumer are unchanged.
 *
 * Only presets whose stated duration survives the whole creation path are
 * offered (see PRESET_CLOCK_SUPPORT). A club or union is never limited to
 * them: Custom Structure leaves whatever ladder the creator authored, and
 * editing any blind field afterwards returns this control to Custom Structure
 * rather than silently re-applying a preset.
 */
export function PrebuiltStructureSelect({
  config,
  isPinned = false,
  onApply,
}: {
  config: { gameMode: string; blindStructure: string; blindsUpMinutes: number };
  isPinned?: boolean;
  onApply: (values: PrebuiltStructureValues) => void;
}) {
  if (config.gameMode !== 'mtt') return null;
  const offerable = offerablePrebuiltStructures(isPinned);
  if (offerable.length === 0) return null;

  const stored = parsePrebuiltStructureKey(config.blindStructure);
  const selected =
    stored &&
    offerable.some((spec) => spec.id === stored) &&
    config.blindsUpMinutes === prebuiltStructureOption(stored).minutes
      ? prebuiltStructureKey(stored)
      : 'custom';

  return (
    <div className="config-radio-group">
      <label className="radio-group-label" htmlFor="prebuilt-structure">
        Tournament Structure
      </label>
      <select
        id="prebuilt-structure"
        className="config-select"
        data-testid="prebuilt-structure-select"
        value={selected}
        onChange={(event) => {
          const id = parsePrebuiltStructureKey(event.target.value);
          if (!id) return;
          onApply({
            blindStructure: prebuiltStructureKey(id),
            blindsUpMinutes: prebuiltStructureOption(id).minutes,
            startingChips: prebuiltStartingChips(id),
          });
        }}
      >
        <option value="custom">Custom Structure</option>
        {offerable.map((spec) => {
          const option = prebuiltStructureOption(spec.id);
          return (
            <option key={spec.id} value={prebuiltStructureKey(spec.id)}>
              {option.label} · {option.minutes} Min Levels · {option.startingChips.toLocaleString()}{' '}
              Chips
            </option>
          );
        })}
      </select>
    </div>
  );
}
