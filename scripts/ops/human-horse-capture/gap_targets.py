#!/usr/bin/env python3
"""gap_targets.py: targeted missing-spot hand-key selector and classifier.

Identifies committed human-vs-Horse hands matching the six under-observed
spot classes for targeted extraction and blind review:
  (a) non_top_human_hu_flop_first_bet: HU on flop where a non-top human makes
      the first flop bet (>=30/human across >=3 non-top humans target).
  (b) turn_second_barrel_after_flop_call: human bets flop, Horse calls, and
      the same human bets again on the turn.
  (c) checked_to_river_bet: flop or turn checks through and a bet (human or
      Horse stab) occurs on the river after a checked-to line.
  (d) human_reraise_vs_horse_3bet_or_4bet: preflop or postflop sequence where
      a Horse 3-bets/4-bets and a human re-raises over it.
  (e) rare_human_cell: human-facing hand in `plo6`, `lightning` mode,
      heads-up (`hu` / 2-max) table, or `fixed_limit`.
  (f) double_board_bomb_pot_showdown: double-board bomb pot reaching showdown.

Attributes each hand's engine build via `build_attribution.attribute_hand_build`
(`hand_history.engine_build` with `ca_engine_deploy_attempts` fallback).
"""
import collections
import json
import os
import re
import sys
from pathlib import Path

import build_attribution

AGG_ACTIONS = {'bet', 'raise', 'allin', 'all_in', 'all-in'}
CALL_ACTIONS = {'call'}
CHECK_ACTIONS = {'check'}
FIXED_LIMIT_VARIANTS = {
    'flh',
    'fixed_limit',
    'limit_holdem',
    'limit_omaha',
    'flo',
    'flo8',
    'stud',
    'stud8',
    'razz',
}


def _norm_action(act: dict) -> str:
    return str(act.get('action') or '').strip().lower()


def _norm_stage(act: dict) -> str:
    return str(act.get('stage') or act.get('street') or '').strip().lower()


def _actor_id(act: dict) -> str:
    return str(act.get('userId') or act.get('user_id') or act.get('actorId') or '').strip()


