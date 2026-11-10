"""Frozen descriptive policy screens; no production runtime or private opponent cards."""

import argparse
from datetime import datetime, timezone
from random import Random
import collections as C
import io
import itertools
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import os

os.umask(0o077)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--root", type=Path, required=True, help="frozen study artifact root"
)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
ROOT = args.root.resolve()
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=True)
for filename in (
    "individual.jsonl.gz",
    "river-observed-responses.jsonl.gz",
    "results.json",
):
    path = OUT / filename
    if path.exists():
        path.chmod(0o600)
manifest = json.loads(
    (ROOT / "data-reconciliation/fixed-cohort-integrity.json").read_text()
)
VOLUMES = manifest["volumes"]
cutoff = datetime.fromisoformat(manifest["cutoffExclusive"])
volumeInventory = {}
transitionCounts = C.Counter()
responseSizeCounts = C.Counter()
STRONG = {
    "three_of_a_kind",
    "straight",
    "flush",
    "full_house",
    "four_of_a_kind",
    "straight_flush",
    "trips",
    "quads",
}
weak = {"high_card", "one_pair", "pair"}


def sha(txt):
    return hashlib.sha256(txt.encode()).hexdigest()


def line(f, r):
    f.write(json.dumps(r, separators=(",", ":")) + "\n")


def clean(r):
    return json.loads(r)


def same_street_transition(decision, following):
    """Observe only the line that actually occurred. Do not enter counterfactual EV."""
    if following is None:
        return None
    initial = decision["informationSet"]
    after = following["informationSet"]
    current = initial.get("publicState") or {}
    end = after.get("publicState") or {}
    menu = after.get("legalActions")
    end_hero = next(
        (s for s in end.get("seats", []) if s[0] == after["heroSeat"]), None
    )
    ret = {
        "decisionId": following["decisionId"],
        "informationSha256": following["informationSha256"],
        "observedAction": following["action"],
        "observedAmount": following["amount"],
        "origin": following["origin"],
        "pot": end.get("pot"),
        "toCall": end.get("toCall"),
        "minRaiseTo": end.get("minRaiseTo"),
        "maxRaiseTo": end.get("maxRaiseTo"),
        "currentBet": end.get("currentBet"),
        "legalActions": menu,
        "canMakeFullRaise": None if menu is None else "raise" in menu,
        "canRaiseAllIn": None
        if menu is None or end_hero is None or end.get("currentBet") is None
        else ("all_in" in menu and end_hero[1] + end_hero[2] > end["currentBet"]),
        "lineStatus": "missing_public_wager_geometry",
        "opposingPriceIncreases": None,
    }
    if any(
        node.get(k) is None
        for node in (current, end)
        for k in ("pot", "currentBet", "seats")
    ):
        return ret
    prior = initial["priorPublicActions"]
    later = after["priorPublicActions"]
    start = int(decision["decisionId"].rsplit(":", 1)[1])
    stop = int(following["decisionId"].rsplit(":", 1)[1])
    if len(prior) != start or len(later) != stop or later[:start] != prior:
        ret["lineStatus"] = "prior_prefix_unbound"
        return ret
    moves = later[start:stop]
    if (
        not moves
        or moves[0].get("userId") != decision["horseId"]
        or moves[0].get("action") != decision["action"]
        or moves[0].get("amount") != decision["amount"]
    ):
        ret["lineStatus"] = "original_action_unbound"
        return ret
    bets = {seat[0]: seat[2] for seat in current["seats"]}
    pot = current["pot"]
    price = current["currentBet"]
    minimum = current.get("minRaiseTo")
    increment = minimum - price if minimum is not None and minimum > price else None
    raises = []
    tol = 0.00001
    for ordinal, a in enumerate(moves, start):
        typ = a.get("action")
        seat = a.get("seat")
        amount = a.get("amount", 0)
        if (
            seat not in bets
            or a.get("stage") != decision["street"]
            or typ not in ("bet", "raise", "all_in", "call", "check", "fold")
        ):
            ret["lineStatus"] = "unsupported_intervening_action"
            return ret
        before = bets[seat]
        target = before
        if typ == "call":
            target = before + amount
        elif typ in ("bet", "raise", "all_in"):
            target = amount
        if target < before - tol:
            ret["lineStatus"] = "nonmonotone_wager"
            return ret
        if target > price + tol:
            increase = target - price
            pot_after_call = pot + max(0, price - before)
            fraction = increase / pot_after_call if pot_after_call > 0 else None
            short = None if increment is None else increase + tol < increment
            size = (
                "unknown"
                if fraction is None
                else "pot"
                if abs(increase - pot_after_call) <= tol
                else "above_pot"
                if fraction > 1
                else "small"
                if fraction <= 0.5
                else "over_half_under_pot"
            )
            if ordinal != start and seat != initial["heroSeat"]:
                raises.append(
                    {
                        "ordinal": ordinal,
                        "action": typ,
                        "oldPrice": price,
                        "newPrice": target,
                        "amountBeyondPreviousPrice": increase,
                        "potAfterCalling": pot_after_call,
                        "raiseFractionOfPotAfterCalling": fraction,
                        "sizeClass": size,
                        "belowFullRaiseIncrement": short,
                        "opponentShortAllIn": typ == "all_in" and short is True,
                        "priorWagerPresent": price > 0,
                    }
                )
            if short is False or price == 0:
                increment = increase
            price = target
        pot += target - before
        bets[seat] = target
    if (
        abs(price - end["currentBet"]) > tol
        or abs(pot - end["pot"]) > tol
        or any(
            abs(bets.get(seat[0], float("inf")) - seat[2]) > tol
            for seat in end["seats"]
        )
    ):
        ret["lineStatus"] = "end_geometry_mismatch"
        return ret
    ret["lineStatus"] = "reconciled"
    ret["opposingPriceIncreases"] = raises
    return ret


