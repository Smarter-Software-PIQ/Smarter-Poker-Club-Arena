#!/usr/bin/env python3
"""Backup Engine seed extractor (read-only against production).

Builds a seed bundle for the isolated Backup Engine database: the platform's
shape (clubs, unions, tables, schedules, policies, horse accounts and the
horses' seats) WITHOUT any real person's data.

Rules, decided per table from the live catalog:
  * A table whose foreign keys reach profiles/auth.users is copied only for
    rows whose every person reference is NULL or a horse (profiles.is_horse).
  * A table with no person reference is copied whole when it is small
    (<= ROW_CAP rows) and is not a ledger/log/message/history table.
  * Cash-game parents referenced by exported tables are retained as structure;
    their person references receive existing id-only placeholders.
  * Everything else is skipped and listed in the manifest.

Every read is its own short autocommit query (never a long snapshot; the
production snapshot guard cancels outside snapshots held over five minutes).
Output: <out>/<schema>.<table>.csv and <out>/manifest.json
"""
import csv, json, os, re, subprocess, sys, time, uuid
from concurrent.futures import ThreadPoolExecutor

OUT = sys.argv[1] if len(sys.argv) > 1 else None
SCHEMAS = ("public", "smarter_private", "ops")
ROW_CAP = 25000
BYTE_CAP = 20 * 1024 * 1024
EXCLUDE = re.compile(r"(^accounting_|conversation|ledger|transaction|transfer|_log$|_logs$|log_|audit|history|message|notification|"
                     r"receipt|journal|event|snapshot|archive|invoice|payment|cashout|deposit|withdraw|"
                     r"session|token|secret|credential|email|phone|kyc|address|chat|report|outbox|_runs?$|"
                     r"attempt|fault|cancellation|telemetry|metric|observation|sample)")
PERSON_TABLES = {("public", "profiles"), ("auth", "users")}

CONN = os.environ.get("SEED_DATABASE_URL") or ("host=aws-0-us-west-2.pooler.supabase.com port=5432 user=postgres.kuklfnapbkmacvwxktbh "
        "dbname=postgres sslmode=require application_name=standby_seed_extract")
ENV = {**os.environ, "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=60s"}


def q(sql):
    r = subprocess.run(["psql", CONN, "-AtX", "-F", "\t", "-c", sql], env=ENV,
                       capture_output=True, text=True, timeout=90)
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[:300])
    return [l.split("\t") for l in r.stdout.splitlines() if l]


def copy_out(select_sql, path):
    with open(path, "w") as f:
        r = subprocess.run(["psql", CONN, "-X", "-c", f"\\copy ({select_sql}) TO STDOUT WITH CSV HEADER"],
                           env=ENV, stdout=f, stderr=subprocess.PIPE, text=True, timeout=180)
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[:300])


class SeedEligibilityError(RuntimeError):
    pass


def close_cash_game_parents(manifest):
    """Retain structural parents of the actual exported cash tables.

    A cluster's creator is not its player: its profile is still never copied.
    Existing placeholder generation supplies id-only structural owner accounts.
    Use the child CSV, not a later production table scan that could race it.
    """
    def ids(name, column):
        path = os.path.join(OUT, name + '.csv')
        if not os.path.exists(path):
            return set()
        if name == 'public.cash_games' and os.path.getsize(path) > BYTE_CAP:
            raise SeedEligibilityError(name + ' exceeds the parent closure byte budget')
        with open(path, newline='') as source:
            reader = csv.DictReader(source)
            if column not in (reader.fieldnames or []):
                raise SeedEligibilityError(name + ' is missing ' + column)
            result = set()
            for row in reader:
                if row[column]:
                    result.add(str(uuid.UUID(row[column])))
                if len(result) > ROW_CAP * 4:
                    raise SeedEligibilityError('cash_games exceeds the parent closure row budget')
            return result

    try:
        required = ids('public.tables', 'cluster_id')
        if not required:
            return
        wanted = required | ids('public.cash_games', 'id')
        if len(wanted) > ROW_CAP * 4:
            raise SeedEligibilityError('cash_games exceeds the parent closure row budget')
        literals = ','.join("'%s'::uuid" % value for value in sorted(wanted))
        path = os.path.join(OUT, 'public.cash_games.csv')
        copy_out('select * from public.cash_games where id in (' + literals + ')', path)
        actual = ids('public.cash_games', 'id')
        if actual != wanted:
            raise SeedEligibilityError('cash_games parent closure is incomplete')
        for section in ('copied', 'skipped'):
            manifest[section] = [row for row in manifest[section] if row['table'] != 'public.cash_games']
        manifest['copied'].append({'table': 'public.cash_games', 'rows': len(actual),
                                   'structuralParentOf': 'public.tables.cluster_id',
                                   'personFilter': [], 'excludedRows': [], 'excludedRowCount': 0})
    except SeedEligibilityError:
        raise
    except Exception as exc:
        raise SeedEligibilityError('cash_games parent closure failed') from exc


