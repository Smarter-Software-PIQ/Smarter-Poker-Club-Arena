"""AN INCIDENT IS CLAIMED BEFORE IT IS WORKED (2026-11-18).

Loaded by scripts/ci/test-reliability-controller-stage-b.py after every
reliability object exists on its throwaway PostgreSQL 17 cluster. Installs the
claim migration (twice, it must be repeatable) and proves, against the real
functions:

  - the first lane claims; a second lane is refused and told who holds it
  - the holder renews without losing its branch or its original claim time
  - an expired claim is taken over, with none of the old lane's details
  - only the holder can release
  - the escalation text names a live owner, and tells an unclaimed reader how
    to claim
  - two concurrent claims on one incident: exactly one wins
  - bad input is refused and neither browser role can call either function

Incident d2d79c4f reached two lanes that could not see each other; this is the
guarantee that cannot happen silently again.
"""
import json
import subprocess
import time


def install(ROOT, psql, suffix):
    found = sorted((ROOT / 'supabase/migrations').glob('*_' + suffix + '.sql'))
    assert len(found) == 1, found
    for _ in range(2):
        r = psql(['-f', str(found[0])])
        assert r.returncode == 0, r.stderr


def qualify(ROOT, sql, psql, ok, psql_cmd):
    install(ROOT, psql, 'an_incident_is_claimed_before_it_is_worked')
    iid = sql("SELECT id FROM smarter_private.reliability_incidents ORDER BY created_at, id LIMIT 1")
    assert iid, 'the harness holds at least one incident by now'
    contract(sql, psql, ok, psql_cmd, iid, '')
    # 20261121: a shipped or stale claim stops blocking. The original contract
    # must still hold on top of it, then the new rules are proven.
    install(ROOT, psql, 'a_shipped_or_stale_incident_claim_stops_blocking')
    contract(sql, psql, ok, psql_cmd, iid, '[with lifetime and shipped rules] ')
    stale_and_shipped(sql, psql, ok, iid)
    # 20261121183712: class=release handoffs name the sanctioned triage workflow.
    install(ROOT, psql, 'release_incident_handoff_names_sanctioned_triage_workflow')
    release_handoff_enrichment(sql, psql, ok, iid)


