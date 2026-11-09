import { manualTournamentBlindPreset } from '../config/blindStructures';
import {
  PREBUILT_STRUCTURES,
  prebuiltLadder,
  prebuiltLateRegLevels,
  prebuiltStartingChips,
  type PrebuiltStructureId,
} from '../config/prebuiltStructures';
import {
  MTT_CREATION_PROFILES,
  mttCreationProfileValues,
  type MttCreationProfileId,
} from '../../server/src/tournament/mttCreationProfiles';

export function manualMttCreationProfile(id: MttCreationProfileId) {
  const profile = MTT_CREATION_PROFILES.find((entry) => entry.id === id);
  if (!profile) throw new Error('Unknown MTT Structure Preset');
  const opening = manualTournamentBlindPreset(profile.blindRamp).find((row) => !row.isBreak);
  return mttCreationProfileValues(id, opening?.bigBlind ?? NaN);
}

export type ManualMttProfileValues = ReturnType<typeof manualMttCreationProfile>;

/** Custom/restored rules stay custom unless all three effective inputs match. */
export function selectedManualMttProfile(values: {
  blindStructure: string;
  blindsUpMinutes: number;
  startingChips: number;
}): MttCreationProfileId | 'custom' {
  return (
    MTT_CREATION_PROFILES.find(({ id }) => {
      const proposed = manualMttCreationProfile(id);
      return (
        proposed.blindStructure === values.blindStructure &&
        proposed.blindsUpMinutes === values.blindsUpMinutes &&
        proposed.startingChips === values.startingChips
      );
    })?.id ?? 'custom'
  );
}

/**
 * The six prebuilt structures offered to a creator, each already bound to its
 * own ladder, starting stack and derived registration cutoff (owner ruling
 * 2026-11-08). A standalone club or union is never limited to these: an
 * authored custom structure stays custom, and `selectedManualMttProfile`
 * above still reports 'custom' for anything that is not an exact match.
 *
 * `availableOnly` is what the picker renders. A preset whose stated duration
 * the production path cannot yet preserve end to end is NOT offered, because a
 * button labelled "30 minute levels" that produces eight minute levels is
 * worse than no button. The clock floor and ceiling that decide this are
 * engine-side and move only through the owning release operation.
 */
export interface PrebuiltStructureOption {
  id: PrebuiltStructureId;
  label: string;
  minutes: number;
  blurb: string;
  startingChips: number;
  lateRegLevels: number;
  playableLevels: number;
  breaks: number;
}

export function prebuiltStructureOption(id: PrebuiltStructureId): PrebuiltStructureOption {
  const spec = PREBUILT_STRUCTURES.find((entry) => entry.id === id);
  if (!spec) throw new Error('Unknown Tournament Structure');
  const rows = prebuiltLadder(id);
  const playable = rows.filter((row) => !row.isBreak);
  return {
    id: spec.id,
    label: spec.label,
    minutes: spec.minutes,
    blurb: spec.blurb,
    startingChips: prebuiltStartingChips(id),
    lateRegLevels: prebuiltLateRegLevels(id),
    playableLevels: playable.length,
    breaks: rows.length - playable.length,
  };
}

export function prebuiltStructureOptions(): PrebuiltStructureOption[] {
  return PREBUILT_STRUCTURES.map((spec) => prebuiltStructureOption(spec.id));
}