def classify_hand_spots(
    hand: dict,
    top_human_id: str | None = None,
) -> list[str]:
    """Pure offline classifier returning sorted spot tags matched by `hand`."""
    human_ids = {str(u) for u in (hand.get('human_user_ids') or hand.get('humanUserIds') or []) if u}
    horse_ids = {str(u) for u in (hand.get('horse_user_ids') or hand.get('horseUserIds') or []) if u}
    actions = [
        a for a in (hand.get('actions') or [])
        if isinstance(a, dict) and not a.get('dead') and _actor_id(a) != 'system'
    ]
    if not human_ids and not hand.get('has_human') and not hand.get('hasHuman'):
        return []

    tags = set()
    variant = str(hand.get('game_variant') or hand.get('variant') or '').strip().lower()
    mode = str(hand.get('game_mode') or hand.get('mode') or '').strip().lower()
    betting = str(hand.get('betting_structure') or hand.get('bettingStructure') or '').strip().lower()
    max_players = hand.get('max_players') or hand.get('maxPlayers')
    dealt_count = hand.get('dealt_count') or hand.get('dealtCount')
    is_hu_table = (
        (max_players is not None and int(max_players) == 2)
        or mode in ('hu', 'heads_up')
        or bool(hand.get('is_heads_up') or hand.get('isHeadsUp'))
    )
    is_lightning = bool(
        mode == 'lightning'
        or hand.get('is_lightning')
        or hand.get('isLightning')
        or 'lightning' in variant
    )
    is_fixed_limit = bool(
        betting in ('fixed_limit', 'limit')
        or variant in FIXED_LIMIT_VARIANTS
        or variant.startswith('fl_')
        or variant.endswith('_limit')
    )

    # (e) Rare human cells: plo6, lightning, hu table, or fixed_limit
    if variant == 'plo6' or is_lightning or is_hu_table or is_fixed_limit:
        tags.add('rare_human_cell')

    # (f) Double-board bomb pot reaching showdown
    is_bomb_pot = bool(
        hand.get('is_bomb_pot')
        or hand.get('isBombPot')
        or mode == 'bomb_pot'
        or any(_norm_action(a) in ('bomb_pot_ante', 'bomb_ante') for a in (hand.get('actions') or []) if isinstance(a, dict))
    )
    board_count = int(hand.get('board_count') or hand.get('boardCount') or (2 if hand.get('second_board') or hand.get('board2') else 1))
    reached_showdown = bool(
        hand.get('went_to_showdown')
        or hand.get('wentToShowdown')
        or hand.get('reached_showdown')
        or any(_norm_stage(a) == 'showdown' for a in (hand.get('actions') or []) if isinstance(a, dict))
    )
    if is_bomb_pot and board_count >= 2 and reached_showdown:
        tags.add('double_board_bomb_pot_showdown')

    by_stage: dict[str, list[dict]] = collections.defaultdict(list)
    for a in actions:
        by_stage[_norm_stage(a)].append(a)

    # Track active players entering flop to identify heads-up flop spots
    folded_preflop = {
        _actor_id(a)
        for a in by_stage.get('preflop', [])
        if _norm_action(a) == 'fold' and _actor_id(a)
    }
    known_players = set(human_ids) | set(horse_ids) | {_actor_id(a) for a in actions if _actor_id(a)}
    flop_players = (known_players - folded_preflop) if known_players else set()
    flop_acts = by_stage.get('flop', [])
    flop_actors = {_actor_id(a) for a in flop_acts if _actor_id(a)}
    hu_on_flop = (
        len(flop_players) == 2
        if (dealt_count is None or len(known_players) >= int(dealt_count)) and flop_players
        else len(flop_actors) == 2
    )

    first_flop_bettor = None
    flop_bet_called_by_horse = False
    for a in flop_acts:
        act = _norm_action(a)
        uid = _actor_id(a)
        if first_flop_bettor is None and act in AGG_ACTIONS:
            first_flop_bettor = uid
        elif first_flop_bettor is not None and act in CALL_ACTIONS:
            if (horse_ids and uid in horse_ids) or (human_ids and uid not in human_ids):
                flop_bet_called_by_horse = True

    # (a) Non-top-human HU flop first bet
    if (
        hu_on_flop
        and first_flop_bettor
        and first_flop_bettor in human_ids
        and (top_human_id is None or first_flop_bettor != top_human_id)
    ):
        tags.add('non_top_human_hu_flop_first_bet')

    # (b) Turn second-barrel after called flop bet
    turn_acts = by_stage.get('turn', [])
    if first_flop_bettor and first_flop_bettor in human_ids and flop_bet_called_by_horse:
        for a in turn_acts:
            act = _norm_action(a)
            uid = _actor_id(a)
            if act in AGG_ACTIONS:
                if uid == first_flop_bettor:
                    tags.add('turn_second_barrel_after_flop_call')
                break

    # (c) Checked-to river bets & Horse river stabs
    river_acts = by_stage.get('river', [])
    turn_checked_through = bool(turn_acts) and all(_norm_action(a) in CHECK_ACTIONS for a in turn_acts)
    if river_acts:
        first_river_agg_idx = next(
            (idx for idx, a in enumerate(river_acts) if _norm_action(a) in AGG_ACTIONS),
            None,
        )
        if first_river_agg_idx is not None:
            prior_river_checks = all(
                _norm_action(a) in CHECK_ACTIONS for a in river_acts[:first_river_agg_idx]
            )
            if prior_river_checks and (turn_checked_through or first_river_agg_idx >= 1):
                tags.add('checked_to_river_bet')

    # (d) Human re-raises vs Horse 3-bet or 4-bet
    for stage_name, st_acts in by_stage.items():
        agg_seq = [a for a in st_acts if _norm_action(a) in AGG_ACTIONS]
        # Preflop blinds count as 1st level; first preflop raise = 2-bet, second = 3-bet, third = 4-bet.
        # Postflop: first bet = 1-bet, raise = 2-bet, re-raise = 3-bet.
        min_horse_idx = 1 if stage_name == 'preflop' else 2
        for idx, a in enumerate(agg_seq):
            uid = _actor_id(a)
            is_horse = (uid in horse_ids) if horse_ids else (bool(human_ids) and uid not in human_ids)
            if idx >= min_horse_idx and is_horse:
                if any(_actor_id(later) in human_ids for later in agg_seq[idx + 1 :]):
                    tags.add('human_reraise_vs_horse_3bet_or_4bet')
                    break

    return sorted(tags)


