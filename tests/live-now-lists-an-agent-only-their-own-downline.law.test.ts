/**
 * LAW - LIVE NOW LISTS AN AGENT ONLY THEIR OWN DOWNLINE
 *
 * Dan, 2026-11-21, Player Management: "live now" should only show the agents
 * their own downlines, not every user that's active in the club.
 *
 * The rule lives in the server reader `ca_club_live_seats`, the one door the
 * Live Now strip and the row table chips read: a viewer whose club cashier
 * scope is 'downline' (super agent, agent, sub agent) is listed only seats of
 * players in their own downline. Owner, co-owner, admin, platform admin,
 * union overseer and the service role keep the whole club. A later
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
  it('limits a downline-scope viewer to their own downline at the reader', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.ca_club_live_seats(p_club_id uuid)');
    expect(sql).toContain(
      "coalesce(public.fn_club_cashier_scope(p_club_id, v_actor), 'none') = 'downline'"
    );
    expect(sql).toContain(`AND (NOT v_downline_only OR ${RULE})`);
  });

  it('keeps the whole club for platform admin, union overseer and the service role', () => {
    expect(sql).toMatch(/v_downline_only := NOT v_platform_admin\s+AND NOT v_union_staff/);
    expect(sql).toContain(
      "v_service boolean := coalesce(auth.role(), 'service_role') = 'service_role'"
    );
    expect(sql).toMatch(/IF NOT v_service THEN[\s\S]*v_downline_only :=[\s\S]*END IF;/);
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

  it('the members page labels the strip as the downline for an agent', () => {
    const page = readFileSync(join(ROOT, 'src', 'pages', 'ClubMembersPage.tsx'), 'utf8');
    expect(page).toContain("scope={isAgent ? 'downline' : 'club'}");
  });
});