def playable_memberships(where):
    """Exclude only immutable, empty retired history, never playable members."""
    invalid = f"({where}) and coalesce(is_bot,false) and not public.fn_ca_house_board_allows_automation(club_id)"
    safe = """membership_lifecycle_status <> 'active'
      and coalesce(chip_balance,0)=0 and coalesce(held_chips,0)=0
      and exists (select 1 from public.clubs c where c.id=club_members.club_id and c.lifecycle_status='retired')
      and not exists (select 1 from public.tables t where t.club_id=club_members.club_id
                      and t.status in ('waiting','running','active'))
      and not exists (select 1 from public.table_seats s join public.tables t on t.id=s.table_id
                      where t.club_id=club_members.club_id and s.left_at is null)"""
    rows = q(f"select club_id,user_id,coalesce(({safe}),false) from public.club_members where {invalid} order by club_id,user_id")
    if any(eligible != 't' for _, _, eligible in rows):
        raise SeedEligibilityError('invalid automation membership is playable, funded, seated, or not retired')
    exclusions = [{'clubId': club, 'userId': user,
                   'reason': 'nonplayable_empty_retired_club_membership'} for club, user, _ in rows]
    # The eligibility predicate is repeated in the export, so a concurrent
    # change cannot silently exclude a newly active/funded member.
    if not rows:
        return where, exclusions
    identities = ",".join("('%s'::uuid,'%s'::uuid)" % (club.replace("'", "''"), user.replace("'", "''")) for club, user, _ in rows)
    return f"({where}) and not ((club_id,user_id) in ({identities}) and (coalesce(is_bot,false) and not public.fn_ca_house_board_allows_automation(club_id)) and coalesce(({safe}),false))", exclusions


