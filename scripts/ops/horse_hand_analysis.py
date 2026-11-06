"""Outcome-blind historical decision inventory, not a solver or policy issuer."""
from collections import Counter
import hashlib
import json
import math
import re

STREETS = ('preflop', 'flop', 'turn', 'river')
DECISIONS = {'fold', 'check', 'call', 'bet', 'raise', 'all_in'}
VARIANTS = {
    'nlh': (2, 'no_limit'), 'plo4': (4, 'pot_limit'),
    'plo5': (5, 'pot_limit'), 'plo6': (6, 'pot_limit'),
    'plo8': (4, 'pot_limit'), 'flo8': (4, 'fixed_limit'),
    'short_deck': (2, 'no_limit'), 'pineapple': (3, 'no_limit'),
}


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def actor_id(value):
    return value.get('userId') or value.get('user_id')


def decision(action):
    return (action.get('action') in DECISIONS and action.get('origin') != 'forced'
            and action.get('dead') is not True)


def stage_context(node, tournament):
    if not tournament:
        return {'phase': 'cash', 'status': 'not_applicable'}
    context = node.get('tournamentStage') or {}
    if context.get('status') != 'captured':
        return {'phase': 'unknown', 'status': 'unavailable',
                'reason': context.get('reason', 'historical_tournament_context_missing')}
    left, paid = context.get('playersLeft'), context.get('spotsPaid')
    if type(left) is not int or type(paid) is not int or left < 2 or paid < 0:
        return {'phase':'unknown','status':'invalid','reason':'invalid_field_counts'}
    # Phase labels do not supply ICM, payout curves or whole-field stacks.
    if paid == 0:
        phase = 'no_regular_paid_places'
    elif left == paid + 1:
        phase = 'stone_bubble'
    elif left <= paid:
        phase = 'in_money'
    elif context.get('nearBubble') is True:
        phase = 'near_bubble'
    else:
        phase = 'pre_money'
    # One regular paid place with two remaining players is a different
    # field geometry from a multi-place bubble. This does not establish a
    # winner-take-all utility: bounties, satellites and registration may matter.
    geometry = ('heads_up_one_regular_paid_place' if left == 2 and paid == 1
                else 'multi_regular_paid_place_bubble' if phase == 'stone_bubble'
                else 'not_stone_bubble')
    return {'phase':phase,'status':'captured','playersLeft':left,'spotsPaid':paid,
            'paidPlaceGeometry':geometry,
            'distanceToMoney':left-paid if paid else None,
            'playersPerPaidPlace':left/paid if paid else None,
            'format':context.get('format'), 'finalTable':context.get('finalTable'),
            'registrationOpen':context.get('registrationOpen'),
            'handForHand':context.get('handForHand'), 'satellite':context.get('satellite'),
            'satelliteSeats':context.get('satelliteSeats'), 'isPko':context.get('isPko'),
            'isBounty':context.get('isBounty'), 'isMysteryBounty':context.get('isMysteryBounty'),
            'mysteryBountyStage':context.get('mysteryBountyStage'),
            'fullUtilityContextAvailable':False}


def classify_participants(hand, profiles, accepted_roster=None):
    people = hand.get('players')
    if not isinstance(people, list):
        return {}, ['players_unavailable']
    roles, gaps = {}, []
    historical = {actor_id(p): (p.get('classification')=='horse' if p.get('classification') in ('horse','human') else p.get('is_horse')) for p in (accepted_roster or []) if isinstance(p,dict)}
    for player in people:
        if not isinstance(player,dict):
            gaps.append('invalid_participant');continue
        uid = actor_id(player)
        if not isinstance(uid,str):
            gaps.append('participant_identity_missing'); continue
        direct = historical.get(uid, player.get('is_horse'))
        if type(direct) is bool:
            roles[uid] = {'horse':direct,'basis':'historical_roster'}
        elif uid in profiles and type(profiles[uid].get('is_horse')) is bool:
            roles[uid] = {'horse':profiles[uid]['is_horse'],'basis':'current_profile'}
        else:
            roles[uid] = {'horse':None,'basis':'unknown'}
            gaps.append('participant_classification_unknown')
    return roles, sorted(set(gaps))


