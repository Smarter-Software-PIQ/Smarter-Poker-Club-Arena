/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TOURNAMENT SCHEDULE SERVICE (2026-08-22)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Client wrapper for the recurring-tournament schedule RPCs
 * (supabase/migrations/20260822100100_tournament_schedules.sql):
 *
 *   fn_upsert_tournament_schedule(p_schedule jsonb)  -- create/update
 *   fn_delete_tournament_schedule(p_schedule_id)     -- soft delete (active=false)
 *
 * A schedule row describes WHEN tournaments should exist; the engine's spawner
 * creates the tournaments from `config`, which carries the SAME key shapes as
 * fn_create_tournament's p_config (build it with
 * tournamentService.buildRpcConfig and strip startTime — the spawner owns it).
 *
 * Writes are union-owner / union-admin / club-admin gated server-side; reads
 * are plain authenticated selects (RLS allows read only).
 */

import { supabase, getAuthUser } from '../lib/supabase';
import {
  withTournamentScheduleCreateIntent,
  ScheduleCreateRefusedError,
  ScheduleCreateRetiredError,
} from './TournamentScheduleCreateIntent';
import { runWithRequestDeadline } from '../utils/requestDeadline';
import { reportError } from '../utils/errorReporter';
import { isUnlimitedMtt } from '../../server/src/tournament/tournamentEntryCapacity';
import {
  TOURNAMENT_CREATE_ERRORS,
  assertTournamentRpcConfig,
  tournamentCreateErrorMessage,
} from '../lib/tournamentCreationRules';