river_src = ROOT / "qualification-review/river-responses-v15/river-responses.jsonl.gz"
resp = {}
for s in gzip.open(river_src, "rt"):
    r = clean(s)
    ctx = r["ruleContext"]
    if ctx["variant"] not in ("plo5", "plo6") or ctx["format"] != "cash":
        continue
    ir = r.get("immediateResponse") or {}
    seats = r.get("expectedOpponentSeats") or []
    if (
        len(seats) == 1
        and ir.get("seat") == seats[0]
        and ir.get("actorClass") == "human"
        and ir.get("responseClass") in ("fold", "call", "raise")
        and not r["censoredOrUnclassified"]
        and r["betAction"] == "bet"
    ):
        resp[r["decisionId"]] = r
totals = C.Counter()
eligibility = C.Counter()
observations = []
seen = set()
examples = {}
screens = []
sql = """SELECT h.payload,d.payload FROM decisions d JOIN hands h USING(hand_id)
       WHERE (d.domain LIKE '%/plo5/%' OR d.domain LIKE '%/plo6/%') AND d.street IN ('flop','turn','river')
       ORDER BY d.hand_id"""
with io.TextIOWrapper(
    gzip.GzipFile(filename=OUT / "individual.jsonl.gz", mode="wb", mtime=0),
    encoding="utf-8",
) as dest:
    for vol in VOLUMES:
        volumeInventory[vol] = {
            "targetHands": 0,
            "targetDecisions": 0,
            "earliestUtc": None,
            "latestUtc": None,
            "historicalRosterPresent": 0,
        }
        inv = volumeInventory[vol]
        db = sqlite3.connect((ROOT / vol).as_uri() + "?mode=ro&immutable=1", uri=True)
        for _, group in itertools.groupby(
            db.execute(sql), key=lambda pair: clean(pair[1])["handId"]
        ):
            grouped = list(group)
            h = clean(grouped[0][0])
            ds = sorted(
                (clean(pair[1]) for pair in grouped),
                key=lambda d: int(d["decisionId"].rsplit(":", 1)[1]),
            )
            stamp = datetime.fromisoformat(h["playedAt"])
            assert stamp.tzinfo is not None and stamp < cutoff
            utc = stamp.astimezone(timezone.utc).isoformat(timespec="microseconds")
            inv["targetHands"] += 1
            inv["targetDecisions"] += len(ds)
            inv["earliestUtc"] = min(utc, inv["earliestUtc"] or utc)
            inv["latestUtc"] = max(utc, inv["latestUtc"] or utc)
            inv["historicalRosterPresent"] += bool(
                (h.get("acquisition") or {}).get("historicalRosterPresent")
            )
            humans = set(h["humanIds"])
            assert not humans.intersection(h.get("horseIds", []))
            for pos, d in enumerate(ds):
                k = d["decisionId"]
                assert k not in seen
                seen.add(k)
                i = d["informationSet"]
                ctx = d["ruleContext"]
                n = i.get("publicState") or {}
                v = ctx["variant"]
                st = d["street"]
                dom = d["domain"]
                act = d["action"]
                bucket = f"{dom}/{st}"
                totals[bucket] += 1

                def exclude(reason):
                    eligibility[bucket + "|" + reason] += 1

                if d["origin"] != "horse_policy":
                    exclude("outside_original_policy")
                    continue
                if (
                    ctx["bettingStructure"] != "pot_limit"
                    or ctx["boardCount"] != 1
                    or ctx["bombPot"] is not False
                    or ctx["allInOrFold"] is not False
                ):
                    exclude("outside_ordinary_single_board")
                    continue
                if (
                    not n.get("seats")
                    or not i.get("heroCards")
                    or len(i["heroCards"]) != int(v[-1])
                ):
                    exclude("missing_private_cards_or_public_node")
                    continue
                seats = {
                    a["seat"]: a["userId"]
                    for a in i["priorPublicActions"]
                    if a.get("userId")
                }
                hero = next((s for s in n["seats"] if s[0] == i["heroSeat"]), None)
                live = [
                    s for s in n["seats"] if hero and s[0] != hero[0] and not s[6] & 1
                ]
                wagerable = [s for s in live if not s[6] & 6 and s[1] > 0]
                hm = [s for s in wagerable if seats.get(s[0]) in humans]
                if not hm:
                    exclude("no_identified_human_with_chips")
                    continue
                if not hero or not n.get("pot", 0) > 0 or not n.get("bigBlind", 0) > 0:
                    exclude("unpriced")
                    continue
                eligibility[bucket + "|included"] += 1
                fact = d["review"]["facts"]
                made = (fact.get("madeHandsByBoard") or [{}])[0].get("highCategory")
                menu = i.get("legalActions") or []
                pot = n["pot"]
                bb = n["bigBlind"]
                call = min(n["toCall"], hero[1])
                cur = n["currentBet"]
                base = hero[2] + call
                aggression = "raise" if call else "bet"
                prior = [
                    a
                    for a in i["priorPublicActions"]
                    if a["stage"] == st and a["action"] in ("bet", "raise", "all_in")
                ]
                past = [
                    a
                    for a in i["priorPublicActions"]
                    if a["stage"] != st and a["action"] in ("bet", "raise")
                ]
                knownBettor = bool(
                    prior
                    and prior[-1]["action"] in ("bet", "raise")
                    and prior[-1].get("userId") in humans
                    and any(s[0] == prior[-1]["seat"] and s[2] == cur for s in live)
                )
                category = (
                    ("strong_facing_wager" if call else "strong_open_bet")
                    if made in STRONG
                    else (
                        "weak_river_open"
                        if not call and st == "river" and made in weak
                        else "other"
                    )
                )
                if not made and category == "other":
                    category = "unknown_hand_category"
                targets = []
                if (
                    aggression in menu
                    and n.get("minRaiseTo") is not None
                    and n.get("maxRaiseTo") is not None
                    and base
                    < n["minRaiseTo"]
                    <= n["maxRaiseTo"]
                    <= hero[1] + hero[2] + 0.00001
                ):
                    targets += [n["minRaiseTo"], n["maxRaiseTo"]]
                cap = hero[1] + hero[2]
                if (
                    "all_in" in menu
                    and cap > base
                    and n.get("maxRaiseTo") is not None
                    and cap <= n["maxRaiseTo"] + 0.00001
                ):
                    targets.append(cap)
                hu = len(live) == 1
                # All-in side pots and unmatched contributions invalidate single-pot utility formulas.
                tolerance = 0.00001
                hero_total_at_call = hero[3] + call
                single_pot = bool(
                    hu
                    and abs(sum(seat[3] for seat in n["seats"]) - pot) <= tolerance
                    and all(
                        seat[3] <= hero_total_at_call + tolerance for seat in n["seats"]
                    )
                    and abs(
                        hero_total_at_call - (live[0][3] + max(0, base - live[0][2]))
                    )
                    <= tolerance
                )
                priced = []
                for target in sorted(set(targets)):
                    extra = target - base
                    maxmatch = max(
                        (max(0, s[1] + s[2] - base) for s in wagerable), default=0
                    )
                    matched = min(extra, maxmatch)
                    human_match = min(
                        extra, max(max(0, s[1] + s[2] - base) for s in hm)
                    )
                    if matched <= 0:
                        continue
                    priced.append(
                        dict(
                            to=target,
                            extraChips=extra,
                            maxMatchedExtraChips=matched,
                            maxHumanMatchedExtraChips=human_match,
                            extraBB=extra / bb,
                            # A zero-showdown-equity opening bet with zero check EV; fold earns the entire pot, a call loses even unmatched-excess-adjusted risk.
                            pureBluffBreakEvenFoldFraction=(matched / (pot + matched))
                            if single_pot and not call and st == "river"
                            else None,
                        )
                    )
                following = next(
                    (
                        x
                        for x in ds[pos + 1 :]
                        if x["horseId"] == d["horseId"] and x["street"] == st
                    ),
                    None,
                )
                transition = same_street_transition(d, following)
                transitionCounts[
                    (
                        dom,
                        st,
                        transition["lineStatus"]
                        if transition
                        else "no_subsequent_own_same_street_decision",
                    )
                ] += 1
                if transition and transition["lineStatus"] == "reconciled":
                    for increase in transition["opposingPriceIncreases"]:
                        responseSizeCounts[
                            (
                                dom,
                                st,
                                increase["sizeClass"],
                                "short_all_in"
                                if increase["opponentShortAllIn"]
                                else "other",
                                str(transition["canMakeFullRaise"]),
                                transition["observedAction"],
                            )
                        ] += 1
                nxt = next(
                    (
                        x
                        for x in ds[pos + 1 :]
                        if x["horseId"] == d["horseId"] and x["street"] != st
                    ),
                    None,
                )
                row = dict(
                    id=k,
                    info=d["informationSha256"],
                    hand=h["handId"],
                    original=vol,
                    utc=utc,
                    domain=dom,
                    street=st,
                    ante=ctx["anteType"],
                    anteAmount=ctx["ante"],
                    bb=bb,
                    tournamentStage=ctx["tournamentStage"],
                    human=[sha(seats[s[0]]) for s in hm],
                    liveOpponents=len(live),
                    singlePotReconciled=single_pot,
                    facingIdentifiedHumanBet=knownBettor,
                    priorStreetLastBetOrRaiseByHorse=None
                    if not past
                    else past[-1].get("userId") == d["horseId"],
                    recordedAction=act,
                    made=made,
                    category=category,
                    pot=pot,
                    call=call,
                    legalMenu=menu,
                    prices=priced,
                    observedSameStreetRedecision=transition,
                    nextRecordedOwnStreet=nxt["street"] if nxt else None,
                    nextRecordedOwnAction=nxt["action"] if nxt else None,
                )
                if (
                    priced
                    and category != "other"
                    and category != "unknown_hand_category"
                ):
                    screens.append(
                        (
                            dom,
                            st,
                            category,
                            act,
                            priced[0]["maxHumanMatchedExtraChips"] / bb,
                            knownBettor,
                        )
                    )
                old = resp.get(k)
                # Response belongs to the original public wager. Private information hashes can change
                # between study revisions; verify the exact public inputs used for the response join.
                matched = bool(
                    old
                    and old["handId"] == h["handId"]
                    and old["domain"] == dom
                    and old["playedAt"] == h["playedAt"]
                    and old["heroSeat"] == hero[0]
                    and old["betAmount"] == d["amount"]
                    and old["expectedOpponentSeats"] == [hm[0][0]]
                    and old["immediateResponse"]["seat"] == hm[0][0]
                    and all(
                        n.get(field) == val for field, val in old["publicNode"].items()
                    )
                    and all(
                        old["ruleContext"].get(key) == ctx.get(key)
                        for key in (
                            "format",
                            "variant",
                            "speedFormat",
                            "anteType",
                            "ante",
                            "bigBlind",
                            "bettingStructure",
                        )
                    )
                )
                if hu and st == "river" and matched and d["action"] == "bet":
                    frac = d["amount"] / pot
                    observations.append(
                        dict(
                            hand=h["handId"],
                            id=k,
                            utc=utc,
                            opponent=row["human"][0],
                            domain=dom,
                            ante=ctx["anteType"],
                            anteAmount=ctx["ante"],
                            bb=bb,
                            frac=frac,
                            size="small"
                            if frac <= 0.5
                            else "medium"
                            if frac <= 0.75
                            else "large",
                            fold=int(
                                old["immediateResponse"]["responseClass"] == "fold"
                            ),
                            response=old["immediateResponse"]["responseClass"],
                        )
                    )
                line(dest, row)
        db.close()


