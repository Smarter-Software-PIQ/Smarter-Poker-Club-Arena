/**
 * LAW: A HORSE CLAIM NEVER WAITS ON A DASHBOARD REVISION (2026-11-23).
 *
 * At 06:40:02 UTC on 2026-11-23 the daily prune (fn_ca_diamond_prune_history)
 * and the horse claim tick (fn_ca_horse_claim_due) deadlocked on
 * daily_challenge_dashboard_revisions, the one cursor row per player that
 * bump_daily_challenge_dashboard_revision upserts (line 22) whenever a
 * player's missions or diamonds change. Both crons bump many players' rows in
 * one transaction, in different orders: the prune's DELETE (line 29) in the
 * order its rows come off the table, the claim run in challenge-row order,
 * each claim bumping its horse's row by waiting. The claim already takes a
 * horse's other locks first without waiting (20261015032612); migration
 * 20261123071151 takes the revision row there too, FOR NO KEY UPDATE SKIP
 * LOCKED, so the claim can never wait on one and a busy horse is simply owed
 * to the next minute. Rewards and revisions are unchanged. Proved natively by
 * scripts/dev/prove-a-horse-claim-never-waits-on-a-dashboard-revision.py.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261123071151_a_horse_claim_never_waits_on_a_dashboard_revision.sql';
const SIG = 'public.fn_ca_horse_claim_due(integer)';
/** Production's fn_ca_horse_claim_due on 2026-11-23 (the 20261030003124 postimage). */
const LIVE = 'cc2313bee55c2149786824aae8d3b87e';
/** The same text after this migration's one edit. */
const POST = '88cfc5b8cbde2247e42b41cdbf457d09';

