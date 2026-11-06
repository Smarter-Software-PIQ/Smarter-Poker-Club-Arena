#!/usr/bin/env python3
"""Read one private study hand or a named review-candidate cohort as JSON."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from contextlib import closing
from horse_study_store import hand_review,candidates


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--hand');group.add_argument('--candidate')
    parser.add_argument('--domain',help='Exact format/variant/speed candidate domain')
    parser.add_argument('--limit',type=int,default=100)
    args=parser.parse_args();path=Path(args.database)
    if not path.is_absolute() or path.is_symlink() or path.resolve()!=path or not path.is_file():
        raise ValueError('private_regular_database_required')
    st=path.stat()
    if st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('private_regular_database_required')
    manifest=json.loads(path.with_name('summary.json').read_text())
    with path.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
    if manifest.get(path.name,{}).get('sha256')!=digest:raise ValueError('database_digest_mismatch')
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as connection:
        result=hand_review(connection,args.hand) if args.hand else candidates(connection,args.candidate,args.limit,args.domain)
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
