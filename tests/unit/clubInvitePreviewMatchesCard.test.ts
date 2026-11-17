/**
 * The invite link must print the club card's figures (Dan 2026-11-17).
 *
 * "the links sent must match the kings club card. (that number is the one we
 * want sent)". The card adds the owner's labelled display addition to the live
 * member and active counts; the invite preview once read clubs.member_count and
 * get_club_players_playing instead and sent 155 / 614 against the card's
 * 1,655 / 236. These checks fail the build if either side drifts again.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MIG_DIR = resolve(ROOT, 'supabase/migrations');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** Body of the latest migration that (re)defines a function. */
function latestDefinition(fn: string): string {
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`, 'i');
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(resolve(MIG_DIR, files[i]), 'utf8');
    const start = sql.search(re);
    if (start < 0) continue;
    const end = sql.indexOf('END $$;', start);
    return sql.slice(start, end);
  }
  throw new Error(`no migration defines ${fn}`);
}

describe('Club invite preview matches the club card', () => {
  it('the resolver reads the card figures, not the raw member column or seat count', () => {
    const body = latestDefinition('fn_club_invite_resolve');
    expect(body).toMatch(/public\.fn_club_card_figures\(v_club\.id\)/);
    expect(body).not.toMatch(/get_club_players_playing/);
    expect(body).toMatch(/'member_count',\s*COALESCE\(v_members,/);
    expect(body).toMatch(/'players_playing',\s*v_playing/);
  });

  it('the card figures use the same sources and the same addition as the card', () => {
    const body = latestDefinition('fn_club_card_figures');
    expect(body).toMatch(/fn_batch_club_realtime_member_counts/);
    expect(body).toMatch(/fn_batch_club_realtime_active_counts/);
    expect(body).toMatch(/fn_club_display_labeled_additions/);
    expect(body).toMatch(/LEAST\(v_active, v_members\)/);
  });

  it('the card still prints live count plus the labelled addition from those same RPCs', () => {
    const home = read('src/pages/HomePage.tsx');
    expect(home).toMatch(/fn_batch_club_realtime_member_counts/);
    expect(home).toMatch(/fn_batch_club_realtime_active_counts/);
    expect(home).toMatch(/fn_club_display_labeled_additions/);
    expect(home).toMatch(/Math\.min\(activePlayers, memberCount\)/);
    const panel = read('src/components/club/ClubCardPanel.tsx');
    expect(panel).toMatch(/totalMembers \+ addMembers/);
    expect(panel).toMatch(/activePlayers \+ addActive/);
  });
});
