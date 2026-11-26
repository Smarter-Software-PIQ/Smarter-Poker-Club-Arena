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
  * A child table that a database invariant ties to a row-filtered parent
    (CONSERVED below) follows its parent: exactly the child rows whose parent
    row is copied, read in the SAME snapshot as the parent, whatever the
    child's size in rows. The foreign key is read from the live catalog.
  * Everything else is skipped and listed in the manifest.

After extraction every CONSERVED pair is proved on the exported files; a
bundle that breaks one is refused (non-zero exit, no manifest.json).

Every read is its own short autocommit query (never a long snapshot; the
production snapshot guard cancels outside snapshots held over five minutes).
Output: <out>/<schema>.<table>.csv and <out>/manifest.json
"""
import csv, json, os, re, subprocess, sys, time
from decimal import Decimal
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
# Conserved pairs: (parent, parent value column, child, child amount column).
# The database refuses work on a parent row unless
#   parent.<value> = sum(child.<amount>) over the child rows naming that parent
# so the child is never copied whole or dropped by ROW_CAP: it is copied by its
# parent's copied rows, and the copy is proved before the bundle is accepted.
# 2026-11-26: ca_promo_principal_custody passed ROW_CAP and was dropped while
# its grants were still copied; fn_ca_promo_custody_is_conserved (migration
# 20261116153059) then refused every maintenance thaw on the Backup Engine.
# custody.entity_id is the place holding the principal (the grant owner's
# wallet, a table, a pending add-on, a ticket or an event); it is exported only
# for copied grants, which are Horse grants.
# The next conserved pair is one line here.
CONSERVED = (
    (("public", "ca_promo_play_through_grants"), "remaining", ("public", "ca_promo_principal_custody"), "amount"),
)

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


def copy_out_together(exports):
    """Export several (select, path) pairs from ONE read-only snapshot.

    A conserved parent and its child must describe the same instant: play moves
    principal between them continuously. The transaction lasts only as long as
    the copies themselves (seconds), far inside the production snapshot guard.
    """
    args = ["psql", CONN, "-X", "-v", "ON_ERROR_STOP=1", "-c", "begin transaction isolation level repeatable read read only"]
    for select_sql, path in exports:
        if "'" in path:
            raise RuntimeError("seed output path may not contain a quote")
        args += ["-c", f"\\copy ({select_sql}) TO '{path}' WITH CSV HEADER"]
    args += ["-c", "commit"]
    r = subprocess.run(args, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=300)
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[:300])


class SeedEligibilityError(RuntimeError):
    pass


class SeedConservationError(RuntimeError):
    pass


def csv_rows(path):
    csv.field_size_limit(2**31 - 1)
    with open(path, newline="") as data:
        return list(csv.DictReader(data))


def conservation(out, parent, value, child, amount, child_col, parent_col):
    """Prove parent.<value> = sum(child.<amount>) for every exported parent row."""
    parent_name, child_name = ".".join(parent), ".".join(child)
    parent_path, child_path = (os.path.join(out, n + ".csv") for n in (parent_name, child_name))
    if not os.path.exists(parent_path):
        if os.path.exists(child_path):
            raise SeedConservationError(f"seed refused: {child_name} was exported without its parent {parent_name}")
        return {"parent": parent_name, "child": child_name, "parentRows": 0, "childRows": 0}
    held, children = {}, csv_rows(child_path) if os.path.exists(child_path) else []
    for row in children:
        held[row[child_col]] = held.get(row[child_col], Decimal(0)) + Decimal(row[amount])
    parents = csv_rows(parent_path)
    owed = {row[parent_col]: Decimal(row[value]) for row in parents}
    orphans = sorted(set(held) - set(owed))
    broken = sorted(k for k, v in owed.items() if held.get(k, Decimal(0)) != v)
    if orphans or broken:
        raise SeedConservationError(
            f"seed refused: {parent_name}.{value} is not conserved by {child_name}.{amount}: "
            f"{len(broken)} of {len(parents)} copied parent rows differ from their {len(children)} copied child rows"
            f"{' (first ' + broken[0] + ')' if broken else ''}; {len(orphans)} child keys have no copied parent. "
            "The Backup Engine cannot thaw on such a copy; nothing was written to manifest.json.")
    return {"parent": parent_name, "child": child_name, "parentRows": len(parents), "childRows": len(children)}


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

    # Conserved children follow their parent through the declared foreign key.
    present = {(r[0], r[1]) for r in tables}
    pairs = [c for c in CONSERVED if c[0] in present and c[2] in present]
    followers, follows = {}, {}
    if pairs:
        wanted = ",".join("('%s','%s','%s','%s')" % (c[2] + c[0]) for c in pairs)
        links = q(f"""select n.nspname, c.relname, a.attname, rn.nspname, r.relname, ra.attname
                        from pg_constraint k
                        join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
                        join pg_class r on r.oid=k.confrelid join pg_namespace rn on rn.oid=r.relnamespace
                        join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
                        join pg_attribute ra on ra.attrelid=k.confrelid and ra.attnum=k.confkey[1]
                       where k.contype='f' and array_length(k.conkey,1)=1
                         and (n.nspname, c.relname, rn.nspname, r.relname) in (values {wanted})""")
        for parent, value, child, amount in pairs:
            found = [(cc, pc) for cs, ct, cc, ps, pt, pc in links if (cs, ct) == child and (ps, pt) == parent]
            if len(found) != 1:
                raise SeedConservationError(f"seed refused: {'.'.join(child)} must have exactly one single-column "
                                            f"foreign key to {'.'.join(parent)}; the catalog shows {len(found)}")
            follows[child] = (parent, value, amount) + found[0]
            followers.setdefault(parent, []).append(child)

    horses = "(select id from public.profiles where is_horse is true)"
    manifest = {"extractedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "copied": [], "skipped": []}

    def exported_table_values(column):
        path = os.path.join(OUT, "public.tables.csv")
        if not os.path.exists(path):
            return []
        csv.field_size_limit(2**31 - 1)
        with open(path, newline="") as data:
            return sorted({r[column] for r in csv.DictReader(data) if r.get(column)})

    def id_list(ids):
        return ",".join("'%s'" % i.replace("'", "''") for i in ids) if ids else "null"

    def one(row):
        s, t, est, nbytes = row
        key = (s, t)
        name = f"{s}.{t}"
        out = os.path.join(OUT, f"{name}.csv")
        try:
            if key in follows:
                return None  # exported with its parent, in the parent's snapshot
            if key == ("public", "profiles"):
                where = "is_horse is true"
            elif key in (("public", "clubs"), ("public", "unions"), ("public", "union_clubs")):
                # Platform structure: copied whole; owner ids become id-only placeholders.
                where = "true"
            elif key == ("public", "cash_games"):
                # Structural parents of the copied tables. Their owner IDs are
                # covered by the existing ID-only placeholder pass. Read from
                # the exported tables file, not a second live query: a table
                # created between the two reads must never lack its parent.
                where = "id in (%s)" % id_list(exported_table_values("cluster_id"))
            elif key == ("public", "tables"):
                where = "tournament_id is null and status in ('waiting','running','active')"
            elif key == ("public", "table_seats"):
                where = (f"left_at is null and user_id in {horses} and table_id in "
                         "(%s)" % id_list(exported_table_values("id")))
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
                if key in (("public", "club_members"), ("public", "cash_games")):
                    raise SeedEligibilityError("club_members exceeds the seed byte budget")
                return ("skipped", {"table": name, "why": f"large_{int(nbytes)//1048576}_MB"})
            if key not in person_cols and key not in (("public", "profiles"), ("public", "clubs"), ("public", "unions"), ("public", "union_clubs")) and int(est) > ROW_CAP:
                if key in (("public", "club_members"), ("public", "cash_games")):
                    raise SeedEligibilityError("club_members exceeds the seed row budget")
                return ("skipped", {"table": name, "why": f"large_{est}_rows"})
            if int(nbytes) <= 16384 and int(est) <= 0 and key not in (("public", "profiles"), ("public", "club_members")):
                return None  # empty table
            count = int(q(f'select count(*) from "{s}"."{t}" where {where}')[0][0])
            if count > ROW_CAP * 4:
                if key in (("public", "club_members"), ("public", "cash_games")):
                    raise SeedEligibilityError("club_members exceeds the filtered seed row budget")
                return ("skipped", {"table": name, "why": f"filtered_still_{count}_rows"})
            if count == 0:
                return ("skipped", {"table": name, "why": "no_playable_memberships", "excludedRows": exclusions, "excludedRowCount": len(exclusions)}) if exclusions else None
            copied = ("copied", {"table": name, "rows": count, "excludedRows": exclusions, "excludedRowCount": len(exclusions),
                                 "personFilter": person_cols.get(key, ["is_horse"] if key == ("public", "profiles") else [])})
            if key in followers:
                # Parent and children leave production in one snapshot. Row
                # counts are read back from the files, so the manifest and the
                # conservation proof describe the same bytes.
                exports, extra = [(f'select * from "{s}"."{t}" where {where}', out)], []
                for child in followers[key]:
                    child_name = ".".join(child)
                    child_bytes = next(int(r[3]) for r in tables if (r[0], r[1]) == child)
                    if child_bytes > BYTE_CAP:
                        extra.append((child_name, None, ("skipped", {"table": child_name, "why": f"large_{child_bytes//1048576}_MB"})))
                        continue
                    child_col, parent_col = follows[child][3:]
                    child_out = os.path.join(OUT, child_name + ".csv")
                    exports.append((f'select * from "{child[0]}"."{child[1]}" where "{child_col}" in '
                                    f'(select "{parent_col}" from "{s}"."{t}" where {where})', child_out))
                    extra.append((child_name, child_out, None))
                copy_out_together(exports)
                copied[1]["rows"] = len(csv_rows(out))
                return [copied] + [skipped or ("copied", {"table": child_name, "rows": len(csv_rows(child_out)),
                                                          "excludedRows": [], "excludedRowCount": 0, "personFilter": [],
                                                          "followsParent": name})
                                   for child_name, child_out, skipped in extra]
            if key == ("public", "club_members") or not (os.path.exists(out) and os.path.getsize(out) > 0 and os.path.exists(out + ".done")):
                copy_out(f'select * from "{s}"."{t}" where {where}', out)
                open(out + ".done", "w").close()
            return copied
        except SeedEligibilityError:
            raise
        except Exception as exc:  # optional non-membership tables retain their existing policy
            if key in (("public", "club_members"), ("public", "cash_games")):
                raise SeedEligibilityError("club_members extraction failed") from exc
            for child in followers.get(key, []):
                # A failed joint export leaves no half of a conserved pair behind.
                for stale in (out, os.path.join(OUT, ".".join(child) + ".csv")):
                    if os.path.exists(stale):
                        os.remove(stale)
            return ("skipped", {"table": name, "why": "error: " + str(exc)[:160]})

    # Cash tables first, then exactly their parents and seats, then the rest.
    ordered = sorted(tables)
    first = [r for k in ("tables", "cash_games", "table_seats") for r in ordered if (r[0], r[1]) == ("public", k)]
    results = [one(r) for r in first]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results += list(pool.map(one, [r for r in ordered if r not in first]))
    for res in results:
        for entry in (res if isinstance(res, list) else [res] if res else []):
            manifest[entry[0]].append(entry[1])
    listed = {e["table"] for kind in ("copied", "skipped") for e in manifest[kind]}
    for child, (parent, value, amount, child_col, parent_col) in sorted(follows.items()):
        if ".".join(child) not in listed:
            manifest["skipped"].append({"table": ".".join(child), "why": "parent_not_copied:" + ".".join(parent)})
    # Refuse the bundle before manifest.json exists: no loader can take it.
    manifest["conserved"] = [conservation(OUT, parent, value, child, amount, child_col, parent_col)
                             for child, (parent, value, amount, child_col, parent_col) in sorted(follows.items())]
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