export interface TournamentScheduleRow {
  id: string;
  union_id: string | null;
  club_id: string;
  name: string;
  description: string | null;
  active: boolean;
  /** 0=Sunday .. 6=Saturday, in time_zone (UTC when it is null). */
  days_of_week: number[];
  /** 'HH:MM' 24h, in time_zone (UTC when it is null). */
  start_times_utc: string[];
  interval_minutes: number | null;
  config: Record<string, unknown>;
  /** IANA zone of the days and times; null = UTC (every pre-2026-09-24 row). */
  time_zone: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * True for a row of the hard-coded daily board (server/src/config/fixedBoard.ts,
 * 2026-10-16). The engine owns those rows: it re-writes them every ten minutes
 * and the database refuses an owner edit, so the owner screens show them as
 * fixed instead of offering a button that would only appear to work.
 */
export function isFixedBoardSchedule(row: Pick<TournamentScheduleRow, 'config'>): boolean {
  const cfg = row.config;
  return (
    !!cfg &&
    typeof cfg === 'object' &&
    !Array.isArray(cfg) &&
    (cfg.type === 'fixed_board' || typeof cfg.fixedBoard === 'string')
  );
}

export interface TournamentScheduleDraft {
  /** Present = update that row; absent = create. */
  id?: string;
  unionId?: string | null;
  clubId: string;
  name: string;
  description?: string;
  active?: boolean;
  daysOfWeek: number[];
  /** 'HH:MM' wall-clock times in timeZone (UTC when timeZone is null). */
  startTimesUtc: string[];
  /**
   * IANA zone the days and times are in (the creator's device zone). Omit on
   * an update to keep the stored zone; null means UTC. Editing a schedule
   * changes only instances the engine has not spawned yet.
   */
  timeZone?: string | null;
  intervalMinutes?: number | null;
  /** fn_create_tournament p_config shape, WITHOUT startTime. */
  config: Record<string, unknown>;
}

const SCHEDULE_ERRORS: Record<string, string> = {
  schedule_request_payload_changed: 'This Request Already Belongs To Different Schedule Settings.',
  schedule_request_target_changed:
    'The Original Schedule Changed Or Was Removed. It Was Not Created Again.',
  not_authenticated: 'You need to be signed in to manage schedules.',
  not_authorised: 'Only the union owner or an admin can manage this schedule.',
  schedule_not_found: 'That schedule no longer exists.',
  schedule_must_be_object: 'Schedule payload was malformed.',
  club_id_required: 'A schedule needs a club.',
  name_required: 'Give the schedule a name.',
  config_must_be_object: 'The tournament configuration is missing.',
  custom_level_breaks_not_supported:
    'Custom Level Breaks Are Not Supported. Remove Break Rows And Use The Synchronized Break Setting.',
  days_of_week_required: 'Pick at least one day of the week.',
  days_of_week_out_of_range: 'Days of week must be Sunday through Saturday.',
  start_time_format_invalid: 'Start times must be HH:MM, 24-hour.',
  time_zone_unknown: 'Your time zone is not recognized. Set your device to a named time zone.',
  start_times_or_interval_required: 'Add at least one start time, or a repeat interval.',
  interval_minutes_out_of_range: 'The repeat interval must be 5 to 1440 minutes.',
  // 20260924102056: an enforced commerce admission refuses a NEW recurring
  // schedule. The server's own `message` is shown (scheduleErrorText); this
  // is the same sentence for an answer that carries none.
  operating_access_required:
    'This Club Needs Active Operating Access To Create A New Tournament. Scheduled And Running Tournaments Are Not Affected.',
};

/**
 * A schedule's configuration is refused with the same codes, and the same
 * sentences, as a hand-created tournament (fn_tournament_config_refusal,
 * 20260924033701), so an unmapped schedule code falls through to that map.
 */
function scheduleErrorText(code: string | undefined, serverMessage?: string | null): string {
  if (code === 'operating_access_required') {
    return tournamentCreateErrorMessage(code, serverMessage);
  }
  return (
    SCHEDULE_ERRORS[code ?? ''] ??
    TOURNAMENT_CREATE_ERRORS[code ?? ''] ??
    'Could not save the schedule.'
  );
}

class TournamentScheduleService {
  /** Create or update a schedule. Returns the schedule id. Throws on refusal. */
  async upsert(draft: TournamentScheduleDraft): Promise<string> {
    // The shared creation rules, schedule surface: refused here with the
    // owner-facing reason before the round trip, and again by
    // fn_upsert_tournament_schedule for any caller that skips this.
    assertTournamentRpcConfig(draft.config, { surface: 'schedule' });
    const payload = {
      id: draft.id ?? null,
      unionId: draft.unionId ?? null,
      clubId: draft.clubId,
      name: draft.name,
      description: draft.description ?? null,
      active: draft.active ?? true,
      daysOfWeek: draft.daysOfWeek,
      startTimesUtc: draft.startTimesUtc,
      ...(draft.timeZone !== undefined ? { timeZone: draft.timeZone } : {}),
      intervalMinutes: draft.intervalMinutes ?? null,
      config: isUnlimitedMtt({ ...draft.config, type: draft.config.type ?? 'mtt' })
        ? { ...draft.config, maxPlayers: null, max_players: null }
        : draft.config,
    };
    const save = async (requestId?: string, userId?: string): Promise<string> => {
      const { data, error } = requestId
        ? await runWithRequestDeadline(
            (signal) =>
              supabase
                .rpc('fn_create_tournament_schedule_request', {
                  p_schedule: payload,
                  p_request_id: requestId,
                  p_user_id: userId,
                })
                .abortSignal(signal),
            {
              timeoutError: () =>
                new Error(
                  'The Schedule Save Could Not Be Confirmed. Submit The Same Settings To Check Its Original Request.'
                ),
            }
          )
        : await supabase.rpc('fn_upsert_tournament_schedule', { p_schedule: payload });
      if (error) {
        reportError(error, 'TournamentScheduleService.upsert');
        if (requestId && error.code === 'PGRST202')
          throw new Error(
            'Safe Schedule Creation Is Not Available Yet. The Original Request Is Retained.'
          );
        throw new Error(
          'The Schedule Save Could Not Be Confirmed. Submit The Same Settings To Check Its Original Request.'
        );
      }
      const res = data as {
        ok?: boolean;
        schedule_id?: string;
        request_id?: string;
        user_id?: string;
        request_state?: string;
        error?: string;
        message?: string;
      } | null;
      if (
        requestId &&
        res?.request_id === requestId &&
        res.user_id === userId &&
        res.request_state === 'retired' &&
        res.error === 'schedule_request_target_changed' &&
        typeof res.schedule_id === 'string' &&
        res.schedule_id.trim()
      )
        throw new ScheduleCreateRetiredError(
          res.schedule_id,
          'The Original Schedule Was Changed Or Removed. Submit Again To Create A New Schedule.'
        );
      if (res?.ok !== true || typeof res.schedule_id !== 'string' || !res.schedule_id.trim()) {
        if (
          requestId &&
          res?.request_id === requestId &&
          res.user_id === userId &&
          res.request_state === 'not_created'
        )
          throw new ScheduleCreateRefusedError(scheduleErrorText(res.error, res.message));
        throw new Error(scheduleErrorText(res?.error, res?.message));
      }
      if (requestId && (res.request_id !== requestId || res.user_id !== userId))
        throw new Error(
          'The Schedule Receipt Could Not Be Verified. Submit The Same Settings To Check Its Original Request.'
        );
      return res.schedule_id;
    };
    if (draft.id) return save();
    const { data: auth, error: authError } = await runWithRequestDeadline(() => getAuthUser());
    if (authError || !auth.user) throw new Error('Sign In Before Creating A Schedule.');
    return withTournamentScheduleCreateIntent(
      { userId: auth.user.id, clubId: draft.clubId, unionId: draft.unionId ?? null },
      payload,
      (requestId) => save(requestId, auth.user!.id)
    );
  }

