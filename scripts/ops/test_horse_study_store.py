import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import sqlite3
import unittest
from horse_study_store import initialize,put_hand,put_decision,hand_review,candidates


class StudyStoreTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');self.db.execute('PRAGMA foreign_keys=ON');initialize(self.db)
        put_hand(self.db,{'handId':'h','status':'included','horses':[]},'cash/plo5/table')

    def tearDown(self):self.db.close()

    def item(self,n):
        return {'decisionId':'h:'+str(n),'handId':'h','domain':'cash/plo5/table','street':'river',
            'action':'check','origin':'horse_policy','review':{'candidates':['strong_hand_checkback']}}

    def test_every_decision_retrievable_in_original_order(self):
        put_decision(self.db,self.item(10));put_decision(self.db,self.item(2))
        self.assertEqual([x['decisionId'] for x in hand_review(self.db,'h')['decisions']],['h:2','h:10'])
        self.assertEqual(len(candidates(self.db,'strong_hand_checkback')),2)

    def test_duplicate_or_orphan_cannot_inflate_count(self):
        d=self.item(2);put_decision(self.db,d)
        with self.assertRaises(sqlite3.IntegrityError):put_decision(self.db,d)
        d=self.item(3);d['handId']='missing'
        with self.assertRaises(sqlite3.IntegrityError):put_decision(self.db,d)

    def test_parameterized_lookup_and_named_absence(self):
        with self.assertRaises(ValueError):hand_review(self.db,"h' OR 1=1 --")
        self.assertEqual(candidates(self.db,"x' OR 1=1 --"),[])
        with self.assertRaises(ValueError):candidates(self.db,'x',1001)

    def test_manifest_domain_does_not_mix_cash_tournament_or_variants(self):
        put_decision(self.db,self.item(2))
        other=self.item(3);other['domain']='tournament/plo8/table'
        put_decision(self.db,other)
        found=candidates(self.db,'strong_hand_checkback',domain='cash/plo5/table')
        self.assertEqual([d['decisionId'] for d in found],['h:2'])
        self.assertEqual(candidates(self.db,'strong_hand_checkback',domain='cash/plo6/table'),[])


class MultiVolumeQueryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def volume(self, label, hand, decision):
        folder = self.root / label
        folder.mkdir()
        path = folder / "study.sqlite"
        db = sqlite3.connect(path)
        try:
            initialize(db)
            put_hand(db, {"handId": hand, "status": "included"}, "cash/plo5/table")
            put_decision(db, {"decisionId": decision, "handId": hand, "domain": "cash/plo5/table",
                              "street": "river", "action": "check", "review": {"candidates": ["checkback"]}})
            db.commit()
        finally:
            db.close()
        path.chmod(0o600)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        (folder / "summary.json").write_text(json.dumps({path.name: {"sha256": digest}}))
        return path

    def query(self, paths, *options):
        cli = Path(__file__).with_name("horse-study-query.py")
        args = [part for path in paths for part in ("--database", str(path))]
        return subprocess.run([sys.executable, "-B", str(cli), *args, *options],
                              capture_output=True, text=True)

    def test_reads_each_volume_and_applies_limit_globally(self):
        paths = [self.volume("first", "z", "z:2"), self.volume("second", "a", "a:3")]
        result = self.query(paths, "--candidate", "checkback", "--limit", "1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([r["decisionId"] for r in json.loads(result.stdout)], ["a:3"])
        self.assertEqual(self.query(paths, "--hand", "a").stdout, self.query(paths[1:], "--hand", "a").stdout)
        rows = self.query(paths, "--sql", "SELECT source,hand_id FROM included_hands ORDER BY source")
        self.assertEqual(rows.stdout.splitlines(), ["source\thand_id", "1\tz", "2\ta"])

    def test_refuses_overlap_mutations_and_unverified_secondary_volume(self):
        first = self.volume("first", "z", "z:2")
        for other, refusal in ((self.volume("samehand", "z", "z:3"), "duplicate_hand_id"),
                               (self.volume("samedecision", "a", "z:2"), "duplicate_decision_id")):
            self.assertIn(refusal, self.query([first, other], "--sql", "SELECT 1").stderr)
        target = self.root / "unwanted"
        for sql in ("DELETE FROM volume0.hands", f"ATTACH DATABASE '{target}' AS unwanted",
                    "PRAGMA query_only=OFF"):
            self.assertNotEqual(self.query([first], "--sql", sql).returncode, 0)
        self.assertFalse(target.exists())
        fresh = self.volume("corrupt", "b", "b:1")
        fresh.with_name("summary.json").write_text("{}")
        self.assertIn("database_digest_mismatch", self.query([first, fresh], "--hand", "z").stderr)


if __name__=='__main__':unittest.main()
