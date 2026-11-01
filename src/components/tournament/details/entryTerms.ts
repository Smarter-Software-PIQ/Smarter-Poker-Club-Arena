import type { Tournament } from '../../../types/database.types';
import type { LobbyTournamentRow } from '../../lobby/lobbyEntries';
import { lateRegEndMs } from '../../lobby/lateRegWindow';
import {
  tournamentEntryWindow,
  tournamentEntryWindowOpen,
} from '../../../utils/tournamentEntryWindow';
import { compactChips, formatPrizeAtUnit, moneyWordAtUnit } from '../../../utils/format';

/** Display only: admission and purchases remain owned by the server. */
export function tournamentEntryTerms(
  t: Tournament,
  now: number,
  unitCents: number,
  clockPaused = false
) {
  const stamp = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  const status = String(t.status).toUpperCase();
  const finished = ['COMPLETED', 'CANCELLED'].includes(status);
  const window = tournamentEntryWindow(t);
  const rules: string[] = [];
  if (window.mode === 'levels') rules.push(`End Of Level ${window.cap}`);
  if (window.mode !== 'closed' && window.minutes) rules.push(`${window.minutes} Min After Start`);
  const rule = rules.join(' Or ') + (rules.length > 1 ? ' (Whichever Comes First)' : '');
  const live = ['RUNNING', 'IN_PROGRESS', 'LATE_REG', 'LATE_REGISTRATION'].includes(status);
  const closed =
    finished || window.mode === 'closed' || (live && !tournamentEntryWindowOpen(t, now));
  const deadline =
    live && !closed && !t.on_break && !clockPaused
      ? lateRegEndMs(t as unknown as LobbyTournamentRow)
      : null;
  const lateRegistration = closed
    ? `Closed${rule ? ` · ${rule}` : ''}`
    : `${rule}${deadline !== null && deadline > now ? ` · Estimated ${stamp(deadline)}` : ''}`;

  if (!t.add_on_available) return { lateRegistration, addon: 'No' };
  // Match processAddOn / the authoritative purchase's zero-price fallback.
  const rawCost = Number(t.addon_cost || t.buy_in_amount || 0);
  const cost =
    Number.isFinite(rawCost) && rawCost >= 0
      ? `${formatPrizeAtUnit(Math.round(rawCost), unitCents)} ${moneyWordAtUnit(unitCents)}`
      : 'Unconfirmed';
  const rawStack = Number(t.addon_chips || t.starting_chips || 0);
  const stack =
    Number.isFinite(rawStack) && rawStack > 0 ? `${compactChips(rawStack)} Chips` : 'Unconfirmed';
  const start = Date.parse(String(t.addon_period_started_at ?? ''));
  const end = Date.parse(String(t.addon_period_ends_at ?? ''));
  const configuredBreak = Number(t.addon_break_minutes ?? 1);
  const breakMinutes = Math.min(
    10,
    Math.max(1, Number.isFinite(configuredBreak) ? Math.floor(configuredBreak) : 1)
  );
  let timing: string;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const state =
      finished || t.prize_pool_finalized || now >= end
        ? 'Ended'
        : now >= start
          ? 'Open Now'
          : 'Scheduled';
    timing = `${state} · ${stamp(start)} To ${stamp(end)}`;
  } else if (finished || t.prize_pool_finalized) {
    timing = 'Closed';
  } else {
    timing = t.addon_from_start
      ? `From Seating Through The ${breakMinutes} Min Break After Late Registration`
      : `After Late Registration Closes And Current Hands Finish · ${breakMinutes} Min Break`;
  }
  return { lateRegistration, addon: 'Yes', cost, stack, timing };
}
