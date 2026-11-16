import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { isOwnedLiveSeatRead } from '../e2e/support/ownedSeatRefreshRead';

/* THE SEAT READ THE LOBBY E2E WAITS FOR IS THE ONE THE APP SENDS (2026-11-15).

   #10887 changed MultiTablePage's live-seat read (the visibility and online
   recovery read, requestSeatResync) from select('table_id') to
   select('table_id, joined_at'). Its tests were unit and law tests only, and
   the production lobby spec still waited for select=table_id. Both browser
   projects then ran into the 120s test timeout in Post-Deploy E2E run
   43668583397 (job 132673717947), after deploy instead of at PR time.

   This file pins the app's select string and proves the spec's predicate
   accepts the request postgrest-js builds from it. Change the columns and this
   fails here: update tests/e2e/support/ownedSeatRefreshRead.ts with them. */

const root = resolve(__dirname, '../..');
const page = readFileSync(resolve(root, 'src/pages/MultiTablePage.tsx'), 'utf8');
const spec = readFileSync(
  resolve(root, 'tests/e2e/production-mobile-lobby-chrome.spec.ts'),
  'utf8'
);
const LIVE_SEAT_READ =
  /\.from\('table_seats'\)\s*\.select\('([^']*)'\)\s*\.eq\('user_id', user\.id\)\s*\.is\('left_at', null\)/g;
const appSelects = [...page.matchAll(LIVE_SEAT_READ)].map((match) => match[1]);

const OWNER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
// Builds the request URL only; nothing is awaited, so nothing is sent.
const client = createClient('https://fixture.example.invalid', 'fixture-public-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const wire = (builder: unknown) => new URL(String((builder as { url: URL }).url));
const liveSeatRead = (select: string, owner = OWNER, table = 'table_seats') =>
  wire(client.from(table).select(select).eq('user_id', owner).is('left_at', null));

describe('the live-seat read the production lobby spec waits for', () => {
  it('MultiTablePage sends exactly one live-seat read, selecting table_id then joined_at', () => {
    expect(appSelects).toEqual(['table_id, joined_at']);
  });

  it('the spec predicate accepts the request postgrest-js builds from that select', () => {
    const url = liveSeatRead(appSelects[0]);
    expect(url.pathname).toBe('/rest/v1/table_seats');
    expect(url.searchParams.get('select')).toBe('table_id,joined_at');
    expect(isOwnedLiveSeatRead('GET', url, OWNER)).toBe(true);
  });

  it('the predicate still refuses a write, another account, another table and a historical read', () => {
    const url = liveSeatRead(appSelects[0]);
    expect(isOwnedLiveSeatRead('POST', url, OWNER)).toBe(false);
    expect(isOwnedLiveSeatRead('GET', url, OTHER)).toBe(false);
    expect(
      isOwnedLiveSeatRead('GET', liveSeatRead(appSelects[0], OWNER, 'tournament_players'), OWNER)
    ).toBe(false);
    const historical = wire(client.from('table_seats').select(appSelects[0]).eq('user_id', OWNER));
    expect(isOwnedLiveSeatRead('GET', historical, OWNER)).toBe(false);
  });

  it('the predicate refuses the pre-#10887 shape and a select that does not lead with table_id', () => {
    expect(isOwnedLiveSeatRead('GET', liveSeatRead('table_id'), OWNER)).toBe(false);
    expect(isOwnedLiveSeatRead('GET', liveSeatRead('joined_at, table_id'), OWNER)).toBe(false);
  });

  it('the production lobby spec waits through this predicate, not a frozen select', () => {
    expect(spec).toContain("import { isOwnedLiveSeatRead } from './support/ownedSeatRefreshRead';");
    expect(spec).toMatch(/page\.waitForResponse\(\(response\) =>\s*isOwnedLiveSeatRead\(/);
    expect(spec).not.toMatch(/searchParams\.get\('select'\) === 'table_id'/);
  });
});