def original_hero_cards(hand, hero, pineapple_preflop=False):
    """Recover only the named actor's original cards; never other actors' cards."""
    mapping = hand.get('hole_cards')
    variant = hand.get('game_variant')
    # Discard games need street-specific holdings, not original deal cards.
    if not isinstance(mapping, dict) or variant not in VARIANTS or (variant == 'pineapple' and not pineapple_preflop):
        return None
    cards = mapping.get(hero)
    if not isinstance(cards, list) or len(cards) != VARIANTS[variant][0]:
        return None
    suits = {'clubs':'c', 'diamonds':'d', 'hearts':'h', 'spades':'s'}
    normalized = []
    for card in cards:
        if isinstance(card, dict):
            rank, suit = card.get('rank'), card.get('suit')
            card = rank + suits.get(suit, '') if isinstance(rank, str) else None
        if not isinstance(card, str) or not re.fullmatch(r'[2-9TJQKA][cdhs]', card):
            return None
        if variant == 'short_deck' and card[0] in '2345':
            return None
        normalized.append(card)
    return normalized if len(set(normalized)) == len(normalized) else None


def analyze_decision(hand, action, ordinal, hero, cards, card_source=None):
    raw_node = action.get('publicNode')
    node = raw_node if isinstance(raw_node,dict) else {}
    street = action.get('stage') or action.get('street')
    gaps, findings = [], []
    board_length={'preflop':0,'flop':6,'turn':8,'river':10}.get(street)
    boards=node.get('boards')
    boards_valid=(isinstance(boards,list) and 1<=len(boards)<=3 and board_length is not None
                  and all(isinstance(b,str) and len(b)==board_length and re.fullmatch(r'(?:[2-9TJQKA][cdhs])*',b) for b in boards))
    captured = (node.get('status') == 'captured' and node.get('actorSeat') == action.get('seat')
                and node.get('street')==street and boards_valid)
    if not captured:
        gaps.append('original_public_node_missing_or_mismatched')
    variant = node.get('variant') if captured else hand.get('game_variant')
    structure = node.get('structure') if captured else None
    if variant not in VARIANTS:
        gaps.append('unsupported_variant')
    expected = VARIANTS.get(variant,(None,None))[0]
    if variant == 'pineapple':
        prior_discard = any(isinstance(previous, dict)
            and previous.get('action') == 'discard'
            and previous.get('stage') == 'pineapple_discard'
            and actor_id(previous) == hero
            for previous in (hand.get('actions') or [])[:ordinal])
        if street == 'preflop':
            if prior_discard or not isinstance(cards, list) or len(cards) != 3:
                cards = original_hero_cards(hand, hero, pineapple_preflop=True) if not prior_discard else None
                card_source = 'hand_history.hole_cards' if cards else None
            if not cards:
                gaps.append('pineapple_original_three_cards_unavailable')
        elif not isinstance(cards, list) or len(cards) != 2 or not prior_discard:
            cards = None
            card_source = None
            gaps.append('pineapple_street_holdings_unproven')
    if card_source and variant != hand.get('game_variant'):
        cards = None
        gaps.append('hero_cards_variant_conflict')
    if card_source and captured and cards and any(card in {b[i:i+2] for b in boards for i in range(0,len(b),2)} for card in cards):
        cards = None
        gaps.append('hero_cards_conflict_with_visible_board')
    if not isinstance(cards,list) or not cards:
        cards = None; gaps.append('hero_cards_missing')
    elif variant != 'pineapple' and expected is not None and len(cards) != expected:
        gaps.append('hero_card_count_invalid')
    if street not in STREETS:
        gaps.append('unsupported_street')
    tournament = hand.get('tournament_id') is not None
    stage = stage_context(node if captured else {},tournament)
    if tournament:
        if stage['status'] != 'captured': gaps.append('historical_tournament_stage_unavailable')
        gaps.append('full_historical_payout_stack_bounty_context_not_yet_bound')
    legal = node.get('legalActions') if captured else None
    if not isinstance(legal,list) or not legal:
        gaps.append('legal_menu_unavailable'); legal = None
    elif action.get('action') not in legal:
        findings.append({'kind':'executed_action_not_in_captured_menu','status':'requires_source_reconciliation'})
    price, pot = (node.get('toCall'),node.get('pot')) if captured else (None,None)
    seats = node.get('seats') if captured else None
    hero_seat = next((s for s in seats if isinstance(s,list) and len(s)>=7 and s[0]==action.get('seat')),None) if isinstance(seats,list) else None
    stack = hero_seat[1] if hero_seat else None
    paid = min(price,stack) if finite(price) and finite(stack) and price>=0 and stack>=0 else None
    # This is a price diagnostic, not an equity or call recommendation. Side
    # pots, rake, future wagers and tournament utility can change the answer.
    price_fraction = paid/(pot+paid) if paid is not None and finite(pot) and pot>=0 and pot+paid>0 else None
    if captured and legal and action.get('action')=='fold' and price==0 and 'check' in legal:
        findings.append({'kind':'fold_with_free_check_available','status':'execution_candidate',
                         'reason':'A check preserves the option to continue without paying at this decision; investigate timeout or policy origin.'})
    # Strict allowlist: never copy the final board, winners, other cards, full
    # raw actions or retrospective outcomes into the decision information set.
    observed = {k:node[k] for k in ('pot','toCall','currentBet','minRaiseTo','maxRaiseTo',
                'boards','seats','dealerSeat','bigBlind','smallBlind','ante','anteType',
                'deductions','asset','chipUnit','fixedBetSize','boardCount','bombPot','allInOrFold','wagersCapped') if captured and k in node}
    # Earlier public actions are necessary to distinguish a check-raise from
    # a lead or a multi-barrel line. Never copy later actions or nested payloads.
    prior=[]
    for previous in (hand.get('actions') or [])[:ordinal]:
        if not isinstance(previous,dict):continue
        prior.append({k:previous[k] for k in ('userId','user_id','seat','action','amount','stage','street','origin','dead','isFullRaise')
                      if k in previous and isinstance(previous[k],(str,int,float,bool,type(None)))})
    information = {'heroId':hero,'heroSeat':action.get('seat'),'heroCards':cards,'street':street,'variant':variant,
                   'structure':structure,'publicState':observed,'priorPublicActions':prior,
                   'legalActions':legal,'tournamentStage':stage}
    digest = hashlib.sha256(json.dumps(information,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    result = {'decisionId':str(hand['id'])+':'+str(ordinal),'horseId':hero,'street':street,
            'action':action.get('action'),'amount':action.get('amount'),'origin':action.get('origin'),
            'informationSet':information,'informationSha256':digest,
            'callPriceFractionBeforeCosts':price_fraction,'findings':findings,
            'strategicVerdict':'insufficient_evidence','gaps':sorted(set(gaps+['qualified_reference_not_bound'])),
            'gtoVerified':False,'activationAllowed':False}
    if card_source:
        result['heroCardProvenance'] = {'source':card_source,'actorId':hero,'accepted':cards is not None}
    return result


def analyze_hand(hand, profiles, facts=None, accepted_roster=None, excluded_ids=()):
    roles,gaps = classify_participants(hand,profiles,accepted_roster)
    humans = [uid for uid,r in roles.items() if r['horse'] is False and uid not in excluded_ids]
    horses = [uid for uid,r in roles.items() if r['horse'] is True]
    status = 'included' if humans and horses else ('classification_unknown' if any(r['horse'] is None for r in roles.values()) else 'excluded')
    actions = hand.get('actions')
    if not isinstance(actions,list):
        actions=[]; gaps.append('actions_unavailable')
    players = {actor_id(p):p for p in (hand.get('players') or []) if isinstance(p,dict)}
    decisions=[]; horse_reports=[]
    if status=='included':
        for hero in horses:
            cards = (facts or {}).get(hero) or players.get(hero,{}).get('cards')
            card_source = None
            if not cards:
                cards = original_hero_cards(hand, hero)
                if cards is not None: card_source = 'hand_history.hole_cards'
            own=[]
            for i,a in enumerate(actions):
                if not isinstance(a,dict) or not decision(a): continue
                uid=actor_id(a)
                if uid is None and a.get('seat')==players[hero].get('seat'): uid=hero
                if uid==hero: own.append(analyze_decision(hand,a,i,hero,cards,card_source))
            decisions.extend(own)
            horse_reports.append({'horseId':hero,'classificationBasis':roles[hero]['basis'],
                'streets':{s:{'decisions':[d['decisionId'] for d in own if d['street']==s],
                    'status':'recorded_decisions' if any(d['street']==s for d in own) else 'no_recorded_decision'} for s in STREETS}})
    return {'schemaVersion':1,'handId':hand['id'],'playedAt':hand.get('started_at') or hand.get('created_at'),
            'tableId':hand.get('table_id'),'tournamentId':hand.get('tournament_id'),
            'format':'tournament' if hand.get('tournament_id') else 'cash',
            'variant':hand.get('game_variant'),'source':hand.get('source'),
            'status':status,'humanIds':humans,'horseIds':horses,
            'excludedHumansPresent':[uid for uid in roles if uid in excluded_ids],
            'gaps':gaps,'horses':horse_reports,'decisions':decisions,
            'analysisComplete':False,'gtoVerified':False,'activationAllowed':False}