const read = (...p: string[]) => readFileSync(resolve(ROOT, ...p), 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const between = (s: string, tag: string) => {
  const parts = s.split(`$${tag}$`);
  expect(parts.length, `exactly one $${tag}$ block`).toBe(3);
  return parts[1];
};
const count = (s: string, needle: string) => s.split(needle).length - 1;

const sql = read('supabase', 'migrations', MIGRATION);

/** Production's horse claim, rebuilt from its 2026-10-15 capture and the two edits since. */
function liveClaim(): string {
  let text = read(
    'scripts',
    'ci',
    'fixtures',
    'horse-claim-lock-order',
    'fn_ca_horse_claim_due.live-20261015.sql'
  );
  for (const [file, o, n] of [
    ['20261015032612_a_horse_claim_never_waits_on_a_player_lock.sql', 'o1', 'n1'],
    [
      '20261030003124_tournament_rebuy_player_contention_releases_the_event_lane.sql',
      'old0',
      'new0',
    ],
  ] as const) {
    const m = read('supabase', 'migrations', file);
    const old = between(m, o);
    expect(count(text, old)).toBe(1);
    text = text.replace(old, () => between(m, n));
  }
  return text;
}

const live = liveClaim();
const oldText = between(sql, 'old');
const newText = between(sql, 'new');
const post = live.replace(oldText, () => newText);
const body = code(post);
const at = (needle: string) => {
  const i = body.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};

const REVISION_LOCK =
  /PERFORM 1 FROM public\.daily_challenge_dashboard_revisions v\s+WHERE v\.user_id = r\.user_id FOR NO KEY UPDATE SKIP LOCKED;\s+CONTINUE WHEN NOT FOUND AND EXISTS \(\s+SELECT 1 FROM public\.daily_challenge_dashboard_revisions v WHERE v\.user_id = r\.user_id\);/;
const REVISION_LINE =
  'FROM public.daily_challenge_dashboard_revisions v\n     WHERE v.user_id = r.user_id FOR NO KEY UPDATE SKIP LOCKED;';

describe('a horse claim never waits on a dashboard revision', () => {
  it("edits production's horse claim, once, into the pinned postimage", () => {
    expect(md5(live)).toBe(LIVE);
    expect(count(live, oldText)).toBe(1);
    expect(md5(post)).toBe(POST);
    expect(newText.startsWith(oldText)).toBe(true);
    expect(sql).toContain(`-- @replaces-md5: ${SIG}=${LIVE}`);
    expect(sql).toContain(`IF md5(before_def) <> '${LIVE}' THEN`);
    expect(sql.match(new RegExp(`'${POST}'`, 'g'))).toHaveLength(2);
    expect(sql).toContain('anchor was expected exactly once');
    expect(sql).toContain('postimage, owner, grants or settings differ');
    expect(sql.match(/EXECUTE replace\(before_def, old_text, new_text\);/g)).toHaveLength(1);
  });

  it('takes the revision row after the advisory lock and the profile, before the claim, never waiting', () => {
    const advisory = at(
      "CONTINUE WHEN NOT pg_try_advisory_xact_lock(\n      hashtextextended('daily-missions-user:'"
    );
    const profile = at(
      'PERFORM 1 FROM public.profiles p WHERE p.id = r.user_id FOR NO KEY UPDATE SKIP LOCKED;'
    );
    const revision = body.search(REVISION_LOCK);
    const claim = at(
      'PERFORM public.claim_daily_challenge_serialized_body(r.user_id, r.id, NULL);'
    );
    expect(revision, 'the revision pre-lock').toBeGreaterThan(-1);
    expect(advisory).toBeLessThan(profile);
    expect(profile).toBeLessThan(revision);
    expect(revision).toBeLessThan(claim);
    // The run takes the cursor table nowhere else, and never with a lock that waits.
    expect(count(body, 'daily_challenge_dashboard_revisions')).toBe(2);
    for (const m of body.matchAll(
      /\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|SHARE|KEY\s+SHARE)\b[^;]*;/gi
    ))
      expect(m[0], 'every row lock in the horse claim run is tried').toMatch(
        /SKIP\s+LOCKED|NOWAIT/i
      );
    expect(body).not.toMatch(/\bpg_advisory_xact_lock\(/);
  });

  it('takes the row in the mode the bump takes, so nothing inside the claim upgrades and waits', () => {
    const fixture = JSON.parse(
      read('scripts', 'ci', 'fixtures', 'daily-mission-revision-lock-order', 'live-20261123.json')
    ).functions as Record<string, { md5: string; definition: string }>;
    const bump = fixture['public.bump_daily_challenge_dashboard_revision()'];
    expect(md5(bump.definition)).toBe(bump.md5);
    expect(bump.md5).toBe('6de77f0b41cdd39368e06b053563d015');
    // ON CONFLICT DO UPDATE of non-key columns only: PostgreSQL locks the row FOR NO KEY UPDATE.
    expect(code(bump.definition)).toMatch(
      /INSERT INTO public\.daily_challenge_dashboard_revisions \(user_id, revision, updated_at\)\s+VALUES \(v_user_id, 1, clock_timestamp\(\)\)\s+ON CONFLICT \(user_id\) DO UPDATE\s+SET revision = public\.daily_challenge_dashboard_revisions\.revision \+ 1,\s+updated_at = EXCLUDED\.updated_at\s+RETURNING revision INTO v_revision;/
    );
    // The claim body bumps only its own horse: its claimed UPDATE and its diamonds UPDATE.
    const claimBody = code(
      fixture['public.claim_daily_challenge_serialized_body(uuid,uuid,numeric)'].definition
    );
    expect(claimBody).toMatch(
      /UPDATE public\.user_daily_challenges\s+SET claimed = true, claimed_at = now\(\)\s+WHERE id = p_challenge_row_id;/
    );
    expect(claimBody).toMatch(
      /UPDATE public\.profiles\s+SET diamonds = COALESCE\(diamonds, 0\) \+ v_row\.diamond_reward_snapshot,[\s\S]*?WHERE id = v_uid/
    );
    // The prune, the other side of the 2026-11-23 cycle, is unchanged by this file.
    const prune = fixture['public.fn_ca_diamond_prune_history(integer,integer,integer)'];
    expect(md5(prune.definition)).toBe(prune.md5);
    expect(code(sql)).not.toMatch(
      /fn_ca_diamond_prune_history|bump_daily_challenge_dashboard_revision\(\)/
    );
  });

  it('changes nothing a claim pays or bumps: the block only takes a lock', () => {
    expect(post.replace(newText, () => oldText)).toBe(live);
    const added = code(newText.slice(oldText.length));
    expect(added).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b\s+(INTO\s+|FROM\s+)?public\./);
    expect(added).not.toMatch(
      /claim_daily_challenge_serialized_body|ca_horse_claim_deferrals|v_claimed|v_capped|v_failed/
    );
    // A busy horse is skipped exactly like a busy profile: no deferral, no count.
    expect(added).toMatch(/CONTINUE WHEN NOT FOUND AND EXISTS/);
  });

  it('is one bounded transaction; the horse claim is exempt from a live probe for a stated reason', async () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    expect(sql).toMatch(/^-- @probe-exempt: public\.fn_ca_horse_claim_due \S.{40,}$/m);
    expect(sql).toMatch(
      /^-- @live-proof: \(SELECT .*daily_challenge_dashboard_revisions v.*claim_daily_challenge_serialized_body.*\)$/m
    );
    const probes = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    expect(probes.missingProbes(sql)).toEqual([]);
    expect(code(sql)).not.toMatch(/cron\.(un)?schedule/);
  });

  it('no later migration takes the revision row back inside the claim by waiting', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      if (!source.includes('fn_ca_horse_claim_due')) continue;
      let rest = source;
      for (const m of source.matchAll(
        /CREATE OR REPLACE FUNCTION public\.fn_ca_horse_claim_due\(([\s\S]*?)\$function\$([\s\S]*?)\$function\$/g
      )) {
        rest = rest.replace(m[0], ' ');
        const b = code(m[2]);
        expect(
          b.search(REVISION_LOCK),
          `${file} redefines the horse claim without its revision pre-lock`
        ).toBeGreaterThan(-1);
        expect(b.search(REVISION_LOCK), `${file}: revision row before the claim`).toBeLessThan(
          b.indexOf('PERFORM public.claim_daily_challenge_serialized_body(')
        );
      }
      expect(
        count(rest, REVISION_LINE) % 2,
        `${file} removes the horse claim's revision pre-lock in an anchored edit`
      ).toBe(0);
    }
  });

  it('the native proof reproduces the 06:40 deadlock before and none after, with identical outcomes', () => {
    const proof = read(
      'scripts',
      'dev',
      'prove-a-horse-claim-never-waits-on-a-dashboard-revision.py'
    );
    expect(proof).toContain(MIGRATION);
    expect(proof).toContain(`LIVE_MD5 = '${LIVE}'`);
    expect(proof).toContain(`POST_MD5 = '${POST}'`);
    for (const c of [
      "check('BEFORE case 1: the prune and the claim run deadlock, and the prune is cancelled (40P01)'",
      "check('AFTER case 1: no deadlock; the prune commits every abandoned row'",
      "check('AFTER case 1: the next run pays the horse it left, once'",
      "check('AFTER case 1: every reward paid once and every change bumped once, as when done one at a time'",
      "check('CASE 2: the same work one at a time: identical answers, rewards, journal, prunes and revisions'",
    ])
      expect(proof).toContain(c);
  });
});
