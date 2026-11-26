"""Exercise the real seed selection SQL without production or PostgreSQL access."""
import contextlib
import csv
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
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

    def test_cash_table_created_during_export_keeps_its_cluster_parent(self):
        """Run 42567430772: nine cash tables and their new cash_games parents were
        created at 05:43:13Z, after the parents were read and before the tables
        were read. The copy then held tables whose cluster_id had no parent."""
        source = Path(__file__).resolve().parents[2] / 'server/standby/seed-extract.py'
        spec = importlib.util.spec_from_file_location('seed_cluster_race_regression', source)
        seed = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(seed)
        old, new = '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'
        with sqlite3.connect(':memory:', check_same_thread=False) as db, tempfile.TemporaryDirectory() as folder:
            db.executescript("""
                attach ':memory:' as public;
                attach ':memory:' as auth;
                create table public.profiles(id text, is_horse boolean);
                create table public.cash_games(id text);
                create table public.tables(id text, cluster_id text, tournament_id text, status text);
                create table auth.users(id text, aud text, role text, created_at text);
            """)
            db.execute('insert into public.cash_games values(?)', (old,))
            db.execute("insert into public.tables values('old-table',?,null,'running')", (old,))
            created = []

            def query(sql):
                if 'pg_total_relation_size' in sql:
                    return [['public', table, '1', '20000'] for table in ('profiles', 'cash_games', 'tables')]
                if 'from pg_constraint' in sql or 'information_schema.columns' in sql:
                    return []
                return [[str(value) for value in row] for row in db.execute(sql)]

            parents_read = threading.Event()

            def export(sql, path):
                name = Path(path).name
                if name == 'public.tables.csv':
                    # As in production, a concurrent reader reaches tables only
                    # after the parents were read (bounded for a sequential one).
                    parents_read.wait(1)
                cursor = db.execute(sql)
                with open(path, 'w', newline='') as output:
                    writer = csv.writer(output)
                    writer.writerow([column[0] for column in cursor.description])
                    writer.writerows(cursor.fetchall())
                if name == 'public.cash_games.csv':
                    # Production opens a new board (parent and table together)
                    # while the export is in flight.
                    created.append(True)
                    db.execute('insert into public.cash_games values(?)', (new,))
                    db.execute("insert into public.tables values('new-table',?,null,'waiting')", (new,))
                    parents_read.set()

            with patch.object(seed, 'OUT', folder), patch.object(seed, 'q', side_effect=query), \
                 patch.object(seed, 'copy_out', side_effect=export), contextlib.redirect_stdout(io.StringIO()):
                seed.main()

            def rows(name):
                with Path(folder, name + '.csv').open(newline='') as data:
                    return list(csv.DictReader(data))

            references = {row['cluster_id'] for row in rows('public.tables') if row['cluster_id']}
            parents = {row['id'] for row in rows('public.cash_games')}
            self.assertTrue(created)
            self.assertIn(old, references)
            self.assertTrue(references <= parents,
                            'every exported cash table cluster_id must have its cash_games parent: %s'
                            % sorted(references - parents))


