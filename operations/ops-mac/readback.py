#!/usr/bin/env python3
"""Readback of an installed migration against PokerIQ-Production.
usage: readback.py MIGRATION.sql > OUT.sql   (run OUT.sql with db.sh -f; it always ROLLs BACK)
Prints:
  readback|<routines>|<unchanged>|<changed signatures>  every CREATE FUNCTION/PROCEDURE re-executed
                                                         inside the rolled-back transaction; unchanged
                                                         == routines means production equals the file
  liveproof|t or f                                      the migration's own -- @live-proof expression
"""
import re, sys
s = open(sys.argv[1]).read()
proof = None
for line in s.split('\n'):
    if line.startswith('-- @live-proof:'):
        proof = line[len('-- @live-proof:'):].strip()
stmts = []
for m in re.finditer(r'CREATE (?:OR REPLACE )?(FUNCTION|PROCEDURE)\s+([\w."]+)\s*\(', s):
    a = m.start()
    t = re.compile(r'AS\s+(\$\w*\$)').search(s, a)
    tag = t.group(1); b = s.index(tag, t.end()) + len(tag)
    e = s.index(';', b) + 1
    stmts.append((m.group(2).replace('"', ''), s[a:e]))
names = sorted({n for n, _ in stmts})
print("BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';")
print("CREATE TEMP TABLE rb_before(sig text, d text) ON COMMIT DROP;")
if names:
    qn = ",".join("'" + n + "'" for n in names)
    print(f"INSERT INTO rb_before SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) FROM (SELECT unnest(ARRAY[{qn}]::text[]) q) x JOIN pg_proc p ON true JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname = CASE WHEN position('.' in x.q)>0 THEN x.q ELSE 'public.'||x.q END;")
    for _, st in stmts:
        print(st)
print("SELECT 'readback', count(*), count(*) FILTER (WHERE b.d=md5(pg_get_functiondef(b.sig::regprocedure))), coalesce(string_agg(b.sig,' | ') FILTER (WHERE b.d<>md5(pg_get_functiondef(b.sig::regprocedure))),'') FROM rb_before b;")
print("ROLLBACK;")
if proof:
    print(f"SELECT 'liveproof', ({proof});")
else:
    print("SELECT 'liveproof', 'missing';")
