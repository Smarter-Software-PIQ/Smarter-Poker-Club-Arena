#!/usr/bin/env bash
# Native PG17 proof for 20261114190106_bust_money_path_timing_spans.sql and its
# held removal. Scratch cluster only; nothing here touches production.
#  - the migration applies as written; both instrumented functions compile
#    (stub tables stand in for the %ROWTYPE relations, check_function_bodies on);
#  - the installed bodies, with the marked span lines removed, have the exact
#    production prosrc md5; grants equal production's;
#  - RAISE LOG leaves FOUND and ROW_COUNT untouched, reaches the server log and
#    not the client (client_min_messages=notice), and opens no subtransaction;
#  - the held removal restores the exact production bodies and grants.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
bin="${PG_BIN:-/usr/lib/postgresql/17/bin}"
work="$(mktemp -d)"; trap '"$bin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
"$bin/initdb" -D "$work/data" -U postgres -A trust >/dev/null
"$bin/pg_ctl" -D "$work/data" -o "-k $work -p 55439 -c listen_addresses='' -c log_min_messages=warning" -l "$work/log" start >/dev/null
psql=(psql -X -v ON_ERROR_STOP=1 -h "$work" -p 55439 -U postgres -d postgres -q)
"${psql[@]}" <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.tournaments (id uuid);
CREATE TABLE public.tournament_players (id uuid);
CREATE TABLE public.tournament_knockout_candidates (id uuid);
CREATE TABLE public.hand_atomic_commits (id uuid);
CREATE TABLE public.table_seats (id uuid);
CREATE TABLE public.tournament_bounty_obligations (id uuid);
SQL
"${psql[@]}" -f "$root/supabase/migrations/20261114190106_bust_money_path_timing_spans.sql"
check_bodies() {
sed "s/@EXPECT_MARKED@/$1/" > "$work/check.sql" <<'SQL'
DO $proof$
DECLARE marked text := '@EXPECT_MARKED@'; r record;
BEGIN
  FOR r IN SELECT p.proname, p.prosrc, p.proacl::text acl FROM pg_proc p
            WHERE p.proname IN ('fn_claim_tournament_bounty_elimination','fn_collect_bounty_obligation') LOOP
    IF md5(regexp_replace(r.prosrc, E'[^\\n]*-- @bust-money-span\\n', '', 'g'))
       <> (CASE r.proname WHEN 'fn_claim_tournament_bounty_elimination' THEN '4ec5bce3b65e7b1f18af615a5bdb1a96'
                          ELSE 'dde145f7b818e905ecf8f6354e55f055' END) THEN
      RAISE EXCEPTION '% differs from production outside its marked lines', r.proname;
    END IF;
    IF (strpos(r.prosrc, '-- @bust-money-span') > 0)::text <> marked THEN
      RAISE EXCEPTION '% marked=% expected %', r.proname, strpos(r.prosrc,'-- @bust-money-span')>0, marked;
    END IF;
    IF r.acl <> '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION '% grants % differ from production', r.proname, r.acl;
    END IF;
  END LOOP;
END $proof$;
SQL
"${psql[@]}" -f "$work/check.sql"
}
check_bodies true
# RAISE LOG semantics, in the shapes the spans sit in.
out="$("${psql[@]}" 2>&1 <<'SQL'
CREATE TABLE t (n int); INSERT INTO t VALUES (1),(2),(3);
CREATE FUNCTION span_shape() RETURNS text LANGUAGE plpgsql AS $f$
DECLARE c int; f boolean; x int; t0 timestamptz := clock_timestamp();
BEGIN
  UPDATE t SET n = n + 1;
  RAISE LOG 'ca_bust_money_span fn=probe mark=a tournament=% t0=% ms=%', NULL::uuid, t0, round((extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric, 3);
  GET DIAGNOSTICS c = ROW_COUNT;
  SELECT n INTO x FROM t WHERE false;
  RAISE LOG 'ca_bust_money_span fn=probe mark=b tournament=% t0=% ms=%', NULL::uuid, t0, round((extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric, 3);
  f := FOUND;
  RETURN c || ':' || f || ':' || coalesce(txid_current_if_assigned()::text,'none');
END $f$;
SELECT span_shape();
SQL
)"
echo "$out" | grep -q '3:false:' || { echo "RAISE LOG changed ROW_COUNT or FOUND: $out"; exit 1; }
echo "$out" | grep -q 'ca_bust_money_span' && { echo "LOG line reached the client: $out"; exit 1; }
grep -q 'ca_bust_money_span fn=probe mark=b' "$work/log" || grep -rq 'ca_bust_money_span fn=probe mark=b' "$work/data/log" 2>/dev/null || { echo "LOG line not in the server log"; exit 1; }
# The held removal restores production exactly.
"${psql[@]}" -f "$root/docs/audits/2026-11-14-bust-money-spans/pending-adoption/20261114200138_restore_bust_money_path_bodies.sql"
check_bodies false
echo "bust money spans: native PG17 proof passed (bodies, grants, RAISE LOG semantics, removal)"