def select_gap_targets(
    hands: list[dict],
    boundaries: list[dict] | None = None,
    min_non_top_humans: int = 3,
    target_per_human_hu_flop: int = 30,
) -> dict:
    """Rank and summarize gap-target hands with build attribution and non-top-human quotas."""
    human_hand_counts: collections.Counter = collections.Counter()
    for h in hands:
        for u in (h.get('human_user_ids') or h.get('humanUserIds') or []):
            if u:
                human_hand_counts[str(u)] += 1
    top_human_id = human_hand_counts.most_common(1)[0][0] if human_hand_counts else None

    norm_bounds = build_attribution.normalize_boundaries(boundaries or [])
    by_tag_counts: collections.Counter = collections.Counter()
    non_top_hu_by_human: collections.Counter = collections.Counter()
    selected_hands = []

    for h in hands:
        tags = classify_hand_spots(h, top_human_id=top_human_id)
        if not tags:
            continue
        hid = str(h.get('id') or h.get('hand_id') or h.get('h') or '')
        key = h.get('key') or h.get('k')
        b_sha, b_src = build_attribution.attribute_hand_build(h, norm_bounds)

        for t in tags:
            by_tag_counts[t] += 1
        if 'non_top_human_hu_flop_first_bet' in tags:
            for u in (h.get('human_user_ids') or h.get('humanUserIds') or []):
                if str(u) != top_human_id:
                    non_top_hu_by_human[str(u)] += 1

        selected_hands.append({
            'h': hid,
            'k': key,
            'handNumber': h.get('hand_number') or h.get('handNumber'),
            'variant': h.get('game_variant') or h.get('variant'),
            'mode': h.get('game_mode') or h.get('mode'),
            'engineBuild': b_sha,
            'attributionSource': b_src,
            'spots': tags,
        })

    qualifying_non_top = sum(
        1 for _, cnt in non_top_hu_by_human.items() if cnt >= target_per_human_hu_flop
    )
    return {
        'version': 1,
        'totalInputHands': len(hands),
        'selectedHands': len(selected_hands),
        'topHumanPresent': top_human_id is not None,
        'spotCounts': dict(sorted(by_tag_counts.items())),
        'nonTopHumanHuFlopProgress': {
            'distinctNonTopHumansSeen': len(non_top_hu_by_human),
            'humansAtOrAboveTarget': qualifying_non_top,
            'requiredHumans': int(min_non_top_humans),
            'targetPerHuman': int(target_per_human_hu_flop),
            'quotaMet': qualifying_non_top >= int(min_non_top_humans),
        },
        'hands': selected_hands,
    }


