/**
 * AN EVENT NOBODY ENTERED IS CANCELLED, NOT WAITED ON FOR EVER (2026-10-15).
 *
 * TournamentNeverStarted paged every hour on three "Daily 25 Chip Freezeout"
 * events of a one-member pilot club with no horse in it: zero entrants, 7 to
 * 55 hours past start, REGISTERING for ever, one more spawned every day. The
 * past-start lane topped them up with horses that did not exist and tried
 * again, with no end. See tournament/emptyPastStartEvent.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_PAST_START_CANCEL_AFTER_MS,
  EMPTY_PAST_START_CANCEL_RETRY_MS,
  EMPTY_PAST_START_LANE_BUSY_RETRY_MS,
  isCancellationLaneBusy,
  laneBusyCancelAskedAt,
  shouldCancelEmptyPastStartEvent,
  type EmptyPastStartEvent,
} from './emptyPastStartEvent.js';

const START = Date.parse('2026-10-14T19:00:00Z');
const empty: EmptyPastStartEvent = {
  seatFirst: false,
  poolFinalized: false,
  rosterCount: 0,
  currentPlayers: 0,
  startTimeMs: START,
  nowMs: START + 7 * 60 * 60 * 1000,
  emptyTopUps: 1,
};

describe('an empty past-start event', () => {
  it('is cancelled once nobody entered, it is 30 minutes past start and the top-up came back empty', () => {
    expect(shouldCancelEmptyPastStartEvent(empty)).toBe(true);
    expect(
      shouldCancelEmptyPastStartEvent({
        ...empty,
        nowMs: START + EMPTY_PAST_START_CANCEL_AFTER_MS,
      })
    ).toBe(true);
  });

  it('is never cancelled with an entrant on its roster or its counter', () => {
    expect(shouldCancelEmptyPastStartEvent({ ...empty, rosterCount: 1 })).toBe(false);
    expect(shouldCancelEmptyPastStartEvent({ ...empty, currentPlayers: 1 })).toBe(false);
  });

  it('is never cancelled when its roster could not be read', () => {
    expect(shouldCancelEmptyPastStartEvent({ ...empty, rosterCount: undefined })).toBe(false);
  });

  it('waits for the top-up first, so a club whose horses can fill it plays it', () => {
    expect(shouldCancelEmptyPastStartEvent({ ...empty, emptyTopUps: 0 })).toBe(false);
  });

  it('waits thirty minutes past start', () => {
    expect(
      shouldCancelEmptyPastStartEvent({
        ...empty,
        nowMs: START + EMPTY_PAST_START_CANCEL_AFTER_MS - 1,
      })
    ).toBe(false);
    expect(shouldCancelEmptyPastStartEvent({ ...empty, nowMs: START - 60_000 })).toBe(false);
  });

  it('never touches a seat-first game or a finalized pool', () => {
    expect(shouldCancelEmptyPastStartEvent({ ...empty, seatFirst: true })).toBe(false);
    expect(shouldCancelEmptyPastStartEvent({ ...empty, poolFinalized: true })).toBe(false);
  });

  it('refuses an unreadable clock', () => {
    expect(shouldCancelEmptyPastStartEvent({ ...empty, startTimeMs: Number.NaN })).toBe(false);
  });

  it('asks again no more than every thirty minutes', () => {
    expect(EMPTY_PAST_START_CANCEL_RETRY_MS).toBe(30 * 60 * 1000);
  });
});

describe('the discovery loop wiring', () => {
  const source = readFileSync(join(process.cwd(), 'src/GameServer.ts'), 'utf8');
  const start = source.indexOf('AN EVENT NOBODY ENTERED IS CANCELLED (2026-10-15)');
  const branch = source.slice(start, source.indexOf('/* At most every 45 s', start));

  it('asks the predicate with the complete roster read and the top-up backoff', () => {
    expect(start).toBeGreaterThan(-1);
    expect(branch).toContain('shouldCancelEmptyPastStartEvent({');
    expect(branch).toContain('rosterCount: rosterByTournament.get(tournament.id)');
    expect(branch).toMatch(/emptyTopUps: Math\.max\(\s*emptyClock\?\.misses \?\? 0,/);
  });

  /**
   * THE EMPTY COUNT SURVIVES A RESTART (2026-10-26). "Daily 25 Chip Freezeout"
   * 501008e1 was due to cancel at 19:30 UTC on 2026-10-25; the engine restarted
   * at 19:30, forgot every top-up it had asked, and the cancel landed at 19:52
   * while TournamentNeverStarted paged. The count the predicate reads is the
   * larger of this process's and the one written to
   * public.tournament_past_start_top_ups by whichever process asked.
   */
  it('reads the durable empty-top-up count beside the roster read and takes the larger', () => {
    expect(branch).toContain('durableEmptyTopUps.get(tournament.id) ?? 0');
    const read = source.indexOf('const durableEmptyTopUps = await this.readDurableEmptyTopUps(');
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(start);
    expect(
      source.indexOf('const rosterByTournament = await this.readEntrantRosterCounts(')
    ).toBeLessThan(read);
    expect(source).toContain(".from('tournament_past_start_top_ups')");
  });

  it('writes the count when a past-start top-up settles for an event with no entrant, and clears it when anyone is added or the event is cancelled', () => {
    const topUp = source.slice(source.indexOf('/* At most every 45 s', start));
    expect(topUp).toContain('if (rosterByTournament.get(tournament.id) === 0 && !held) {');
    expect(topUp).toMatch(
      /recordPastStartTopUpOutcome\(\s*tournament\.id,\s*added > 0\s*\?\s*null\s*:/
    );
    expect(branch).toContain('await this.recordPastStartTopUpOutcome(tournament.id, null);');
    // A delete clears it; the upsert keys on the event.
    expect(source).toMatch(
      /\.from\('tournament_past_start_top_ups'\)\s*\.delete\(\)\s*\.eq\('tournament_id', tournamentId\)/
    );
    expect(source).toMatch(/\.from\('tournament_past_start_top_ups'\)\s*\.upsert\(/);
    expect(source).toContain("{ onConflict: 'tournament_id' }");
  });

  /**
   * THE CANCEL HAS ITS OWN LANE (2026-10-26). It used to ride
   * launchDiscoveryTopUp and queue behind PAST_START_TOP_UP_CONCURRENCY horse
   * top-ups, which a restart re-asks all at once. A cancel is one RPC that
   * seats nobody; it never waits for a horse.
   */
  it('cancels through its own single-flight lane, not the horse top-up slots', () => {
    expect(branch).toContain('this.launchEmptyEventCancel(');
    expect(branch).not.toContain('this.launchDiscoveryTopUp(');
    const lane = source.slice(
      source.indexOf('private launchEmptyEventCancel('),
      source.indexOf('private pastStartTopUpClock: Map<string, PastStartTopUpClock>')
    );
    // One cancel at a time across the process (2026-11-07), which also covers this event.
    expect(lane).toContain('this.emptyEventCancelsInFlight.size > 0');
    expect(lane).toContain('this.tournamentTopUpsInFlight.has(tournamentId)');
    expect(lane).not.toContain('PAST_START_TOP_UP_CONCURRENCY');
    expect(lane).toContain('!isMaintenanceFrozen()');
    // The walk leaves an event alone while its cancel is in flight, as it does for a top-up.
    expect(source).toContain('this.emptyEventCancelsInFlight.has(tournament.id) ||');
  });

  it('cancels only through the database cancellation authority', () => {
    expect(branch).toContain("supabase.rpc('atomic_cancel_tournament'");
    expect(branch).not.toMatch(/\.update\(\{\s*status:/);
    expect(branch).toContain("'GameServer.empty_past_start_event_cancel_refused'");
  });

  it('uses the target-locked expiry for fixed SNG satellites and preserves their fill path while waiting', () => {
    const read = source.slice(source.indexOf('const registeringPage ='), start);
    for (const column of [
      'table_size',
      'satellite_seats',
      'satellite_target_id',
      'satellite_target',
    ]) {
      expect(read.slice(read.indexOf('.select('), read.indexOf(".eq('status'"))).toContain(column);
    }
    expect(branch).toMatch(
      /tournament\.format_contract === 'sng-v1' &&\s*isFixedSngSatellite\(tournament\)/
    );
    expect(branch).toMatch(
      /fixedSatellite\s*\? await supabase\.rpc\('fn_ca_expire_empty_fixed_sng_satellite'/
    );
    expect(branch).toContain('if (fixedSatellite && receipt?.fully_settled !== true) return;');
    expect(branch).toContain('if (!fixedSatellite) continue;');
  });

  it('keeps its retry clock on the past-start clock entry, pruned with the event', () => {
    expect(branch).toContain('const askedAt = emptyClock?.cancelAskedAt ?? 0;');
    expect(branch).toContain('cancelAskedAt: now,');
    expect(source).toContain('private pastStartTopUpClock: Map<string, PastStartTopUpClock>');
    expect(source).toContain('  cancelAskedAt?: number;');
  });

  it('sits inside the past-start top-up branch, ahead of the top-up', () => {
    const topUp = source.indexOf('if (needsPastStartTopUp) {');
    expect(topUp).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(topUp);
    expect(source.indexOf('this.tournamentRecurring.topUpWithHorses(', start)).toBeGreaterThan(
      start
    );
  });
});

/**
 * ONE EMPTY-EVENT CANCEL AT A TIME, AND A BUSY LANE IS "NOT NOW" (2026-11-07).
 * ~30 atomic_cancel_tournament calls at 20:05:12 UTC, all but one refused
 * CANCELLATION_GLOBAL_LANE_BUSY (55P03) by the exclusive terminal-settlement
 * lane, each reported as an error and parked for thirty minutes together.
 */
describe('the cancellation lane', () => {
  const source = readFileSync(join(process.cwd(), 'src/GameServer.ts'), 'utf8');
  const start = source.indexOf('AN EVENT NOBODY ENTERED IS CANCELLED (2026-10-15)');
  const branch = source.slice(start, source.indexOf('/* At most every 45 s', start));
  const lane = source.slice(
    source.indexOf('private launchEmptyEventCancel('),
    source.indexOf('private pastStartTopUpClock: Map<string, PastStartTopUpClock>')
  );

  it('recognises only the lane try-lock refusals, by code and exact name', () => {
    expect(
      isCancellationLaneBusy({ code: '55P03', message: 'CANCELLATION_GLOBAL_LANE_BUSY' })
    ).toBe(true);
    expect(isCancellationLaneBusy({ code: '55P03', message: 'CANCELLATION_BARRIER_BUSY' })).toBe(
      true
    );
    // A different refusal, or the right name under the wrong code, keeps its report.
    expect(
      isCancellationLaneBusy({ code: '55000', message: 'CANCELLATION_GLOBAL_LANE_BUSY' })
    ).toBe(false);
    expect(
      isCancellationLaneBusy({ code: '55000', message: 'CANCELLATION_EVENT_AUTHORITY_INCOMPLETE' })
    ).toBe(false);
    expect(isCancellationLaneBusy({ code: '55P03', message: 'lock not available' })).toBe(false);
    expect(isCancellationLaneBusy(null)).toBe(false);
    expect(isCancellationLaneBusy('CANCELLATION_GLOBAL_LANE_BUSY')).toBe(false);
  });

  it('asks a busy lane again after a minute, through the same thirty-minute gate', () => {
    expect(EMPTY_PAST_START_LANE_BUSY_RETRY_MS).toBe(60 * 1000);
    const now = Date.parse('2026-11-07T20:05:12Z');
    const askedAt = laneBusyCancelAskedAt(now);
    const gateOpen = (at: number) => at - askedAt >= EMPTY_PAST_START_CANCEL_RETRY_MS;
    expect(gateOpen(now)).toBe(false);
    expect(gateOpen(now + EMPTY_PAST_START_LANE_BUSY_RETRY_MS - 1)).toBe(false);
    expect(gateOpen(now + EMPTY_PAST_START_LANE_BUSY_RETRY_MS)).toBe(true);
  });

  it('starts no second cancel while one is in flight anywhere in the process', () => {
    expect(lane).toContain('this.emptyEventCancelsInFlight.size > 0');
    expect(lane).not.toContain('this.emptyEventCancelsInFlight.has(tournamentId)\n');
  });

  it('handles a busy lane before the error report, quietly, and keeps the report for everything else', () => {
    const busy = branch.indexOf('if (cancelError && isCancellationLaneBusy(cancelError)) {');
    const report = branch.indexOf("'GameServer.empty_past_start_event_cancel_refused'");
    expect(busy).toBeGreaterThan(-1);
    expect(report).toBeGreaterThan(busy);
    const busyArm = branch.slice(busy, branch.indexOf('if (cancelError) {', busy));
    expect(busyArm).toContain('cancelAskedAt: laneBusyCancelAskedAt(now),');
    expect(busyArm).not.toContain('reportError(');
    expect(busyArm).toContain('return;');
  });
});
