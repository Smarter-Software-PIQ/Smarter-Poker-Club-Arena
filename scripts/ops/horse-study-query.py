#!/usr/bin/env python3
"""Search verified private Horse study volumes by hand, candidate or read-only SQL."""
import argparse
import csv
import sys
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from contextlib import closing
from horse_study_store import candidates, hand_review


def verified_uri(path):
    if not path.is_absolute() or path.is_symlink() or path.resolve() != path or not path.is_file():
        raise ValueError('private_regular_database_required')
    st = path.stat()
    if st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise ValueError('private_regular_database_required')
    manifest = json.loads(path.with_name('summary.json').read_text())
    with path.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if manifest.get(path.name, {}).get('sha256') != digest:
        raise ValueError('database_digest_mismatch')
    return path.as_uri() + '?mode=ro&immutable=1'


def attach_study(db, paths):
    db.execute("PRAGMA temp_store=MEMORY")
    for index, path in enumerate(paths):
        db.execute(f"ATTACH DATABASE ? AS volume{index}", (verified_uri(path),))
    for table in ("hands", "decisions", "candidates"):
        parts = [f"SELECT {index + 1} AS source, * FROM volume{index}.{table}"
                 for index in range(len(paths))]
        db.execute(f"CREATE TEMP VIEW {table} AS " + " UNION ALL ".join(parts))
    db.execute("CREATE TEMP VIEW included_hands AS SELECT * FROM hands WHERE status='included'")
    db.execute("PRAGMA query_only=ON")
    if len(paths) > 1:
        for table, key in (("hands", "hand_id"), ("decisions", "decision_id")):
            if db.execute(f"SELECT 1 FROM {table} GROUP BY {key} HAVING count(*) > 1 LIMIT 1").fetchone():
                raise ValueError(f"duplicate_{key}_across_volumes")


def read_only_sql(action, first, second, database, trigger):
    # query_only alone permits ATTACH and mutable connection pragmas.
    allowed = (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_RECURSIVE)
    if action in allowed or (action == sqlite3.SQLITE_FUNCTION and second != "load_extension"):
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, action='append', type=Path,
                        help='Absolute private study.sqlite path. Repeat for disjoint volumes.')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--hand')
    group.add_argument('--candidate')
    group.add_argument('--sql', help='One read-only SQLite SELECT. Emits TSV.')
    parser.add_argument('--domain', help='Exact format/variant/speed candidate domain')
    parser.add_argument('--limit', type=int, default=100)
    args = parser.parse_args()
    with closing(sqlite3.connect(":memory:", uri=True)) as db:
        attach_study(db, args.database)
        if args.sql is not None:
            db.set_authorizer(read_only_sql)
            rows = db.execute(args.sql)
            writer = csv.writer(sys.stdout, delimiter="\t", lineterminator="\n")
            writer.writerow([field[0] for field in rows.description])
            writer.writerows(rows)
        else:
            result = (hand_review(db, args.hand) if args.hand is not None else
                      candidates(db, args.candidate, args.limit, args.domain))
            print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
