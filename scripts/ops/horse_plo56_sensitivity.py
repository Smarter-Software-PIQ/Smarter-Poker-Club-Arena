"""Conditional zero-future-investment chip comparisons. Scenarios are not equity estimates."""

import collections as C
import gzip
import io
import json
from pathlib import Path
import argparse
import sqlite3
import os

os.umask(0o077)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument(
    "--root",
    type=Path,
    help="frozen study root, for exact one-card continuation maps on worked examples",
)
args = parser.parse_args()
p = args.output.resolve()
for filename in ("sensitivity.jsonl.gz", "sensitivity-summary.json"):
    path = p / filename
    if path.exists():
        path.chmod(0o600)
summary = C.Counter()
examples = {}
observed = C.defaultdict(C.Counter)


def relative(pot, call, extra, call_equity, raise_equity):
    # The same dead pot and call cost appear in both observed alternatives.
    call_ev = call_equity * (pot + call) - call
    continued = raise_equity * (pot + call + 2 * extra) - (call + extra)
    slope = pot - continued
    if slope == 0:
        threshold = None
        condition = "all" if continued >= call_ev else "none"
    else:
        threshold = (call_ev - continued) / slope
        condition = "at_or_above" if slope > 0 else "at_or_below"
    return dict(
        callEquity=call_equity,
        calledRaiseEquity=raise_equity,
        callEV=call_ev,
        calledRaiseEV=continued,
        foldWinEV=pot,
        requiredFoldThreshold=threshold,
        condition=condition,
    )


with io.TextIOWrapper(
    gzip.GzipFile(filename=p / "sensitivity.jsonl.gz", mode="wb", mtime=0),
    encoding="utf-8",
) as out:
    for line in gzip.open(p / "individual.jsonl.gz", "rt"):
        r = json.loads(line)
        k = r["category"]
        if not r["prices"] or k in ("unknown_hand_category", "other"):
            continue
        context = (r["domain"], r["street"], k)
        observed[context][f"original_{r['recordedAction']}"] += 1
        if r["nextRecordedOwnStreet"]:
            observed[context]["next_recorded_" + r["nextRecordedOwnStreet"]] += 1
        else:
            observed[context]["no_later_recorded_own_decision"] += 1
        if r["liveOpponents"] != 1:
            summary["multiway_no_joint_model"] += 1
            continue
        if not r["singlePotReconciled"]:
            summary["sidepot_or_contribution_not_reconciled"] += 1
            continue
        v = r["domain"].split("/")[1]
        rows = []
        for t in r["prices"]:
            risk = t["maxMatchedExtraChips"]
            before = r["pot"]
            a = r["call"]
            if a > 0:
                if not r["facingIdentifiedHumanBet"]:
                    continue
                # Compare a fixed base equity against progressively stronger continuing ranges.
                # For nonterminal streets, all remaining streets must check through without investment.
                params = [
                    (0.35, 0.20),
                    (0.50, 0.35),
                    (0.65, 0.50),
                    (0.80, 0.65),
                    (0.80, 0.80),
                ]
                prices = [relative(before, a, risk, x, y) for x, y in params]
            else:
                # Model check-to-showdown without further action. A human fold to a bet wins P.
                # Conditional equities describe subranges that would fold or continue to this size.
                prices = []
                for ef, ec in [
                    (0.0, 0.0),
                    (0.25, 0.15),
                    (0.70, 0.40),
                    (0.90, 0.50),
                    (0.95, 0.65),
                    (0.98, 0.85),
                ]:
                    fold_gain = before * (1 - ef)
                    called_gain = risk * (2 * ec - 1)
                    den = fold_gain - called_gain
                    prices.append(
                        dict(
                            equityVsFoldingRange=ef,
                            equityVsContinuingRange=ec,
                            deltaWhenFold=fold_gain,
                            deltaWhenCalled=called_gain,
                            requiredFoldThreshold=None
                            if den == 0
                            else -called_gain / den,
                            condition="all"
                            if den == 0 and called_gain >= 0
                            else "none"
                            if den == 0
                            else "at_or_above"
                            if den > 0
                            else "at_or_below",
                        )
                    )
            rows.append(dict(raiseOrBetTo=t["to"], matchedExtra=risk, scenarios=prices))
        if not rows:
            continue
        key = "|".join(context)
        summary[key] += 1
        data = dict(
            id=r["id"],
            volume=r["original"],
            info=r["info"],
            domain=r["domain"],
            street=r["street"],
            category=k,
            observed=r["recordedAction"],
            made=r["made"],
            pot=r["pot"],
            call=r["call"],
            bb=r["bb"],
            stage=r["tournamentStage"],
            rows=rows,
        )
        if (v, r["street"], k) not in examples or (
            r["recordedAction"] in ("call", "check")
            and r["prices"][0]["extraBB"] > examples[v, r["street"], k][0]
        ):
            examples[v, r["street"], k] = (r["prices"][0]["extraBB"], data)
        out.write(json.dumps(data, separators=(",", ":")) + "\n")
report = dict(
    screens=summary,
    observedContinuation={"|".join(k): v for k, v in observed.items()},
    workedExamples=[r for _, r in examples.values()],
)
if args.root:
    from omaha_reference import card, omaha

    names = (
        "high_card",
        "one_pair",
        "two_pair",
        "trips",
        "straight",
        "flush",
        "full_house",
        "quads",
        "straight_flush",
    )
    for example in report["workedExamples"]:
        if (
            example["street"] not in ("flop", "turn")
            or example["category"] != "strong_facing_wager"
        ):
            continue
        with sqlite3.connect(
            (args.root.resolve() / example["volume"]).as_uri() + "?mode=ro&immutable=1",
            uri=True,
        ) as db:
            original = json.loads(
                db.execute(
                    "SELECT payload FROM decisions WHERE decision_id=?",
                    (example["id"],),
                ).fetchone()[0]
            )
        assert original["informationSha256"] == example["info"]
        info = original["informationSet"]
        own = [card(c) for c in info["heroCards"]]
        raw = info["publicState"]["boards"][0]
        board = [raw[i : i + 2] for i in range(0, len(raw), 2)]
        variant = example["domain"].split("/")[1]
        assert variant in ("plo5", "plo6")
        available = [
            r + s for r in "23456789TJQKA" for s in "cdhs" if r + s not in own + board
        ]
        next_categories = C.Counter(
            names[omaha(own, board + [c], variant)[0][0]] for c in available
        )
        assert sum(next_categories.values()) == 52 - len(own) - len(board)
        example["allNextCardsFromKnownHeroAndBoard"] = dict(next_categories)
(p / "sensitivity-summary.json").write_text(json.dumps(report, indent=2) + "\n")