def main():
    os.makedirs(OUT, exist_ok=True)
    schemas = ",".join(f"'{s}'" for s in SCHEMAS)
    tables = q(f"""select n.nspname, c.relname, greatest(c.reltuples,0)::bigint, pg_total_relation_size(c.oid)
                   from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where c.relkind in ('r','p') and not c.relispartition and n.nspname in ({schemas})""")
    # Person references: FK columns (single column) pointing at profiles(id) or auth.users(id).
    fks = q(f"""select n.nspname, c.relname, a.attname
                  from pg_constraint k
                  join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
                  join pg_class r on r.oid=k.confrelid join pg_namespace rn on rn.oid=r.relnamespace
                  join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
                 where k.contype='f' and array_length(k.conkey,1)=1 and n.nspname in ({schemas})
                   and ((rn.nspname='public' and r.relname='profiles') or (rn.nspname='auth' and r.relname='users'))""")
    person_cols = {}
    for s, t, col in fks:
        person_cols.setdefault((s, t), []).append(col)
    # Name-based person columns without an FK (user_id, player_id, ...).
    named = q(f"""select table_schema, table_name, column_name from information_schema.columns
                   where table_schema in ({schemas}) and data_type='uuid'
                     and column_name ~ '^(user_id|player_id|owner_id|agent_id|profile_id|created_by|host_id|requested_by|seat_user_id)$'""")
    for s, t, col in named:
        cols = person_cols.setdefault((s, t), [])
        if col not in cols:
            cols.append(col)

    horses = "(select id from public.profiles where is_horse is true)"
    manifest = {"extractedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "copied": [], "skipped": []}

    def one(row):
        s, t, est, nbytes = row
        key = (s, t)
        name = f"{s}.{t}"
        out = os.path.join(OUT, f"{name}.csv")
        try:
            if key == ("public", "profiles"):
                where = "is_horse is true"
            elif key in (("public", "clubs"), ("public", "unions"), ("public", "union_clubs")):
                # Platform structure: copied whole; owner ids become id-only placeholders.
                where = "true"
            elif key == ("public", "tables"):
                where = "tournament_id is null and status in ('waiting','running','active')"
            elif key == ("public", "table_seats"):
                where = (f"left_at is null and user_id in {horses} and table_id in "
                         "(select id from public.tables where tournament_id is null and status in ('waiting','running','active'))")
            elif EXCLUDE.search(t):
                return ("skipped", {"table": name, "why": "ledger_or_personal_record"})
            elif key in person_cols:
                where = " and ".join(f'("{c}" is null or "{c}" in {horses})' for c in person_cols[key])
            else:
                where = "true"
            exclusions = []
            if key == ("public", "club_members"):
                where, exclusions = playable_memberships(where)
            if int(nbytes) > BYTE_CAP and key not in (("public", "profiles"), ("public", "tables"), ("public", "table_seats"), ("public", "clubs"), ("public", "unions"), ("public", "union_clubs")):
                if key == ("public", "club_members"):
                    raise SeedEligibilityError("club_members exceeds the seed byte budget")
                return ("skipped", {"table": name, "why": f"large_{int(nbytes)//1048576}_MB"})
            if key not in person_cols and key not in (("public", "profiles"), ("public", "clubs"), ("public", "unions"), ("public", "union_clubs")) and int(est) > ROW_CAP:
                if key == ("public", "club_members"):
                    raise SeedEligibilityError("club_members exceeds the seed row budget")
                return ("skipped", {"table": name, "why": f"large_{est}_rows"})
            if int(nbytes) <= 16384 and int(est) <= 0 and key not in (("public", "profiles"), ("public", "club_members")):
                return None  # empty table
            count = int(q(f'select count(*) from "{s}"."{t}" where {where}')[0][0])
            if count > ROW_CAP * 4:
                if key == ("public", "club_members"):
                    raise SeedEligibilityError("club_members exceeds the filtered seed row budget")
                return ("skipped", {"table": name, "why": f"filtered_still_{count}_rows"})
            if count == 0:
                return ("skipped", {"table": name, "why": "no_playable_memberships", "excludedRows": exclusions, "excludedRowCount": len(exclusions)}) if exclusions else None
            if key == ("public", "club_members") or not (os.path.exists(out) and os.path.getsize(out) > 0 and os.path.exists(out + ".done")):
                copy_out(f'select * from "{s}"."{t}" where {where}', out)
                open(out + ".done", "w").close()
            return ("copied", {"table": name, "rows": count, "excludedRows": exclusions, "excludedRowCount": len(exclusions),
                               "personFilter": person_cols.get(key, ["is_horse"] if key == ("public", "profiles") else [])})
        except SeedEligibilityError:
            raise
        except Exception as exc:  # optional non-membership tables retain their existing policy
            if key == ("public", "club_members"):
                raise SeedEligibilityError("club_members extraction failed") from exc
            return ("skipped", {"table": name, "why": "error: " + str(exc)[:160]})

    with ThreadPoolExecutor(max_workers=4) as pool:
        for res in pool.map(one, sorted(tables)):
            if res:
                manifest[res[0]].append(res[1])
    close_cash_game_parents(manifest)
    # Horses' auth identities (no email/phone carried; ids only).
    copy_out(f"select id, aud, role, created_at from auth.users where id in {horses}", os.path.join(OUT, "auth.users.csv"))
    for f in os.listdir(OUT):
        if f.endswith(".done"):
            os.remove(os.path.join(OUT, f))
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
    print(json.dumps({"copied": len(manifest["copied"]), "skipped": len(manifest["skipped"]),
                      "rows": sum(c["rows"] for c in manifest["copied"])}))


if __name__ == "__main__":
    main()
