"""Two real sessions exercise the existing private fixture's row/book ownership."""
import os
import subprocess
import sys
import time

psql, socket = sys.argv[1:]
args = [psql, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55487', '-U', 'postgres', '-d', 'original_dual_eco_native']
union = "'fade0000-0000-0000-0000-000000000001'"
owner = "SELECT set_config('test.uid',md5('native owner')::uuid::text,false);"

def query(sql, **kwargs):
    return subprocess.run(args + ['-c', sql], text=True, capture_output=True, **kwargs)

def holder(sql):
    proc = subprocess.Popen(args, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    proc.stdin.write('BEGIN;' + sql + "SELECT 'LOCKED';\n")
    proc.stdin.flush()
    while True:
        line = proc.stdout.readline()
        if line.strip() == 'LOCKED':
            return proc
        if not line:
            raise AssertionError(proc.stderr.read())

def release(proc):
    proc.stdin.write('COMMIT;\n')
    proc.stdin.close()
    proc.wait(timeout=5)
    assert proc.returncode == 0, proc.stderr.read()

first = holder(owner + f"SELECT fn_union_patch_settings({union},'{{\"native_a\":1}}');")
try:
    env = dict(os.environ, PGAPPNAME='dual-eco-settings-contender')
    second = subprocess.Popen(args + ['-c', owner + f"SELECT fn_union_patch_settings({union},'{{\"native_b\":2}}');"], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 5
    while True:
        waiting = query("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='dual-eco-settings-contender' AND wait_event_type='Lock')::text", check=True).stdout.strip()
        if waiting == 'true':
            break
        assert second.poll() is None and time.monotonic() < deadline, 'contender did not wait on row ownership'
        time.sleep(.02)
finally:
    release(first)
second.wait(timeout=5)
assert second.returncode == 0, second.stderr.read()
assert query(f"SELECT (settings->>'native_a'='1' AND settings->>'native_b'='2' AND settings->>'unrelated'='42')::text FROM unions WHERE id={union}", check=True).stdout.strip() == 'true'
print('PASS: actual concurrent owner patches serialize and preserve both independent settings')
book = f"SELECT fn_union_eco_record({union},'2026-10-26 07:00Z','2026-11-02 08:00Z');"
before = query('SELECT md5(jsonb_agg(to_jsonb(c)ORDER BY id)::text)FROM smarter_private.union_eco_components c', check=True).stdout
first = holder(book)
try:
    refused = query(book)
    assert refused.returncode != 0 and 'original_eco_book_already_owned' in refused.stderr
finally:
    release(first)
assert query(book, check=True).returncode == 0
assert query('SELECT md5(jsonb_agg(to_jsonb(c)ORDER BY id)::text)FROM smarter_private.union_eco_components c', check=True).stdout == before
print('PASS: same-book concurrent ownership refuses, later duplicate preserves every immutable record byte')