class ConservedChildFollowsItsParent(unittest.TestCase):
    """2026-11-26: production ca_promo_principal_custody reached 25,601 rows, one
    step over ROW_CAP. It has no person reference, so the extractor dropped it
    whole while its parent grants (person-filtered to Horses) were still copied.
    The conservation trigger then refused every maintenance thaw on the Backup
    Engine and no candidate could be certified."""
    GRANTS, CUSTODY = 'ca_promo_play_through_grants', 'ca_promo_principal_custody'

    def run_seed(self, module_name, custody, sizes=None, foreign_key=True):
        source = Path(__file__).resolve().parents[2] / 'server/standby/seed-extract.py'
        spec = importlib.util.spec_from_file_location(module_name, source)
        seed = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(seed)
        human, horse = '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'
        sizes = {self.GRANTS: ('22672', '16130048'), self.CUSTODY: (str(seed.ROW_CAP + 601), '4505600'),
                 'profiles': ('2', '20000'), **(sizes or {})}
        together = []
        with sqlite3.connect(':memory:', check_same_thread=False) as db, tempfile.TemporaryDirectory() as folder:
            db.executescript("""
                attach ':memory:' as public;
                attach ':memory:' as auth;
                create table public.profiles(id text, is_horse boolean);
                create table public.ca_promo_play_through_grants(id text, user_id text, remaining text);
                create table public.ca_promo_principal_custody(grant_id text, kind text, entity_id text, amount text);
                create table auth.users(id text, aud text, role text, created_at text);
            """)
            db.executemany('insert into public.profiles values(?,?)', [(human, False), (horse, True)])
            db.executemany('insert into public.ca_promo_play_through_grants values(?,?,?)',
                           [('horse-open', horse, '50.5'), ('horse-closed', horse, '0'), ('human-open', human, '70')])
            db.executemany('insert into public.ca_promo_principal_custody values(?,?,?,?)', custody)

            def query(sql):
                if 'pg_total_relation_size' in sql:
                    return [['public', table, *size] for table, size in sizes.items()]
                if 'confkey' in sql:
                    return [['public', self.CUSTODY, 'grant_id', 'public', self.GRANTS, 'id']] if foreign_key else []
                if 'from pg_constraint' in sql:
                    return [['public', self.GRANTS, 'user_id']]
                if 'information_schema.columns' in sql:
                    return []
                return [[str(value) for value in row] for row in db.execute(sql)]

            def export(sql, path):
                cursor = db.execute(sql)
                with open(path, 'w', newline='') as output:
                    writer = csv.writer(output)
                    writer.writerow([column[0] for column in cursor.description])
                    writer.writerows(cursor.fetchall())

            def export_together(exports):
                together.append([Path(path).name for _, path in exports])
                for sql, path in exports:
                    export(sql, path)

            with patch.object(seed, 'OUT', folder), patch.object(seed, 'q', side_effect=query), \
                 patch.object(seed, 'copy_out', side_effect=export), \
                 patch.object(seed, 'copy_out_together', side_effect=export_together, create=True), \
                 contextlib.redirect_stdout(io.StringIO()):
                try:
                    seed.main()
                    failure = None
                except Exception as exc:  # the caller asserts the exact refusal
                    failure = exc

            def rows(name):
                path = Path(folder, 'public.' + name + '.csv')
                if not path.exists():
                    return None
                with path.open(newline='') as data:
                    return list(csv.DictReader(data))

            manifest_path = Path(folder, 'manifest.json')
            manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
            return seed, failure, manifest, rows(self.GRANTS), rows(self.CUSTODY), together

    CONSERVED = [('horse-open', 'player_wallet', '00000000-0000-0000-0000-000000000002', '20.5'),
                 ('horse-open', 'table_stack', 'a-table', '30'),
                 ('horse-closed', 'player_wallet', '00000000-0000-0000-0000-000000000002', '0'),
                 ('human-open', 'player_wallet', '00000000-0000-0000-0000-000000000001', '70')]

    def test_a_child_over_the_row_cap_is_exported_for_exactly_its_copied_parents(self):
        seed, failure, manifest, grants, custody, together = self.run_seed('seed_follows_parent', self.CONSERVED)
        self.assertIsNone(failure)
        self.assertEqual({row['id'] for row in grants}, {'horse-open', 'horse-closed'})
        self.assertIsNotNone(custody, 'the custody table was dropped from the seed while its grants were copied')
        self.assertEqual(sorted((row['grant_id'], row['kind'], row['amount']) for row in custody),
                         [('horse-closed', 'player_wallet', '0'), ('horse-open', 'player_wallet', '20.5'),
                          ('horse-open', 'table_stack', '30')])
        # One snapshot for the pair: a hand played between two reads would
        # otherwise move principal and break the copy.
        self.assertEqual(together, [['public.%s.csv' % self.GRANTS, 'public.%s.csv' % self.CUSTODY]])
        copied = {entry['table']: entry for entry in manifest['copied']}
        self.assertEqual(copied['public.' + self.CUSTODY]['rows'], 3)
        self.assertEqual(copied['public.' + self.CUSTODY]['followsParent'], 'public.' + self.GRANTS)
        self.assertEqual(copied['public.' + self.GRANTS]['rows'], 2)
        self.assertEqual([entry for entry in manifest['skipped'] if self.CUSTODY in entry['table']], [])
        self.assertEqual(manifest['conserved'], [{'parent': 'public.' + self.GRANTS, 'child': 'public.' + self.CUSTODY,
                                                  'parentRows': 2, 'childRows': 3}])
        self.assertFalse(any(row['user_id'].endswith('0001') for row in grants))
        self.assertFalse(any('human' in row['grant_id'] for row in custody))
        self.assertFalse(any(row['entity_id'].endswith('0001') for row in custody))

    def test_a_copy_that_does_not_conserve_is_refused_before_any_manifest_exists(self):
        short = [row if row[1] != 'table_stack' else (*row[:3], '29.99') for row in self.CONSERVED]
        missing = [row for row in self.CONSERVED if row[0] != 'horse-open']
        for name, custody in (('short', short), ('missing', missing)):
            with self.subTest(name):
                seed, failure, manifest, _, _, _ = self.run_seed('seed_conservation_' + name, custody)
                self.assertIsInstance(failure, seed.SeedConservationError)
                self.assertRegex(str(failure), r'remaining is not conserved by public\.%s\.amount: 1 of 2 copied parent rows'
                                 % self.CUSTODY)
                self.assertIn('horse-open', str(failure))
                self.assertIsNone(manifest)

    def test_a_child_too_large_in_bytes_cannot_leave_its_parent_alone_in_the_seed(self):
        # The fault's own shape: grants copied, custody absent.
        seed, failure, manifest, grants, custody, _ = self.run_seed(
            'seed_conservation_bytes', self.CONSERVED, sizes={self.CUSTODY: ('25601', str(20 * 1024 * 1024 + 1))})
        self.assertIsInstance(failure, seed.SeedConservationError)
        self.assertEqual(len(grants), 2)
        self.assertIsNone(custody)
        self.assertIsNone(manifest)

    def test_a_conserved_pair_without_its_foreign_key_is_refused(self):
        seed, failure, manifest, _, _, _ = self.run_seed('seed_conservation_fk', self.CONSERVED, foreign_key=False)
        self.assertIsInstance(failure, seed.SeedConservationError)
        self.assertIn('exactly one single-column foreign key', str(failure))
        self.assertIsNone(manifest)

    def test_the_proof_refuses_a_child_exported_without_its_parent(self):
        source = Path(__file__).resolve().parents[2] / 'server/standby/seed-extract.py'
        spec = importlib.util.spec_from_file_location('seed_conservation_orphan', source)
        seed = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(seed)
        (parent, value, child, amount), = [pair for pair in seed.CONSERVED if pair[2][1] == self.CUSTODY]
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(seed.conservation(folder, parent, value, child, amount, 'grant_id', 'id')['parentRows'], 0)
            Path(folder, 'public.%s.csv' % self.CUSTODY).write_text('grant_id,kind,entity_id,amount\ng,event,e,1\n')
            with self.assertRaisesRegex(seed.SeedConservationError, 'without its parent'):
                seed.conservation(folder, parent, value, child, amount, 'grant_id', 'id')
            Path(folder, 'public.%s.csv' % self.GRANTS).write_text('id,user_id,remaining\nother,h,0\n')
            with self.assertRaisesRegex(seed.SeedConservationError, '1 child keys have no copied parent'):
                seed.conservation(folder, parent, value, child, amount, 'grant_id', 'id')


if __name__ == '__main__':
    unittest.main()