def fold_scores(train, test):
    def group(r):
        return (r["domain"], r["ante"], r["anteAmount"], r["bb"])

    cells = C.defaultdict(list)
    domains = C.defaultdict(list)
    for r in train:
        cells[group(r), r["size"]].append(r["fold"])
        domains[group(r)].append(r["fold"])
    scored = []
    for r in test:
        c = cells.get((group(r), r["size"]))
        b = domains.get(group(r))
        if not c or not b:
            continue
        pr = (sum(c) + 1) / (len(c) + 2)
        base = (sum(b) + 1) / (len(b) + 2)
        scored.append((r, (pr - r["fold"]) ** 2, (base - r["fold"]) ** 2, pr))
    clusters = C.defaultdict(list)
    for row, model_loss, base_loss, _ in scored:
        clusters[row["opponent"]].append(model_loss - base_loss)
    interval = None
    if len(clusters) >= 2:
        rng = Random(20261108)
        totals_by_opponent = [
            (sum(values), len(values)) for _, values in sorted(clusters.items())
        ]
        deltas = []
        for _ in range(2000):
            sampled = rng.choices(totals_by_opponent, k=len(totals_by_opponent))
            deltas.append(sum(t for t, n in sampled) / sum(n for t, n in sampled))
        deltas.sort()
        interval = [deltas[49], deltas[1949]]
    return dict(
        pairedOpponentClusterBootstrap95=interval,
        train=len(train),
        test=len(test),
        scored=len(scored),
        uniqueScoredOpponents=len({x[0]["opponent"] for x in scored}),
        brier=sum(x[1] for x in scored) / len(scored) if scored else None,
        baselineBrier=sum(x[2] for x in scored) / len(scored) if scored else None,
        counterexamples=[
            {"id": r["id"], "prediction": pr, "fold": r["fold"], "domain": r["domain"]}
            for r, loss, _, pr in sorted(scored, key=lambda z: -z[1])[:5]
        ],
    )


