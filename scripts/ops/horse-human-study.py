#!/usr/bin/env python3
"""Explicit private historical study acquisition. Read-only; never activates policy.

Uses the existing authenticated CLI connection preparation, not environment files.
Raw evidence stays in an owner-private directory on the authorized external SSD.
Every source file has a query, digest and acquisition receipt; no count implies
complete history. Human flags and current profile classifications are separate.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def utc(value):
    stamp = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('cutoff_requires_timezone')
    return stamp.astimezone(dt.timezone.utc)


def private_directory(path):
    path = Path(path).absolute()
    roots = [Path('/Volumes/SmarterArchives/agent-evidence/extreme-archive'),
             Path('/Volumes/SmarterWork/agent-work/extreme-capacity')]
    if not any(path.is_relative_to(r) and r.is_mount() for r in roots):
        raise ValueError('mounted_ssd2_required')
    if path.is_symlink() or path.resolve() != path:
        raise ValueError('real_private_path_required')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise ValueError('owner_private_directory_required')
    return path


def native_environment():
    spec = importlib.util.spec_from_file_location('native_export', ROOT / 'scripts/dr/native-supabase-export.py')
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    native.linked_project(ROOT, 'kuklfnapbkmacvwxktbh')
    env = native.cli_environment('/opt/homebrew/bin/supabase', ROOT)
    env['PGSSLROOTCERT'] = str(ROOT / 'scripts/ci/certificates/supabase-prod-ca-2021.crt')
    env['PGAPPNAME'] = 'horse-human-history-study-readonly'
    env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=35000'
    return env


def read_source(env, directory, name, query):
    """New files only. A failed read cannot leave an accepted receipt."""
    target = directory / (name + '.jsonl.gz')
    receipt_path = directory / (name + '.receipt.json')
    query_hash = hashlib.sha256(query.encode()).hexdigest()
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
        if receipt['querySha256'] != query_hash or not target.is_file():
            raise ValueError('existing_source_identity_mismatch')
        if hashlib.sha256(target.read_bytes()).hexdigest() != receipt['sha256']:
            raise ValueError('existing_source_digest_mismatch')
        return receipt
    if target.exists():
        raise ValueError('unreceipted_source_requires_investigation')
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    sql = 'BEGIN READ ONLY; SELECT row_to_json(study_row) FROM (' + query + ') study_row; COMMIT;'
    result = subprocess.run(['/opt/homebrew/bin/psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                            input=sql, env=env, capture_output=True, text=True, timeout=40)
    if result.returncode:
        # stderr can contain connection information; only emit a fixed category.
        kind = 'statement_timeout' if 'statement timeout' in result.stderr else 'query_failed'
        raise RuntimeError(kind + ':' + name)
    lines = result.stdout.splitlines()
    for line in lines:
        if not isinstance(json.loads(line), dict):
            raise ValueError('source_row_not_object')
    data = gzip.compress(result.stdout.encode(), mtime=0)
    with target.open('xb') as f:
        f.write(data)
    receipt = {'source': name, 'querySha256': query_hash,
               'sha256': hashlib.sha256(data).hexdigest(), 'rows': len(lines),
               'startedAt': started, 'finishedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
               'readOnly': True, 'completeHistory': False}
    with receipt_path.open('x') as f:
        json.dump(receipt, f, indent=2)
    with (directory / (name + '.sql')).open('x') as f:
        f.write(query + '\n')
    return receipt


def rows(path):
    with gzip.open(path, 'rt') as f:
        for line in f:
            yield json.loads(line)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['metadata', 'human-index', 'fact-index', 'lightning-index', 'flagged-history', 'missing-history', 'enrich'])
    parser.add_argument('--output', required=True)
    parser.add_argument('--cutoff', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    directory = private_directory(args.output)
    cutoff = utc(args.cutoff)
    if cutoff > dt.datetime.now(dt.timezone.utc):
        raise ValueError('cutoff_not_final')
    end = cutoff.isoformat()
    env = native_environment()
    queries = {}
    if args.mode == 'metadata':
        queries = {
            'profiles': 'select id,username,display_name,is_horse,created_at from public.profiles order by id',
            'sources': "select schemaname,relname,n_live_tup from pg_stat_user_tables where relname ~ '(hand|submission|roster|tournament.*(snapshot|history|event))' order by schemaname,relname",
            'history-policy': 'select horse_retention_days,updated_at from public.hand_history_retention_policy',
            'source-columns': "select table_schema,table_name,column_name,data_type from information_schema.columns where (table_schema='public' and table_name in ('hand_history','ca_hand_facts','ca_hand_player_idx','lightning_hand','lightning_hand_player','hand_atomic_commits','hand_histories','horse_hand_history')) or (table_schema='smarter_private' and table_name like '%hand%') order by table_schema,table_name,ordinal_position",
            'source-indexes': "select schemaname,tablename,indexname,indexdef from pg_indexes where tablename in ('hand_history','ca_hand_facts','ca_hand_player_idx','lightning_hand','lightning_hand_player','hand_submissions') order by schemaname,tablename,indexname",
        }
    elif args.mode in ('human-index','fact-index','lightning-index'):
        # Per-account index ranges avoid the planner's 40-million-row hash scan.
        # Include excluded accounts here: exclusions belong to analysis, not acquisition.
        profiles = list(rows(directory / 'profiles.jsonl.gz'))
        parts = []
        for p in profiles:
            if p['is_horse'] is not False:
                continue
            import uuid
            user = str(uuid.UUID(p['id']))
            if args.mode=='human-index':
                query = ("select user_id,hand_id,created_at,asset from public.ca_hand_player_idx "
                         f"where user_id='{user}'::uuid and created_at<'{end}'::timestamptz order by created_at,hand_id")
            elif args.mode=='fact-index':
                query = ("select user_id,hand_id,played_at,table_id,tournament_id,game_variant from public.ca_hand_facts "
                         f"where user_id='{user}'::uuid and played_at<'{end}'::timestamptz order by played_at,hand_id")
            else:
                query = ("select p.*,h.formed_at,h.settled_at,h.hand_history_id,h.host_table_id,h.rules_version,h.blind_algorithm_version "
                         "from public.lightning_hand_player p join public.lightning_hand h using(hand_id) "
                         f"where p.player_id='{user}'::uuid and h.formed_at<'{end}'::timestamptz order by h.formed_at,p.hand_id")
            parts.append('('+query+')')
        for offset in range(0,len(parts),25):
            prefix={'human-index':'participants-','fact-index':'human-facts-','lightning-index':'lightning-'}[args.mode]
            queries[prefix + str(offset)] = ' UNION ALL '.join(parts[offset:offset+25])
    elif args.mode in ('missing-history','enrich'):
        import uuid
        flagged={}
        for path in sorted(directory.glob('flagged-2*.jsonl.gz')):
            for hand in rows(path): flagged[hand['id']]=(hand['table_id'],hand['hand_number'])
        if args.mode=='missing-history':
            indexed={r['hand_id'] for path in directory.glob('participants-*.jsonl.gz') for r in rows(path)}
            ids=sorted(indexed-set(flagged))
            for offset in range(0,len(ids),100):
                literals=','.join("'"+str(uuid.UUID(i))+"'::uuid" for i in ids[offset:offset+100])
                queries['missing-history-'+str(offset)]=f'select h.* from public.hand_history h where id in ({literals})'
        else:
            for path in directory.glob('missing-history-*.jsonl.gz'):
                for hand in rows(path): flagged[hand['id']]=(hand['table_id'],hand['hand_number'])
            ids=sorted(flagged)
            for offset in range(0,len(ids),200):
                literals=','.join("('"+str(uuid.UUID(i))+"'::uuid)" for i in ids[offset:offset+200])
                queries['enrichment-'+str(offset)]=(f"select h.id as hand_id,c.post_commit_payload->'accepted_hand_facts' as accepted_facts,r.roster,r.status as roster_status,"
                    "(select jsonb_object_agg(f.user_id::text,f.hole_cards) from public.ca_hand_facts f where f.hand_id=h.id) as fact_cards "
                    f"from (values {literals}) ids(id) join public.hand_history h using(id) "
                    "left join public.hand_atomic_commits c using(table_id,hand_number) "
                    "left join smarter_private.accepted_hand_rosters r using(table_id,hand_number)")
    else:
        start = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
        # No assumed launch date: first read establishes retained lower boundary.
        r = read_source(env, directory, 'flagged-boundary',
                        f"select min(created_at) earliest,max(created_at) latest,count(*) hands from public.hand_history where has_human and created_at<'{end}'::timestamptz")
        boundary = next(rows(directory / 'flagged-boundary.jsonl.gz'))
        if boundary['earliest'] is None:
            print(json.dumps(r)); return
        start = utc(boundary['earliest']).replace(hour=0,minute=0,second=0,microsecond=0)
        columns = 'id,table_id,tournament_id,hand_number,created_at,started_at,ended_at,game_variant,small_blind,big_blind,button_seat,has_human,source,version,players,actions,hole_cards,board,community_cards,community_cards2,community_cards3,pots,rit_boards,bomb_pot,cash_rake_policy,rake_amount,bbj_amount,pot_size,winners'
        while start < cutoff:
            stop = min(start + dt.timedelta(days=1), cutoff)
            queries['flagged-' + start.date().isoformat()] = (
                f"select {columns} from public.hand_history where has_human and created_at>='{start.isoformat()}'::timestamptz and created_at<'{stop.isoformat()}'::timestamptz order by created_at,id")
            start = stop
    total = 0
    for i, (name, query) in enumerate(queries.items()):
        receipt = read_source(env, directory, name, query)
        total += receipt['rows']
        if args.mode != 'human-index' or receipt['rows'] or (i + 1) % 100 == 0:
            print(json.dumps({'source':name,'rows':receipt['rows'],'sourcesRead':i+1,'totalRows':total}),flush=True)
    print(json.dumps({'mode':args.mode,'sources':len(queries),'rows':total,'completeHistory':False}),flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        # Never expose subprocess output, SQL data or connection credentials.
        safe = str(error) if type(error) in (ValueError, RuntimeError) else type(error).__name__
        print(json.dumps({'status':'unavailable','reason':safe,'completeHistory':False}),file=sys.stderr)
        sys.exit(2)
