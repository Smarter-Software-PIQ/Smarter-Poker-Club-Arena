import type { SealedStagePlanBody } from './multiDaySchedule';

export interface CreatedTournamentStageIntent {
  version: 1;
  tournamentId: string;
  plan: SealedStagePlanBody;
}

export const createdStageIntentKey = (actorId: string, clubId: string) =>
  `ca_created_stage_intent_v1:${JSON.stringify([actorId, clubId])}`;

/** An unreadable retained identity must never become permission to create again. */
export function readCreatedStageIntent(key: string): CreatedTournamentStageIntent | null {
  const raw = sessionStorage.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw) as CreatedTournamentStageIntent;
  if (
    value?.version !== 1 ||
    typeof value.tournamentId !== 'string' ||
    !value.tournamentId ||
    typeof value.plan?.time_zone !== 'string' ||
    !Array.isArray(value.plan.stages) ||
    value.plan.stages.length < 2 ||
    value.plan.stages.length > 14 ||
    value.plan.stages.some(
      (stage, index) =>
        stage.stage_no !== index + 1 ||
        (stage.end_after_level != null &&
          (!Number.isInteger(stage.end_after_level) || stage.end_after_level < 1)) ||
        (stage.scheduled_start_utc != null &&
          !Number.isFinite(Date.parse(stage.scheduled_start_utc)))
    )
  ) {
    throw new Error(
      'The Previous Tournament Creation Cannot Be Read. Check Your Tournament List Before Creating Another.'
    );
  }
  return value;
}

export function retainCreatedStageIntent(key: string, intent: CreatedTournamentStageIntent) {
  const raw = JSON.stringify(intent);
  sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw)
    throw new Error('The Created Tournament Could Not Be Retained For This Form.');
}

export function clearCreatedStageIntent(key: string, intent: CreatedTournamentStageIntent) {
  if (sessionStorage.getItem(key) === JSON.stringify(intent)) sessionStorage.removeItem(key);
}
