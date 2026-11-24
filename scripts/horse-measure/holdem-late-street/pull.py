#!/usr/bin/env python3
"""Pull the rows of responses.sql in 30-minute windows (Supabase Management API read-only query endpoint; the token is
read from SUPABASE_ACCESS_TOKEN and never printed). Usage: pull.py <project_ref> <from ISO> <to ISO> <out.ndjson> [sql file, default responses.sql]"""
import datetime, json, os, sys, time, urllib.request
ref, start, end, out = sys.argv[1:5]
sql_t = open(sys.argv[5] if len(sys.argv) > 5 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'responses.sql')).read()
def q(sql):
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{ref}/database/query',
        data=json.dumps({'query': sql, 'read_only': True}).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'], 'Content-Type': 'application/json', 'User-Agent': 'readonly-fit'})
    return json.loads(urllib.request.urlopen(req, timeout=280).read())
t = datetime.datetime.fromisoformat(start); e = datetime.datetime.fromisoformat(end)
with open(out, 'w') as f:
    while t < e:
        t2 = min(e, t + datetime.timedelta(minutes=30))
        sql = sql_t.replace(':FROM', t.isoformat()).replace(':TO', t2.isoformat())
        rows = None
        for _ in range(4):
            try: rows = q(sql); break
            except Exception as ex: print('retry', t, ex, flush=True); time.sleep(10)
        for r in rows or []: f.write(json.dumps(r) + '\n')
        print(t.isoformat(), len(rows or []), flush=True); t = t2
print('DONE')
