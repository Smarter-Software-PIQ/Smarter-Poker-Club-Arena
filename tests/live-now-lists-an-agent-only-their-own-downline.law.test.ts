/**
 * LAW - LIVE NOW LISTS AN AGENT ONLY THEIR OWN DOWNLINE
 *
 * Dan, 2026-11-21, Player Management: "live now" should only show the agents
 * their own downlines, not every user that's active in the club.
 *
 * And: all online users in KINGS CLUB are shown to KingFish (its owner) but
 * to no one else; everyone else sees only their own downline.
 *
 * The rule lives in the server reader `ca_club_live_seats`, the one door the
 * Live Now strip and the row table chips read: only the club's owner of
 * record (clubs.owner_id) and the service role are listed the whole club;
 * every other viewer (co-owner, admin, agent, player, platform admin, union
 * overseer) is listed only seats of players in their own downline. A later
 * redefinition of the reader must keep the rule.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const NAME = '20261121153607_live_now_lists_an_agent_only_their_own_downline.sql';
const VERSION = NAME.slice(0, 14);
const sql = readFileSync(join(MIGRATIONS, NAME), 'utf8');
const RULE = 'public.fn_club_is_in_downline(p_club_id, v_actor, l.uid)';

describe('Live Now lists an agent only their own downline', () => {
  it('lists the whole club only to its owner of record and the service role', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.ca_club_live_seats(p_club_id uuid)');
    expect(sql).toMatch(/IF v_service THEN\s+v_whole_club := true;/);
    expect(sql).toContain(
      'SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_actor'
    );
    expect(sql).toContain(`AND (v_whole_club OR ${RULE})`);
  });

  it('gives no wider door to a co-owner, admin, platform admin or union overseer', () => {
    const body = sql.slice(sql.indexOf('AS $function$'), sql.indexOf('$function$;'));
    expect(body).not.toMatch(/is_admin|fn_is_union_overseer|fn_club_cashier_scope|co_owner/);
    expect(body).not.toMatch(/v_whole_club\s*:=\s*true\s*;[\s\S]*ELSIF/);
  });

  it('keeps the certification-identity rule and the grants', () => {
    expect(sql).toContain(
      'AND (v_sees_certification OR NOT public.ca_is_reserved_certification_identity(l.uid))'
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.ca_club_live_seats(uuid) FROM PUBLIC, anon;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.ca_club_live_seats(uuid) TO authenticated, service_role;'
    );
  });

  it('replaces only the recorded preimage, in one transaction, with no row writes', () => {
    expect(sql).toContain("IF current_md5 <> 'c00345d963470a92189fe72adfb46f7b' THEN");
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\s+public\./i);
    expect(sql).toContain('@live-proof:');
  });

  it('a later redefinition of the reader keeps the rule', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > VERSION)
      .sort();
    for (const file of later) {
      const text = readFileSync(join(MIGRATIONS, file), 'utf8');
      if (!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.ca_club_live_seats\s*\(/i.test(text))
        continue;
      expect(
        text.includes(RULE),
        `${file} redefines ca_club_live_seats without the downline rule`
      ).toBe(true);
    }
  });

  it('the members page labels the strip as the downline for everyone but the owner', () => {
    const page = readFileSync(join(ROOT, 'src', 'pages', 'ClubMembersPage.tsx'), 'utf8');
    expect(page).toContain("scope={summary.viewer_role === 'owner' ? 'club' : 'downline'}");
  });
});
