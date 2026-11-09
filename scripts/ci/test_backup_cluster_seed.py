"""Exercise the real seed selection SQL without production or PostgreSQL access."""
import contextlib
import csv
import importlib.util
import io
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch


class CashClusterSeed(unittest.TestCase):
    def test_required_human_created_clusters_survive_without_human_profiles(self):
        source = Path(__file__).resolve().parents[2] / 'server/standby/seed-extract.py'
        spec = importlib.util.spec_from_file_location('seed_cluster_regression', source)
        seed = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(seed)
        human, horse, cluster = ('00000000-0000-0000-0000-%012d' % i for i in (1, 2, 3))
        with sqlite3.connect(':memory:', check_same_thread=False) as db, tempfile.TemporaryDirectory() as folder:
            db.executescript("""
                attach ':memory:' as public;
                attach ':memory:' as auth;
                create table public.profiles(id text, is_horse boolean, display_name text);
                create table public.cash_games(id text, created_by text);
                create table public.tables(id text, cluster_id text, tournament_id text, status text);
                create table auth.users(id text, aud text, role text, created_at text, email text);
            """)
            db.executemany('insert into public.profiles values(?,?,?)',
                           [(human, False, 'Private Human Name'), (horse, True, 'Horse')])
            db.execute('insert into public.cash_games values(?,?)', (cluster, human))
            db.execute("insert into public.tables values('cash-table',?,null,'running')", (cluster,))
            db.executemany('insert into auth.users values(?,?,?,?,?)',
                           [(human, 'authenticated', 'authenticated', '2026-11-08', 'private@example.invalid'),
                            (horse, 'authenticated', 'authenticated', '2026-11-08', 'horse@example.invalid')])

            def query(sql):
                if 'pg_total_relation_size' in sql:
                    return [['public', table, '1', '20000'] for table in ('profiles', 'cash_games', 'tables')]
                if 'from pg_constraint' in sql:
                    return [['public', 'cash_games', 'created_by']]
                if 'information_schema.columns' in sql:
                    return []
                return [[str(value) for value in row] for row in db.execute(sql)]

            def export(sql, path):
                cursor = db.execute(sql)
                with open(path, 'w', newline='') as output:
                    writer = csv.writer(output)
                    writer.writerow([column[0] for column in cursor.description])
                    writer.writerows(cursor.fetchall())

            with patch.object(seed, 'OUT', folder), patch.object(seed, 'q', side_effect=query), \
                 patch.object(seed, 'copy_out', side_effect=export), contextlib.redirect_stdout(io.StringIO()):
                seed.main()

            def rows(name):
                path = Path(folder, name + '.csv')
                if not path.exists():
                    return []
                with path.open(newline='') as data:
                    return list(csv.DictReader(data))

            references = {row['cluster_id'] for row in rows('public.tables') if row['cluster_id']}
            parents = {row['id'] for row in rows('public.cash_games')}
            self.assertEqual(references, {cluster})
            self.assertTrue(references <= parents, 'exported cash tables must retain their cluster parents')
            self.assertEqual({row['id'] for row in rows('public.profiles')}, {horse})
            self.assertEqual({row['id'] for row in rows('auth.users')}, {horse})
            for path in Path(folder).glob('*.csv'):
                self.assertNotIn('Private Human Name', path.read_text())
                self.assertNotIn('private@example.invalid', path.read_text())


if __name__ == '__main__':
    unittest.main()
