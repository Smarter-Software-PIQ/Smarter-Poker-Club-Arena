import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A PROFILE POST COUNT ASKS THE POST POLICY, SET-WISE (2026-11-26).
 *
 * The public profile's "Posts" number was a HEAD count of social_posts through
 * RLS. The restrictive policy video_posts_public_select_guard runs three
 * non-inlinable SECURITY DEFINER helpers per row, so for an author with 5,636
 * posts the anon count took 7.9 s against anon's 3 s statement_timeout and
 * every signed-out visitor got HTTP 500. fn_social_profile_post_count answers
 * the same question set-wise in ~0.4 s.
 *
 * The danger in such a function is that it drifts from the policy and shows a
 * number the policy would not. This law pins it four ways:
 *   1. the fingerprint it refuses on is the md5 of the rule it was proven
 *      against (tests/fixtures/social-profile-post-count/visibility-rule.json,
 *      read from production);
 *   2. the two unfolded helpers are the fixture's helper bodies, verbatim,
 *      with only their parameters renamed to the row's columns;
 *   3. the legacy short-circuit is a conjunct of the legacy helper's own body;
 *   4. any later migration that redefines a SELECT policy on social_posts or a
 *      pinned helper must restate this function in the same file.
 */
const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const FILE = '20261126232411_a_profile_post_count_asks_the_post_policy_set_wise.sql';
const SQL = readFileSync(join(MIGRATIONS, FILE), 'utf8');
const RULE = JSON.parse(
  readFileSync(join(ROOT, 'tests/fixtures/social-profile-post-count/visibility-rule.json'), 'utf8')
) as {
  policies: { polname: string; polcmd: string; permissive: string; roles: string; expr: string }[];
  helpers: { proname: string; args: string; prosrc: string }[];
  rls: string;
};

const code = (s: string) => s.replace(/--[^\n]*/g, '');
const norm = (s: string) =>
  code(s)
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
const helper = (name: string) => {
  const h = RULE.helpers.find((x) => x.proname === name);
  expect(h, `${name} is in the fixture`).toBeTruthy();
  return h!;
};
const countBody = () => {
  const start = SQL.indexOf('CREATE FUNCTION public.fn_social_profile_post_count(p_author_id uuid)');
  expect(start).toBeGreaterThan(-1);
  const end = SQL.indexOf('$function$;', start);
  expect(end).toBeGreaterThan(start);
  return SQL.slice(start, end);
};
const rename = (s: string, pairs: [string | RegExp, string][]) =>
  pairs.reduce((acc, [from, to]) => acc.split(from as string).join(to), s);