  /** Flip active on an existing schedule without touching anything else. */
  async setActive(scheduleId: string, active: boolean): Promise<void> {
    if (active) {
      const { data, error } = await supabase.rpc('fn_upsert_tournament_schedule', {
        p_schedule: { id: scheduleId, active: true },
      });
      if (error) {
        reportError(error, 'TournamentScheduleService.setActive');
        throw new Error('Could not update the schedule.');
      }
      const res = data as { ok?: boolean; error?: string } | null;
      if (res?.ok !== true) throw new Error(scheduleErrorText(res?.error));
      return;
    }
    await this.deactivate(scheduleId);
  }

  /** Soft delete: sets active=false. Spawn history is preserved server-side. */
  async deactivate(scheduleId: string): Promise<void> {
    const { data, error } = await supabase.rpc('fn_delete_tournament_schedule', {
      p_schedule_id: scheduleId,
    });
    if (error) {
      reportError(error, 'TournamentScheduleService.deactivate');
      throw new Error('Could not deactivate the schedule.');
    }
    const res = data as { ok?: boolean; error?: string } | null;
    if (res?.ok !== true) throw new Error(scheduleErrorText(res?.error));
  }

  /** All schedules owned by a union, newest first. */
  async listForUnion(unionId: string, signal?: AbortSignal): Promise<TournamentScheduleRow[]> {
    const { data, error } = await runWithRequestDeadline(
      (requestSignal) =>
        supabase
          .from('tournament_schedules')
          .select(
            'id, union_id, club_id, name, description, active, days_of_week, start_times_utc, interval_minutes, config, time_zone, created_at, updated_at'
          )
          .eq('union_id', unionId)
          .order('created_at', { ascending: false })
          .abortSignal(requestSignal),
      { signal }
    );
    if (error || !Array.isArray(data)) {
      if (error) reportError(error, 'TournamentScheduleService.listForUnion');
      throw new Error('Could Not Load Recurring Schedules.');
    }
    return data as TournamentScheduleRow[];
  }
}

export const tournamentScheduleService = new TournamentScheduleService();
export default tournamentScheduleService;