observations.sort(key=lambda x: x["utc"])
times = sorted({r["utc"] for r in observations})
cut = times[len(times) * 2 // 3] if times else ""
train = [r for r in observations if r["utc"] < cut]
test = [r for r in observations if r["utc"] >= cut]
known = {r["opponent"] for r in train}
assert not {r["hand"] for r in train} & {r["hand"] for r in test}
# Independent identity split fixed by the first byte of each pseudonymous opponent's SHA.
ho = {r["opponent"] for r in observations if int(r["opponent"][:2], 16) % 3 == 0}
rank = C.defaultdict(
    lambda: dict(n=0, passive=0, passiveContestableBB=0, largestPassiveContestableBB=0)
)
for dom, st, c, a, amt, humanWager in screens:
    key = "|".join([dom, st, c, "human_wager" if humanWager else "human_live"])
    b = rank[key]
    b["n"] += 1
    if a in ("call", "check", "fold"):
        b["passive"] += 1
        b["passiveContestableBB"] += amt
        b["largestPassiveContestableBB"] = max(b["largestPassiveContestableBB"], amt)
out = dict(
    inputVolumes=VOLUMES,
    cutoffExclusive=manifest["cutoffExclusive"],
    perVolume=volumeInventory,
    sameStreetTransitionCounts={
        "|".join(k): v for k, v in sorted(transitionCounts.items())
    },
    sameStreetResponseSizeCounts={
        "|".join(k): v for k, v in sorted(responseSizeCounts.items())
    },
    observedRiverResponseSourceSha256=hashlib.sha256(
        river_src.read_bytes()
    ).hexdigest(),
    denominator=totals,
    byVariantLaterUnseen={
        variant: fold_scores(
            [r for r in train if r["domain"].split("/")[1] == variant],
            [
                r
                for r in test
                if r["domain"].split("/")[1] == variant and r["opponent"] not in known
            ],
        )
        for variant in ("plo5", "plo6")
    },
    eligibility=eligibility,
    ranking=sorted(rank.items(), key=lambda x: -x[1]["passiveContestableBB"]),
    responseObservations=len(observations),
    opponents=len({r["opponent"] for r in observations}),
    utcCut=cut,
    time=fold_scores(train, test),
    newOpponentAndTime=fold_scores(
        train, [r for r in test if r["opponent"] not in known]
    ),
    opponentOnly=fold_scores(
        [r for r in observations if r["opponent"] not in ho],
        [r for r in observations if r["opponent"] in ho],
    ),
)
(OUT / "results.json").write_text(json.dumps(out, indent=2) + "\n")
with io.TextIOWrapper(
    gzip.GzipFile(
        filename=OUT / "river-observed-responses.jsonl.gz", mode="wb", mtime=0
    ),
    encoding="utf-8",
) as f:
    for r in observations:
        line(f, r)