describe('a profile post count asks the post policy set-wise', () => {
  it('pins the md5 of the rule it was proven against, everywhere it checks it', () => {
    const canonical =
      RULE.policies.map((p) => [p.polname, p.polcmd, p.permissive, p.roles, p.expr].join('|')).join('\n') +
      '\n' +
      RULE.helpers.map((h) => `${h.proname}|${h.args}|${h.prosrc}`).join('\n') +
      '\n' +
      RULE.rls;
    const md5 = createHash('md5').update(canonical).digest('hex');
    const pinned = [...SQL.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]);
    expect(new Set(pinned)).toEqual(new Set([md5]));
    // pre-flight, the function body, and the live proof
    expect(pinned.length).toBe(3);
    // The fingerprint covers what the policy evaluates: both SELECT policies,
    // the helpers the body unfolds, and RLS itself.
    expect(RULE.policies.map((p) => p.polname)).toEqual(['Audience-aware view', 'video_posts_public_select_guard']);
    expect(RULE.helpers.map((h) => h.proname)).toEqual([
      'fn_is_public_video_playback_eligible',
      'fn_is_video_library_lineage_eligible',
      'legacy_transition_eligible',
    ]);
    expect(RULE.rls).toBe('truefalse');
  });

  it('refuses before it counts when the rule has changed', () => {
    const body = code(countBody());
    const check = body.indexOf("public.fn_social_posts_visibility_fingerprint() IS DISTINCT FROM '");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf('WITH aud AS'));
    expect(body).toMatch(/USING ERRCODE = '55000'/);
    const fp = SQL.slice(SQL.indexOf('CREATE FUNCTION public.fn_social_posts_visibility_fingerprint()'));
    for (const piece of [
      "p.polcmd IN ('r', '*')",
      "to_regprocedure('public.legacy_transition_eligible(public.social_posts)')",
      "to_regprocedure('public.fn_is_public_video_playback_eligible(text,text,text,uuid,text,text)')",
      "to_regprocedure('public.fn_is_video_library_lineage_eligible(uuid,text,text,text,text)')",
      'c.relrowsecurity::text || c.relforcerowsecurity::text',
    ]) {
      expect(fp).toContain(piece);
    }
  });

  it('applies the policy\'s own cheap terms and asks fn_can_view_post once per audience', () => {
    const body = code(countBody());
    const guard = RULE.policies[1].expr;
    expect(guard).toContain('(COALESCE(is_deleted, false) = false)');
    expect(guard).toContain("((author_id = ( SELECT auth.uid() AS uid)) OR (visibility IS DISTINCT FROM 'private'::text))");
    expect(body).toContain('AND COALESCE(sp.is_deleted, false) = false');
    expect(body).toContain("AND ((sp.author_id = v_uid) OR (sp.visibility IS DISTINCT FROM 'private'))");
    expect(body).toContain('v_uid uuid := auth.uid();');
    // both policies' fn_can_view_post, only inside the per-audience CTE
    expect(RULE.policies[0].expr).toBe('fn_can_view_post(author_id, audience_mode, audience_list)');
    expect(guard).toContain(
      "fn_can_view_post(author_id, COALESCE(audience_mode, NULLIF(visibility, 'public'::text), 'public'::text), audience_list)"
    );
    const aud = body.slice(body.indexOf('WITH aud AS'), body.indexOf('), b AS MATERIALIZED'));
    expect(aud).toContain('SELECT DISTINCT sp.audience_mode, sp.visibility, sp.audience_list');
    expect(aud).toContain('public.fn_can_view_post(p_author_id, a.audience_mode, a.audience_list) IS TRUE');
    expect(norm(aud)).toContain(
      "public.fn_can_view_post(p_author_id, COALESCE(a.audience_mode, NULLIF(a.visibility, 'public'), 'public'), a.audience_list) IS TRUE"
    );
    expect(body.match(/fn_can_view_post\(/g)).toHaveLength(2);
  });

  it('unfolds fn_is_public_video_playback_eligible verbatim, with the arguments the policy passes', () => {
    const guard = RULE.policies[1].expr;
    expect(guard).toContain(
      "fn_is_public_video_playback_eligible(playback_type, rights_status, NULLIF((media_urls ->> 0), ''::text), author_id, youtube_video_id, canonical_asset_key)"
    );
    const src = helper('fn_is_public_video_playback_eligible').prosrc;
    const expected = rename(src.slice(src.indexOf('CASE'), src.lastIndexOf('END') + 3), [
      ['public.fn_extract_youtube_video_id(p_playback_url)', 'r.extracted_id'],
      ['p_playback_type', 'r.playback_type'],
      ['p_rights_status', 'r.rights_status'],
      ['p_playback_url', 'r.playback_url'],
      ['p_author_id', 'r.author_id'],
      ['p_youtube_video_id', 'r.youtube_video_id'],
      ['p_canonical_asset_key', 'r.canonical_asset_key'],
    ]);
    const body = countBody();
    const at = body.indexOf('OR (CASE');
    const unfolded = body.slice(at + 4, body.indexOf('END) IS TRUE)', at) + 3);
    expect(norm(unfolded)).toBe(norm(expected));
    expect(body).toContain("NULLIF(sp.media_urls ->> 0, '') AS playback_url");
    expect(norm(body)).toContain(
      'ELSE public.fn_extract_youtube_video_id(b.playback_url) END AS extracted_id'
    );
  });

  it('unfolds fn_is_video_library_lineage_eligible verbatim, joined by the asset key the policy passes', () => {
    const guard = RULE.policies[1].expr;
    expect(guard).toContain(
      "fn_is_video_library_lineage_eligible(source_asset_id, youtube_video_id, canonical_asset_key, publication_key, NULLIF((media_urls ->> 0), ''::text))"
    );
    const src = helper('fn_is_video_library_lineage_eligible').prosrc;
    expect(src).toContain('WHERE v.id = p_asset_id');
    const conds = src.slice(src.indexOf('WHERE v.id = p_asset_id') + 'WHERE v.id = p_asset_id'.length, src.lastIndexOf(')'));
    const expected = rename(conds, [
      ['public.fn_extract_youtube_video_id(p_playback_url)', 'r.extracted_id'],
      ['p_youtube_video_id', 'r.youtube_video_id'],
      ['p_canonical_asset_key', 'r.canonical_asset_key'],
      ['p_publication_key', 'r.publication_key'],
      ['v.youtube_video_id', 'r.asset_youtube_video_id'],
      ['v.id', 'r.asset_id'],
    ]);
    const body = countBody();
    expect(body).toContain('LEFT JOIN public.video_library_videos v ON v.id = sp.source_asset_id');
    expect(body).toContain('v.id AS asset_id, v.youtube_video_id AS asset_youtube_video_id');
    const at = body.indexOf('OR (r.asset_id IS NOT NULL');
    expect(at).toBeGreaterThan(-1);
    const unfolded = body.slice(at + 'OR (r.asset_id IS NOT NULL'.length, body.indexOf(') IS TRUE);', at));
    expect(norm(unfolded)).toBe(norm(expected));
  });

  it('asks legacy_transition_eligible only where its own required transition row exists', () => {
    const src = norm(helper('legacy_transition_eligible').prosrc);
    // A conjunct of the helper: without such a row the helper is false.
    expect(src).toContain('AND EXISTS (SELECT 1 FROM public.video_reels_legacy_transition_rows transition_row');
    for (const term of [
      "transition_row.surface = 'social_posts'",
      'transition_row.row_id = (p_post).id',
      'transition_row.expires_at > now()',
    ]) {
      expect(src).toContain(term);
    }
    const body = norm(countBody());
    expect(body).toContain(
      "CASE WHEN EXISTS (SELECT 1 FROM public.video_reels_legacy_transition_rows t WHERE t.surface = 'social_posts' AND t.row_id = sp.id AND t.expires_at > now()) THEN public.legacy_transition_eligible(sp) IS TRUE ELSE false END AS lte"
    );
    // and both policy terms that name it read that one column
    expect(body).toContain('WHERE (r.content_type IS DISTINCT FROM \'video\' OR r.is_self OR r.lte');
    expect(body).toContain("AND (r.lte OR (r.origin_type <> 'video_library') IS TRUE");
  });

  it('is a read-only definer any browser may call, behind a catalog-only fingerprint nobody else may', () => {
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(SQL).toContain("SET LOCAL lock_timeout = '1s';");
    const body = countBody();
    expect(body).toMatch(/STABLE SECURITY DEFINER\n SET search_path TO 'public', 'extensions', 'pg_temp'/);
    expect(code(body)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.fn_social_profile_post_count(uuid) FROM PUBLIC;');
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_social_profile_post_count(uuid) TO anon, authenticated, service_role;'
    );
    const fp = SQL.slice(
      SQL.indexOf('CREATE FUNCTION public.fn_social_posts_visibility_fingerprint()'),
      SQL.indexOf('-- PRE-FLIGHT')
    );
    expect(fp).not.toContain('SECURITY DEFINER');
    expect(fp).toContain(
      'REVOKE ALL ON FUNCTION public.fn_social_posts_visibility_fingerprint() FROM PUBLIC, anon, authenticated;'
    );
    const manifest = JSON.parse(readFileSync(join(ROOT, 'docs/security/anon-executable-definers.json'), 'utf8'));
    expect(manifest.allowed.map((e: { fn: string }) => e.fn)).toContain('fn_social_profile_post_count(p_author_id uuid)');
    expect(SQL).toContain("'fn_social_profile_post_count',");
  });

  it('proves itself against the RLS count before it commits', () => {
    const probe = SQL.slice(SQL.indexOf('-- @probe-for: public.fn_social_profile_post_count'));
    expect(probe).toContain('SET LOCAL ROLE anon;');
    expect(probe).toContain('SET LOCAL ROLE authenticated;');
    expect(probe.match(/SELECT count\(\*\) INTO v_rls FROM public\.social_posts WHERE author_id = v_author;/g)).toHaveLength(2);
    expect(probe).toContain("RAISE EXCEPTION 'probe-unwind';");
  });

  it('is restated by any later migration that changes the rule it unfolds', () => {
    const touchesRule =
      /(FUNCTION\s+(public\.)?(legacy_transition_eligible|fn_is_public_video_playback_eligible|fn_is_video_library_lineage_eligible)\s*\()|(POLICY\s+("[^"]+"|\w+)\s+ON\s+(public\.)?social_posts\b)|(TABLE\s+(ONLY\s+)?(public\.)?social_posts\s+(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY)/i;
    const later = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{14}_.+\.sql$/.test(f) && f > FILE)
      .filter((f) => touchesRule.test(code(readFileSync(join(MIGRATIONS, f), 'utf8'))));
    const unrestated = later.filter(
      (f) => !/FUNCTION\s+public\.fn_social_profile_post_count\s*\(/.test(readFileSync(join(MIGRATIONS, f), 'utf8'))
    );
    expect(unrestated, 'restate fn_social_profile_post_count (and its fingerprint) in the same migration').toEqual([]);
  });
});
