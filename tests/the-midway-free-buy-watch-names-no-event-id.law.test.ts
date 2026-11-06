import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rule 2026-11-05: no tournament-ID exceptions anywhere in code. The
// Midway Free Buy rotation watch merged in #9550 exempted three events by id
// and was never installed; 20261105233756 replaces it, reading each event's
// expected format from its own schedule, and the #9550 file is marked
// SUPERSEDED so the installer never runs it.
const DIR = 'supabase/migrations';
const WATCH = `${DIR}/20261105233756_the_midway_free_buy_watch_reads_the_schedule_not_event_ids.sql`;
const OLD_WATCH = `${DIR}/20261105183114_midway_free_buy_rotation_and_promo_runway_watch.sql`;

const uuids = (s: string) =>
  (s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []).filter(
    (u) => u !== 'fade0000-0000-0000-0000-000000000001' // the Midway Union itself
  );

describe('the Midway Free Buy watch names no event id', () => {
  it('reads the expected format from the schedule, never from a list of event ids', () => {
    const code = readFileSync(WATCH, 'utf8').replace(/--[^\n]*/g, ' ');
    expect(uuids(code)).toEqual([]);
    expect(code).toContain('fn_ca_midway_free_buy_slot_format');
    expect(code).toContain('fn_sp_midway_free_buy_watch');
  });

  it('retires the id-exempting watch file instead of installing it', () => {
    expect(readFileSync(OLD_WATCH, 'utf8').split('\n')[0]).toMatch(/^-- SUPERSEDED BY 20261105233756\b/);
    expect(readdirSync(DIR).some((f) => f.startsWith('20261105233756_'))).toBe(true);
  });
});