def query_live_gap_targets(start_utc: str, end_utc: str) -> dict:
    import pg
    import segments

    build_attribution.parse_utc(start_utc)
    build_attribution.parse_utc(end_utc)

    dep_sql = (
        "SELECT row_to_json(q) FROM ("
        "SELECT target_sha AS engine_sha, started_at, completed_at "
        "FROM public.ca_engine_deploy_attempts "
        "WHERE completed_at IS NOT NULL "
        "  AND coalesce(exit_status, result, status, '') IN ('sealed', 'shipped', 'success', '0') "
        f"  AND completed_at <= ('{end_utc}'::timestamptz + interval '1 hour') "
        "ORDER BY completed_at DESC LIMIT 20"
        ") q;"
    )
    dep_rows, dep_err = pg.rows(dep_sql, 20000)

    hands = []
    failed_segments = []
    for seg_start, seg_end in segments.pairs(start_utc, end_utc, 1):
        sql = (
            "SELECT row_to_json(q) FROM ("
            "SELECT hh.id, hh.hand_number, hh.game_variant, "
            "  CASE WHEN hh.tournament_id IS NOT NULL THEN 'tournament' "
            "       WHEN coalesce((hh.metadata->>'isLightning')::boolean, false) THEN 'lightning' "
            "       ELSE 'cash' END AS game_mode, "
            "  hh.engine_build, hh.started_at, hh.created_at, hh.actions, "
            "  coalesce(hh.went_to_showdown, false) AS went_to_showdown, "
            "  coalesce((hh.metadata->>'isBombPot')::boolean, false) AS is_bomb_pot, "
            "  coalesce((hh.metadata->>'boardCount')::int, 1) AS board_count, "
            "  coalesce((hh.metadata->>'maxPlayers')::int, 0) AS max_players, "
            "  (SELECT coalesce(jsonb_agg(p.id::text), '[]'::jsonb) "
            "   FROM jsonb_array_elements(coalesce(hh.players, '[]'::jsonb)) pl "
            "   JOIN public.profiles p ON p.id::text = coalesce(pl->>'user_id', pl->>'userId') "
            "   WHERE NOT coalesce(p.is_horse, false)) AS human_user_ids, "
            "  (SELECT coalesce(jsonb_agg(p.id::text), '[]'::jsonb) "
            "   FROM jsonb_array_elements(coalesce(hh.players, '[]'::jsonb)) pl "
            "   JOIN public.profiles p ON p.id::text = coalesce(pl->>'user_id', pl->>'userId') "
            "   WHERE coalesce(p.is_horse, false)) AS horse_user_ids, "
            "  encode(sha256(convert_to(lower(c.table_id::text)||':'||c.hand_number::text||':'||"
            "    coalesce(c.post_commit_payload#>>'{accepted_hand_facts,horse_accepted_terminal,originalLease}',"
            "             c.post_commit_payload#>>'{accepted_hand_facts,horse_journal_identity,lease_generation}'),'UTF8')),'hex') AS k "
            "FROM public.hand_history hh "
            "JOIN public.hand_atomic_commits c ON c.hand_id = hh.id "
            f"WHERE hh.has_human AND hh.created_at >= '{seg_start}'::timestamptz AND hh.created_at < '{seg_end}'::timestamptz"
            ") q;"
        )
        rows, err = pg.rows(sql, 30000)
        if rows is None:
            failed_segments.append([seg_start, seg_end, err])
            continue
        hands.extend(rows)

    res = select_gap_targets(hands, boundaries=dep_rows or [])
    res['startUtc'] = start_utc
    res['endUtc'] = end_utc
    res['deployQueryError'] = dep_err
    res['failedSegments'] = failed_segments
    return res


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in ('classify', 'query'):
        sys.stderr.write(
            'usage:\n'
            '  gap_targets.py classify HANDS_JSON_OR_JSONL OUT_JSON [BOUNDARIES_JSON]\n'
            '  gap_targets.py query    START_UTC END_UTC OUT_JSON\n'
        )
        return 2
    mode = argv[1]
    if mode == 'classify':
        in_path, out_path = Path(argv[2]), Path(argv[3])
        b_path = Path(argv[4]) if len(argv) > 4 else None
        if out_path.exists():
            sys.stderr.write(f'refused: {out_path} exists\n')
            return 1
        raw_txt = in_path.read_text(encoding='utf-8').strip()
        if raw_txt.startswith('['):
            hands = json.loads(raw_txt)
        elif raw_txt.startswith('{') and '\n' not in raw_txt:
            obj = json.loads(raw_txt)
            hands = obj.get('hands', [obj])
        else:
            hands = [json.loads(l) for l in raw_txt.splitlines() if l.strip().startswith('{')]
        bounds = json.loads(b_path.read_text(encoding='utf-8')) if b_path else []
        res = select_gap_targets(hands, boundaries=bounds)
    else:
        start_utc, end_utc, out_file = argv[2:5]
        out_path = Path(out_file)
        if out_path.exists():
            sys.stderr.write(f'refused: {out_path} exists\n')
            return 1
        res = query_live_gap_targets(start_utc, end_utc)

    fd = os.open(str(out_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(fd, (json.dumps(res, indent=1) + '\n').encode('utf-8'))
    finally:
        os.close(fd)
    sys.stdout.write(json.dumps({
        'selectedHands': res['selectedHands'],
        'spotCounts': res['spotCounts'],
        'quotaMet': res['nonTopHumanHuFlopProgress']['quotaMet'],
    }) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
