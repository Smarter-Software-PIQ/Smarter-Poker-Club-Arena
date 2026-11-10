"""Exercise a miniature frozen cohort in an explicitly supplied SSD scratch directory."""

import gzip
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class Plo56StudyTest(unittest.TestCase):
    def test_price_binding_and_variant_boundaries(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as scratch:
            root = Path(scratch)
            manifest = root / "data-reconciliation"
            manifest.mkdir()
            (manifest / "fixed-cohort-integrity.json").write_text(
                json.dumps(
                    {
                        "volumes": ["sample.sqlite"],
                        "cutoffExclusive": "2026-02-01T00:00:00Z",
                    }
                )
            )
            response = root / "qualification-review/river-responses-v15"
            response.mkdir(parents=True)
            rules = dict(
                format="cash",
                variant="plo5",
                bettingStructure="pot_limit",
                boardCount=1,
                bombPot=False,
                allInOrFold=False,
                speedFormat="table",
                anteType="none",
                ante=0,
                bigBlind=2,
                tournamentStage="cash",
            )
            state = dict(
                seats=[[1, 100, 0, 20, 0, 0, 0], [2, 100, 0, 20, 0, 0, 0]],
                pot=40,
                currentBet=0,
                toCall=0,
                minRaiseTo=2,
                maxRaiseTo=40,
                bigBlind=2,
            )
            hand = dict(
                handId="h", playedAt="2026-01-01T00:00:00Z", humanIds=["opponent"]
            )
            observation = dict(
                handId="h",
                decisionId="h:2",
                heroSeat=1,
                domain="cash/plo5/table",
                playedAt=hand["playedAt"],
                ruleContext=rules,
                betAction="bet",
                betAmount=20,
                expectedOpponentSeats=[2],
                immediateResponse=dict(
                    seat=2, actorClass="human", responseClass="fold"
                ),
                censoredOrUnclassified=False,
                publicNode=state,
            )
            with gzip.open(response / "river-responses.jsonl.gz", "wt") as output:
                output.write(json.dumps(observation) + "\n")
            with sqlite3.connect(root / "sample.sqlite") as db:
                db.execute("CREATE TABLE hands(hand_id TEXT,payload TEXT)")
                db.execute(
                    "CREATE TABLE decisions(hand_id TEXT,domain TEXT,street TEXT,payload TEXT)"
                )
                db.execute("INSERT INTO hands VALUES (?,?)", ("h", json.dumps(hand)))
                for ordinal, street, variant, action in [
                    (1, "flop", "plo5", "call"),
                    (2, "river", "plo5", "bet"),
                    (3, "river", "plo8", "bet"),
                ]:
                    node = dict(state)
                    prior = [
                        dict(stage=street, action="check", seat=2, userId="opponent")
                    ]
                    if street == "flop":
                        node.update(
                            toCall=10, currentBet=10, minRaiseTo=20, maxRaiseTo=60
                        )
                        node["seats"] = [
                            [1, 100, 0, 15, 0, 0, 0],
                            [2, 12, 10, 25, 0, 0, 0],
                        ]
                        prior[0]["action"] = "bet"
                    cards = ["As", "Ac", "Ad", "Kh", "Jh"]
                    info = dict(
                        heroCards=cards,
                        publicState=node,
                        heroSeat=1,
                        priorPublicActions=prior,
                        legalActions=["fold", "call", "raise"]
                        if street == "flop"
                        else ["bet", "check"],
                    )
                    d = dict(
                        handId="h",
                        horseId="horse",
                        decisionId=f"h:{ordinal}",
                        domain=f"cash/{variant}/table",
                        informationSha256=str(ordinal) * 64,
                        informationSet=info,
                        street=street,
                        action=action,
                        amount=10 if street == "flop" else 20,
                        origin="horse_policy",
                        ruleContext={**rules, "variant": variant},
                        review={
                            "facts": {
                                "madeHandsByBoard": [
                                    {
                                        "highCategory": "trips"
                                        if street == "flop"
                                        else "one_pair"
                                    }
                                ]
                            }
                        },
                    )
                    db.execute(
                        "INSERT INTO decisions VALUES (?,?,?,?)",
                        ("h", d["domain"], street, json.dumps(d)),
                    )
            output = root / "output"
            for name, args in [
                (
                    "horse_plo56_initiative_study.py",
                    ["--root", str(root), "--output", str(output)],
                ),
                ("horse_plo56_sensitivity.py", ["--output", str(output)]),
            ]:
                subprocess.run(
                    [sys.executable, "-B", str(HERE / name), *args], check=True
                )
            with gzip.open(output / "individual.jsonl.gz", "rt") as source:
                rows = list(map(json.loads, source))
            self.assertEqual([row["id"] for row in rows], ["h:1", "h:2"])
            self.assertEqual(rows[0]["prices"][0]["maxMatchedExtraChips"], 10)
            self.assertEqual(rows[0]["prices"][-1]["maxHumanMatchedExtraChips"], 12)
            self.assertEqual(
                (output / "individual.jsonl.gz").stat().st_mode & 0o777, 0o600
            )
            self.assertTrue(rows[0]["facingIdentifiedHumanBet"])
            self.assertEqual(rows[0]["nextRecordedOwnStreet"], "river")
            result = json.loads((output / "results.json").read_text())
            self.assertEqual(result["responseObservations"], 1)
            with gzip.open(output / "sensitivity.jsonl.gz", "rt") as f:
                frontiers = list(map(json.loads, f))
            self.assertEqual(len(frontiers), 2)
            self.assertAlmostEqual(
                frontiers[1]["rows"][0]["scenarios"][0]["requiredFoldThreshold"], 2 / 42
            )
            # A second public row for the same wager with a different pot must be rejected.
            observation["publicNode"] = {**state, "pot": 41}
            with gzip.open(response / "river-responses.jsonl.gz", "wt") as f:
                f.write(json.dumps(observation) + "\n")
            subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(HERE / "horse_plo56_initiative_study.py"),
                    "--root",
                    str(root),
                    "--output",
                    str(output),
                ],
                check=True,
            )
            self.assertEqual(
                json.loads((output / "results.json").read_text())[
                    "responseObservations"
                ],
                0,
            )

    def test_redecision_reconciles_small_pot_and_short_all_in(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
            root = Path(directory)
            (root / "data-reconciliation").mkdir()
            (root / "data-reconciliation/fixed-cohort-integrity.json").write_text(
                json.dumps(
                    {"volumes": ["v.sqlite"], "cutoffExclusive": "2026-02-01T00:00:00Z"}
                )
            )
            response = root / "qualification-review/river-responses-v15"
            response.mkdir(parents=True)
            with gzip.open(response / "river-responses.jsonl.gz", "wt"):
                pass
            with sqlite3.connect(root / "v.sqlite") as db:
                db.execute("CREATE TABLE hands(hand_id TEXT,payload TEXT)")
                db.execute(
                    "CREATE TABLE decisions(hand_id TEXT,domain TEXT,street TEXT,payload TEXT)"
                )
                for hand, target, typ, rights in [
                    ("small", 20, "raise", True),
                    ("pot", 70, "raise", True),
                    ("short", 15, "all_in", False),
                    ("mismatch", 20, "raise", True),
                ]:
                    h = dict(
                        handId=hand, playedAt="2026-01-01T00:00:00Z", humanIds=["human"]
                    )
                    db.execute("INSERT INTO hands VALUES (?,?)", (hand, json.dumps(h)))
                    # A third, live player can respond even after the human's short shove.
                    stacks = [
                        [1, 100, 0, 10, 0, 0, 0],
                        [2, 100 if typ != "all_in" else 15, 0, 10, 0, 0, 0],
                        [3, 100, 0, 20, 0, 0, 0],
                    ]
                    check = dict(
                        seat=2, userId="human", stage="flop", action="check", amount=0
                    )
                    bet = dict(
                        seat=1, userId="horse", stage="flop", action="bet", amount=10
                    )
                    response_action = dict(
                        seat=2, userId="human", stage="flop", action=typ, amount=target
                    )
                    result = [list(row) for row in stacks]
                    for seat, amount in [(0, 10), (1, target)]:
                        result[seat][1] -= amount
                        result[seat][2] += amount
                        result[seat][3] += amount
                    if typ == "all_in":
                        result[1][6] = 2
                    for ordinal, prior, pot, cur, price, seats, act, amt, menu in [
                        (1, [check], 40, 0, 0, stacks, "bet", 10, ["check", "bet"]),
                        (
                            3,
                            [check, bet, response_action],
                            50 + target + (hand == "mismatch"),
                            target,
                            target - 10,
                            result,
                            "call",
                            target - 10,
                            ["fold", "call", "raise"] if rights else ["fold", "call"],
                        ),
                    ]:
                        node = dict(
                            pot=pot,
                            seats=seats,
                            bigBlind=2,
                            toCall=price,
                            currentBet=cur,
                            minRaiseTo=2 if not cur else 2 * cur - 10,
                            maxRaiseTo=100,
                        )
                        ctx = dict(
                            variant="plo5",
                            format="cash",
                            speedFormat="table",
                            anteType="none",
                            ante=0,
                            bigBlind=2,
                            tournamentStage="cash",
                            boardCount=1,
                            bombPot=False,
                            allInOrFold=False,
                            bettingStructure="pot_limit",
                        )
                        info = dict(
                            priorPublicActions=prior,
                            heroCards=["As", "Ac", "Kh", "Qd", "Jc"],
                            heroSeat=1,
                            publicState=node,
                            legalActions=menu,
                        )
                        d = dict(
                            handId=hand,
                            decisionId=f"{hand}:{ordinal}",
                            domain="cash/plo5/table",
                            horseId="horse",
                            informationSha256="a" * 64,
                            informationSet=info,
                            ruleContext=ctx,
                            review={
                                "facts": {
                                    "madeHandsByBoard": [{"highCategory": "trips"}]
                                }
                            },
                            origin="horse_policy",
                            street="flop",
                            action=act,
                            amount=amt,
                        )
                        db.execute(
                            "INSERT INTO decisions VALUES (?,?,?,?)",
                            (hand, d["domain"], "flop", json.dumps(d)),
                        )
            output = root / "out"
            subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(HERE / "horse_plo56_initiative_study.py"),
                    "--root",
                    str(root),
                    "--output",
                    str(output),
                ],
                check=True,
            )
            with gzip.open(output / "individual.jsonl.gz", "rt") as f:
                cases = {
                    r["hand"]: r["observedSameStreetRedecision"]
                    for s in f
                    if (r := json.loads(s))["id"].endswith(":1")
                }
            for name, size, price, rights, short in [
                ("small", "small", 10, True, False),
                ("pot", "pot", 60, True, False),
                ("short", "small", 5, False, True),
            ]:
                t = cases[name]
                self.assertEqual(t["lineStatus"], "reconciled")
                self.assertEqual((t["toCall"], t["canMakeFullRaise"]), (price, rights))
                event = t["opposingPriceIncreases"][0]
                self.assertEqual(
                    (event["sizeClass"], event["opponentShortAllIn"]), (size, short)
                )
            self.assertEqual(cases["mismatch"]["lineStatus"], "end_geometry_mismatch")
            self.assertIsNone(cases["mismatch"]["opposingPriceIncreases"])


if __name__ == "__main__":
    unittest.main()
