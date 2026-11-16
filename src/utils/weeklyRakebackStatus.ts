/**
 * WEEKLY RAKEBACK STATUS (owner, 2026-11-15): the reader behind the Union
 * Statements page's Weekly Rakeback Status section.
 * public.ca_union_weekly_rakeback_status (20261116020505) returns one week's
 * payout stage by stage; this file parses it and decides whether the page
 * may read it again. Nothing here moves chips.
 */

export type RakebackStageState = 'waiting' | 'running' | 'done' | 'late' | 'failed';

export interface RakebackStage {
  key: string;
  label: string;
  state: RakebackStageState;
  at: string | null;
  amount: number | null;
  count: number | null;
  detail: string;
}

export interface RakebackCreditNote {
  number: string | null;
  amount: number | null;
  delivered: boolean;
}

export interface RakebackStatement {
  number: string | null;
  club: string | null;
  house: boolean;
  direction: string | null;
  amount: number | null;
  delivered: boolean;
  matches_club_data: boolean | null;
  credit_notes: RakebackCreditNote[];
}

export interface WeeklyRakebackStatus {
  union_id: string;
  period: { start: string; end: string };
  scheduled_for: string | null;
  in_progress: boolean;
  stages: RakebackStage[];
  statements: RakebackStatement[];
  last_updated: string | null;
  generated_at: string;
}

/** The page reads again at most this often, and only while a run is in progress. */
export const WEEKLY_RAKEBACK_REFRESH_MS = 60_000;

const STATES: readonly RakebackStageState[] = ['waiting', 'running', 'done', 'late', 'failed'];

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function instant(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    throw new Error(`${label} is invalid`);
  return value;
}

/** An exact chip-cent amount, or null when the stage has none. */
function amount(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) {
    throw new Error(`${label} is not an exact chip-cent amount`);
  }
  return value;
}

function count(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function parseWeeklyRakebackStatus(value: unknown): WeeklyRakebackStatus {
  const root = record(value, 'Weekly Rakeback Status');
  const period = record(root.period, 'Period');
  if (!Array.isArray(root.stages) || !Array.isArray(root.statements)) {
    throw new Error('Weekly Rakeback Status is invalid');
  }
  const stages = root.stages.map((raw, i): RakebackStage => {
    const s = record(raw, `Stage ${i + 1}`);
    const state = s.state as RakebackStageState;
    if (!STATES.includes(state)) throw new Error(`Stage ${i + 1} state is invalid`);
    return {
      key: text(s.key, `Stage ${i + 1} key`),
      label: text(s.label, `Stage ${i + 1} label`),
      state,
      at: instant(s.at, `Stage ${i + 1} time`),
      amount: amount(s.amount, `Stage ${i + 1} amount`),
      count: count(s.count, `Stage ${i + 1} count`),
      detail: typeof s.detail === 'string' ? s.detail : '',
    };
  });
  const statements = root.statements.map((raw, i): RakebackStatement => {
    const s = record(raw, `Statement ${i + 1}`);
    const notes = Array.isArray(s.credit_notes) ? s.credit_notes : [];
    return {
      number: optionalText(s.number),
      club: optionalText(s.club),
      house: s.house === true,
      direction: optionalText(s.direction),
      amount: amount(s.amount, `Statement ${i + 1} amount`),
      delivered: s.delivered === true,
      matches_club_data: typeof s.matches_club_data === 'boolean' ? s.matches_club_data : null,
      credit_notes: notes.map((n, j) => {
        const c = record(n, `Credit Note ${j + 1}`);
        return {
          number: optionalText(c.number),
          amount: amount(c.amount, `Credit Note ${j + 1} amount`),
          delivered: c.delivered === true,
        };
      }),
    };
  });
  return {
    union_id: text(root.union_id, 'Union'),
    period: {
      start: instant(period.start, 'Period start') ?? '',
      end: text(period.end, 'Period end'),
    },
    scheduled_for: instant(root.scheduled_for, 'Scheduled time'),
    in_progress: root.in_progress === true,
    stages,
    statements,
    last_updated: instant(root.last_updated, 'Last updated'),
    generated_at: text(root.generated_at, 'Read time'),
  };
}

/** One word for the whole week: the worst stage wins. */
export function weeklyRakebackOverall(
  status: WeeklyRakebackStatus
): 'Failed' | 'Late' | 'Running' | 'Done' | 'Waiting' {
  const states = status.stages.map((s) => s.state);
  if (states.includes('failed')) return 'Failed';
  if (states.includes('late')) return 'Late';
  if (status.in_progress || states.includes('running')) return 'Running';
  if (states.length > 0 && states.every((s) => s === 'done')) return 'Done';
  return 'Waiting';
}