def contract(sql, psql, ok, psql_cmd, iid, label):

    def claim(session, branch='NULL', pr='NULL', ttl=None):
        b = 'NULL' if branch == 'NULL' else "'%s'" % branch
        p = 'NULL' if pr == 'NULL' else "'%s'" % pr
        t = '' if ttl is None else ", interval '%s'" % ttl
        return json.loads(sql(f"SELECT smarter_private.fn_claim_reliability_incident('{iid}', '{session}', {b}, {p}{t})::text"))

    def render():
        return sql(f"SELECT smarter_private.reliability_render_escalation('{iid}', 'escalation', NULL)")

    sql(f"DELETE FROM smarter_private.reliability_incident_claims WHERE incident_id = '{iid}'")
    unclaimed = render()
    assert 'Owner: unassigned, needs an AI coding agent' in unclaimed, unclaimed
    assert f"fn_claim_reliability_incident('{iid}'" in unclaimed, unclaimed

    first = claim('lane-a', 'fix/a', '#1')
    assert first['claimed'] is True and first['owner'] == 'lane-a', first
    second = claim('lane-b', 'fix/b')
    assert second['claimed'] is False, second
    assert (second['owner'], second['branch'], second['pull_request']) == ('lane-a', 'fix/a', '#1'), second
    text = render()
    assert 'Owner: claimed by lane-a, branch fix/a, PR #1, until ' in text, text
    assert 'unassigned' not in text and 'do not start a second fix' in text, text
    ok(label + 'the first lane claims an incident, a second lane is refused and told who holds it, and the handoff names the owner')

    renewed = claim('lane-a')
    assert renewed['claimed'] is True and renewed['branch'] == 'fix/a' and renewed['pull_request'] == '#1', renewed
    assert renewed['claimed_at'] == first['claimed_at'] and renewed['expires_at'] >= first['expires_at'], renewed
    ok(label + 'the holder renews without losing its branch, pull request or original claim time')

    sql(f"UPDATE smarter_private.reliability_incident_claims SET claimed_at = claimed_at - interval '5 hours', "
        f"expires_at = now() - interval '1 second' WHERE incident_id = '{iid}'")
    assert 'Owner: unassigned' in render(), 'an expired claim is not shown as an owner'
    taken = claim('lane-b', 'fix/b')
    assert taken['claimed'] is True and taken['owner'] == 'lane-b', taken
    assert taken['branch'] == 'fix/b' and taken['pull_request'] is None, taken
    assert sql(f"SELECT smarter_private.fn_release_reliability_incident_claim('{iid}', 'lane-a')") == 'f'
    assert sql(f"SELECT smarter_private.fn_release_reliability_incident_claim('{iid}', 'lane-b')") == 't'
    assert sql(f"SELECT count(*) FROM smarter_private.reliability_incident_claims WHERE incident_id = '{iid}'") == '0'
    ok(label + 'an expired claim is taken over with none of the old lane details, and only the holder can release')

    holder = subprocess.Popen(psql_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True)
    rival = None
    try:
        holder.stdin.write(f"BEGIN; SELECT smarter_private.fn_claim_reliability_incident('{iid}', 'lane-c')::text;\n")
        holder.stdin.flush()
        assert json.loads(holder.stdout.readline())['claimed'] is True
        rival = subprocess.Popen(psql_cmd + ['-c', f"SELECT smarter_private.fn_claim_reliability_incident('{iid}', 'lane-d')::text"],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(1.5)
        assert rival.poll() is None, 'the rival must wait on the holder, not decide alone'
        holder.stdin.write("COMMIT;\n\\q\n")
        holder.stdin.flush()
        holder.communicate(timeout=10)
        out, err = rival.communicate(timeout=10)
        assert rival.returncode == 0, err
        lost = json.loads(out.strip())
        assert lost['claimed'] is False and lost['owner'] == 'lane-c', lost
    finally:
        if holder.poll() is None:
            holder.kill()
        if rival is not None and rival.poll() is None:
            rival.kill()
    sql(f"DELETE FROM smarter_private.reliability_incident_claims WHERE incident_id = '{iid}'")
    ok(label + 'two concurrent claims on one incident: exactly one wins and the other is told who')

    for call, reason in (
        (f"SELECT smarter_private.fn_claim_reliability_incident('{iid}', '  ')", 'incident_claim_identity_missing'),
        (f"SELECT smarter_private.fn_claim_reliability_incident('{iid}', 'x', NULL, NULL, interval '25 hours')", 'incident_claim_ttl_out_of_range'),
        ("SELECT smarter_private.fn_claim_reliability_incident('00000000-0000-0000-0000-000000000001', 'x')", 'incident_not_found'),
    ):
        r = psql(['-c', call])
        assert r.returncode != 0 and reason in r.stderr, (call, r.stderr)
    for role in ('anon', 'authenticated'):
        for call in (f"SELECT smarter_private.fn_claim_reliability_incident('{iid}', 'x')",
                     f"SELECT smarter_private.fn_release_reliability_incident_claim('{iid}', 'x')"):
            r = psql(['-c', f"SET ROLE {role}; {call}"])
            assert r.returncode != 0 and 'permission denied' in r.stderr, (role, r.stderr)
    ok(label + 'blank sessions, out-of-range lifetimes and unknown incidents are refused, and no browser role can claim or release')


def stale_and_shipped(sql, psql, ok, iid):
    """A SHIPPED OR STALE INCIDENT CLAIM STOPS BLOCKING (20261121).

    Incident 1e532243 stayed "claimed" for hours after its claimed fix (PR
    #11520) merged and the incident recurred, because the owner kept renewing
    with the same branch and PR. These prove the two root rules: a claim blocks
    for at most 8 hours after its last progress (taken, or a changed branch or
    PR), and a claim whose PR merged stops blocking once the incident fires
    again after that merge. A superseded claim is recorded, never deleted.
    """
    def claim(session, branch=None, pr=None, ttl=None):
        b = 'NULL' if branch is None else "'%s'" % branch
        p = 'NULL' if pr is None else "'%s'" % pr
        t = '' if ttl is None else ", interval '%s'" % ttl
        return json.loads(sql(f"SELECT smarter_private.fn_claim_reliability_incident('{iid}', '{session}', {b}, {p}{t})::text"))

    def render():
        return sql(f"SELECT smarter_private.reliability_render_escalation('{iid}', 'escalation', NULL)")

    def age_progress(hours):
        sql(f"UPDATE smarter_private.reliability_incident_claims SET claimed_at = now() - interval '{hours} hours', "
            f"progress_at = now() - interval '{hours} hours' WHERE incident_id = '{iid}'")

    def superseded(reason):
        return json.loads(sql(
            "SELECT coalesce(json_agg(detail ORDER BY id), '[]')::text FROM smarter_private.reliability_incident_events "
            f"WHERE incident_id = '{iid}' AND kind = 'claim_superseded' AND detail->>'reason' = '{reason}'"))

    reset = f"DELETE FROM smarter_private.reliability_incident_claims WHERE incident_id = '{iid}'"

    # PR forms the merge reader understands; anything else is unknown.
    for given, want in (
        ('#11520', 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/11520'),
        ('11520', 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/11520'),
        ('https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pull/11520',
         'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/11520'),
        ('https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/pull/2900/files',
         'https://api.github.com/repos/Smarter-Poker/Smarter-Poker-World-Hub/pulls/2900'),
        ('fix it later', ''),
        ("https://evil.example/x/y/pull/1", ''),
    ):
        got = sql(f"SELECT coalesce(smarter_private.reliability_claim_pr_api_url($q${given}$q$), '')")
        assert got == want, (given, got)
    ok('the merge reader understands "#n", "n" and github.com pull URLs of any repository, and nothing else')

    # 1. The lifetime: renewals never push a claim past progress_at + 8 hours.
    sql(reset)
    first = claim('lane-a', 'fix/a', None, '24 hours')
    assert first['claimed'] is True and first['state'] == 'live', first
    assert sql(f"SELECT expires_at - progress_at <= interval '8 hours' FROM smarter_private.reliability_incident_claims WHERE incident_id = '{iid}'") == 't'
    age_progress(6)
    renewed = claim('lane-a', None, None, '4 hours')
    assert renewed['claimed'] is True and renewed['reason'] == 'renewed', renewed
    assert sql(f"SELECT abs(extract(epoch FROM expires_at - (progress_at + interval '8 hours'))) < 1 "
               f"FROM smarter_private.reliability_incident_claims WHERE incident_id = '{iid}'") == 't'
    ok('a claim and every renewal are capped at 8 hours after its last progress, whatever lifetime is asked for')

    age_progress(9)
    text = render()
    assert 'Owner: unassigned, needs an AI coding agent' in text and 'passed its 8-hour lifetime' in text, text
    assert 'lane-a, branch fix/a' in text and f"fn_claim_reliability_incident('{iid}'" in text, text
    assert 'do not start a second fix' not in text, text
    stuck = claim('lane-a')
    assert stuck['claimed'] is False and stuck['renewed'] is False, stuck
    assert stuck['reason'] == 'lifetime_spent_renewal_needs_a_new_branch_or_pull_request', stuck
    same = claim('lane-a', 'fix/a')
    assert same['claimed'] is False, 'repeating the same branch is not progress'
    moved = claim('lane-a', None, '#2')
    assert moved['claimed'] is True and moved['reason'] == 'renewed_with_progress', moved
    assert moved['branch'] == 'fix/a' and moved['pull_request'] == '#2' and moved['state'] == 'live', moved
    assert 'do not start a second fix' in render()
    ok('past its lifetime a claim stops blocking, the handoff says so, and only a new branch or PR renews it')

    age_progress(9)
    taken = claim('lane-b', 'fix/b')
    assert taken['claimed'] is True and taken['reason'] == 'superseded_lifetime_spent', taken
    assert taken['owner'] == 'lane-b' and taken['pull_request'] is None, taken
    record = superseded('lifetime_spent')
    assert record and record[-1]['previous']['agent_session'] == 'lane-a', record
    assert record[-1]['previous']['pull_request'] == '#2' and record[-1]['superseded_by'] == 'lane-b', record
    ok('another lane supersedes a spent claim, and the previous claim is kept on the incident record')

    # 2. Shipped and recurred. GitHub is stubbed: the harness has no network.
    sql("CREATE TABLE IF NOT EXISTS smarter_private.zz_claims_github_stub (url text PRIMARY KEY, body jsonb)")
    sql("TRUNCATE smarter_private.zz_claims_github_stub")
    if sql("SELECT to_regprocedure('smarter_private.ca_cutover_http_json(text)') IS NULL") == 't':
        sql("CREATE FUNCTION smarter_private.ca_cutover_http_json(p_url text) RETURNS jsonb LANGUAGE sql "
            "AS $f$ SELECT body FROM smarter_private.zz_claims_github_stub WHERE url = p_url $f$")
    url = 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/11520'
    base = sql(f"SELECT greatest(now(), coalesce(max(at), now())) FROM smarter_private.reliability_incident_events WHERE incident_id = '{iid}'")

    sql(reset)
    owner = claim('lane-a', 'fix/hand-gap', '#11520')
    assert owner['claimed'] is True, owner
    live = render()
    assert 'do not start a second fix' in live and 'that PR has merged and this incident fires again' in live, live

    unknown = claim('lane-b')
    assert unknown['claimed'] is False and unknown['merge_checked'] == 'not_merged_or_unknown', unknown
    assert unknown['pr_merged_at'] is None, unknown
    ok('a GitHub read that cannot tell keeps the claim blocking: unknown is not merged')

    sql(f"INSERT INTO smarter_private.zz_claims_github_stub VALUES ('{url}', jsonb_build_object('merged_at', (timestamptz '{base}' + interval '1 second')))")
    sql(f"INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail, at) "
        f"VALUES ('{iid}', 'recurrence', '{{}}', timestamptz '{base}' - interval '1 second')")
    before = claim('lane-b')
    assert before['claimed'] is False and before['merge_checked'] == 'merged', before
    assert before['pr_merged_at'] is not None and before['state'] == 'live', before
    assert 'do not start a second fix' in render()
    ok('a merged PR with no firing after the merge still blocks: a fix waiting to go live is not superseded')

    sql(f"INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail, at) "
        f"VALUES ('{iid}', 'refire', '{{}}', timestamptz '{base}' + interval '2 seconds')")
    shipped = render()
    assert 'The claimed fix shipped and the incident recurred' in shipped, shipped
    assert 'Owner: unassigned, needs an AI coding agent' in shipped and 'PR #11520' in shipped, shipped
    assert f"fn_claim_reliability_incident('{iid}'" in shipped and 'do not start a second fix' not in shipped, shipped
    holder = claim('lane-a')
    assert holder['claimed'] is False, holder
    assert holder['reason'] == 'shipped_and_recurred_renewal_needs_a_new_branch_or_pull_request', holder
    ok('once the incident fires after the merge the handoff says the claimed fix shipped and recurred, and the holder cannot renew it unchanged')

    winner = claim('lane-b', 'fix/residual')
    assert winner['claimed'] is True and winner['reason'] == 'superseded_shipped_and_recurred', winner
    assert winner['owner'] == 'lane-b' and winner['pull_request'] is None and winner['pr_merged_at'] is None, winner
    record = superseded('shipped_and_recurred')
    assert record and record[-1]['previous']['pull_request'] == '#11520', record
    assert record[-1]['previous']['pr_merged_at'] and record[-1]['refired_after_merge_at'], record
    ok('another lane supersedes a shipped-and-recurred claim, with the merge and the recurrence on the record')

    # 3. The holder of a shipped claim can carry on with a follow-up.
    sql(reset)
    claim('lane-a', 'fix/hand-gap', '#11520')
    # As recorded by an earlier rival's read (fixture; the refire after it exists).
    sql(f"UPDATE smarter_private.reliability_incident_claims SET pr_merged_at = timestamptz '{base}' + interval '1 second' WHERE incident_id = '{iid}'")
    assert claim('lane-a')['claimed'] is False, 'unchanged renewal of a shipped-and-recurred claim is refused'
    follow = claim('lane-a', 'fix/hand-gap-residual')
    assert follow['claimed'] is True and follow['reason'] == 'renewed_with_progress', follow
    assert follow['pull_request'] is None and follow['pr_merged_at'] is None and follow['state'] == 'live', follow
    ok('the holder of a shipped claim keeps the incident by starting a follow-up branch, which drops the merged PR')

    sql(reset)
    sql("DROP TABLE smarter_private.zz_claims_github_stub")
    for role in ('anon', 'authenticated'):
        for call in (f"SELECT smarter_private.reliability_incident_claim_state('{iid}')",
                     f"SELECT smarter_private.reliability_claim_owner_line('{iid}')",
                     "SELECT smarter_private.reliability_claim_pr_merged_at('#1')"):
            r = psql(['-c', f"SET ROLE {role}; {call}"])
            assert r.returncode != 0 and 'permission denied' in r.stderr, (role, call, r.stderr)
    ok('no browser role can read a claim state, its handoff line or the merge reader')


def release_handoff_enrichment(sql, psql, ok, iid):
    orig_class = sql(f"SELECT incident_class FROM smarter_private.reliability_incidents WHERE id = '{iid}'")
    sql(f"DELETE FROM smarter_private.reliability_incident_claims WHERE incident_id = '{iid}'")
    try:
        sql(f"UPDATE smarter_private.reliability_incidents SET incident_class = 'release' WHERE id = '{iid}'")
        rel_line = sql(f"SELECT smarter_private.reliability_claim_owner_line('{iid}')")
        expected = f"gh workflow run triage-engine-release-incident.yml --ref main -f operation=inspect -f incident_id={iid}"
        assert expected in rel_line, rel_line
        rel_esc = sql(f"SELECT smarter_private.reliability_render_escalation('{iid}', 'escalation', NULL)")
        assert expected in rel_esc, rel_esc

        sql(f"UPDATE smarter_private.reliability_incidents SET incident_class = 'engine_liveness' WHERE id = '{iid}'")
        other_line = sql(f"SELECT smarter_private.reliability_claim_owner_line('{iid}')")
        assert 'triage-engine-release-incident.yml' not in other_line, other_line
    finally:
        sql(f"UPDATE smarter_private.reliability_incidents SET incident_class = '{orig_class}' WHERE id = '{iid}'")

    for role in ('anon', 'authenticated'):
        r = psql(['-c', f"SET ROLE {role}; SELECT smarter_private.reliability_claim_owner_line('{iid}')"])
        assert r.returncode != 0 and 'permission denied' in r.stderr, (role, r.stderr)
    ok('class=release handoff names the sanctioned triage/inspect workflow, non-release classes omit it, and browser roles stay denied')
