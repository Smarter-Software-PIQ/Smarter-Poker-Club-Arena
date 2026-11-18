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


def qualify(ROOT, sql, psql, ok, psql_cmd):
    found = sorted((ROOT / 'supabase/migrations').glob('*_an_incident_is_claimed_before_it_is_worked.sql'))
    assert len(found) == 1, found
    migration = found[0]
    for _ in range(2):
        r = psql(['-f', str(migration)])
        assert r.returncode == 0, r.stderr

    iid = sql("SELECT id FROM smarter_private.reliability_incidents ORDER BY created_at, id LIMIT 1")
    assert iid, 'the harness holds at least one incident by now'

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
    ok('the first lane claims an incident, a second lane is refused and told who holds it, and the handoff names the owner')

    renewed = claim('lane-a')
    assert renewed['claimed'] is True and renewed['branch'] == 'fix/a' and renewed['pull_request'] == '#1', renewed
    assert renewed['claimed_at'] == first['claimed_at'] and renewed['expires_at'] >= first['expires_at'], renewed
    ok('the holder renews without losing its branch, pull request or original claim time')

    sql(f"UPDATE smarter_private.reliability_incident_claims SET claimed_at = claimed_at - interval '5 hours', "
        f"expires_at = now() - interval '1 second' WHERE incident_id = '{iid}'")
    assert 'Owner: unassigned' in render(), 'an expired claim is not shown as an owner'
    taken = claim('lane-b', 'fix/b')
    assert taken['claimed'] is True and taken['owner'] == 'lane-b', taken
    assert taken['branch'] == 'fix/b' and taken['pull_request'] is None, taken
    assert sql(f"SELECT smarter_private.fn_release_reliability_incident_claim('{iid}', 'lane-a')") == 'f'
    assert sql(f"SELECT smarter_private.fn_release_reliability_incident_claim('{iid}', 'lane-b')") == 't'
    assert sql(f"SELECT count(*) FROM smarter_private.reliability_incident_claims WHERE incident_id = '{iid}'") == '0'
    ok('an expired claim is taken over with none of the old lane details, and only the holder can release')

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
    ok('two concurrent claims on one incident: exactly one wins and the other is told who')

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
    ok('blank sessions, out-of-range lifetimes and unknown incidents are refused, and no browser role can claim or release')
