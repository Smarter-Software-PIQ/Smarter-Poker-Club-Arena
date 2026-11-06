"""Outcome-blind per-decision review. Exact card facts are not strategic EV.

Consumes only the original actor's information set. No opponent private cards,
future board, hand result, policy writer or production activation is available.
"""
from itertools import combinations
from omaha_reference import card, five, omaha, river_high_ceiling, HOLES
from horse_river_opportunities import river_opportunity

CATEGORIES=('high_card','one_pair','two_pair','trips','straight','flush',
            'full_house','quads','straight_flush')


def made_hand(hero, board, variant):
    if variant in HOLES:
        high,low=omaha(hero,board,variant)
    elif variant=='nlh':
        cards=list(map(card,[*hero,*board]))
        if len(hero)!=2 or not 3<=len(board)<=5 or len(set(cards))!=len(cards):
            raise ValueError('invalid_holdem_state')
        high=max(five(tuple(sorted(c)))[0] for c in combinations(cards,5));low=None
    else:
        raise ValueError('variant_reference_unavailable')
    return {'highCategory':CATEGORIES[high[0]],'highRank':list(high),
            'qualifyingLow':list(low) if low else None,
            'lowApplicable':variant in ('plo8','flo8')}


def closes_unbet_street(info):
    """Position fact using the captured pre-action seats, never later actions."""
    state=info.get('publicState',{})
    hero=info.get('heroSeat');button=state.get('dealerSeat');seats=state.get('seats')
    if state.get('toCall')!=0 or state.get('currentBet')!=0:return None
    if type(hero) is not int or type(button) is not int or not isinstance(seats,list):return None
    if any(not isinstance(s,list) or len(s)<7 or type(s[0]) is not int or type(s[6]) is not int for s in seats):return None
    eligible=sorted(s[0] for s in seats if not s[6]&3)
    if hero not in eligible or len(eligible)<2:return None
    order=[s for s in eligible if s>button]+[s for s in eligible if s<=button]
    return order[-1]==hero


def review_decision(d, exact_river_ceiling=False):
    info=d['informationSet'];state=info.get('publicState',{})
    variant=info.get('variant');street=info.get('street');hero=info.get('heroCards')
    result={'schemaVersion':1,'decisionId':d['decisionId'],
            'sourceInformationSha256':d['informationSha256'],
            'status':'evidence_limited_review','strategicVerdict':'unresolved',
            'facts':{},'candidates':[],'alternatives':[],
            'gtoVerified':False,'activationAllowed':False,
            'requiredEvidence':list(d.get('gaps',[]))}
    legal=info.get('legalActions')
    if isinstance(legal,list):
        result['facts']['recordedActionLegal']=d['action'] in legal
        for action in legal:
            result['alternatives'].append({'action':action,'ev':None,
                'status':'requires_qualified_counterfactual',
                'sizing':{'minRaiseTo':state.get('minRaiseTo'),'maxRaiseTo':state.get('maxRaiseTo')}
                if action in ('bet','raise','all_in') else None})
    result['facts']['decisionOrigin']=d.get('origin')
    result['facts']['decisionSource']='policy' if d.get('origin')=='horse_policy' else 'execution_or_unknown'
    result['facts']['bbAnte']=state.get('anteType')=='big_blind'
    opportunity=river_opportunity(info,d['action'])
    if opportunity is not None:result['facts']['riverOpportunity']=opportunity
    if street=='preflop':
        result['requiredEvidence'].append('variant_stack_position_ante_specific_preflop_reference')
        return result
    boards=state.get('boards')
    if not hero or not isinstance(boards,list) or not boards:return result
    made=[]
    try:
        for b in boards:
            if not isinstance(b,str) or len(b)%2:raise ValueError('invalid_board')
            board=[b[i:i+2] for i in range(0,len(b),2)]
            if len(board)!={'flop':3,'turn':4,'river':5}.get(street):raise ValueError('street_board_mismatch')
            made.append(made_hand(hero,board,variant))
        result['facts']['madeHandsByBoard']=made
    except (ValueError,TypeError,KeyError):
        result['requiredEvidence'].append('card_reference_input_invalid_or_unsupported')
        return result
    if street!='river':
        result['requiredEvidence'].extend(['range_weighted_runout_equity','future_action_and_redraw_model'])
        return result
    result['facts']['closingUnbetStreet']=closes_unbet_street(info)
    if len(boards)!=1:
        result['requiredEvidence'].append('joint_multiple_board_pot_share_model')
        return result
    strong=made[0]['highCategory'] in ('full_house','quads','straight_flush')
    if d['action']=='check' and strong:
        result['candidates'].append('strong_hand_checkback' if closes_unbet_street(info) is True else 'strong_hand_check_requires_position_and_induce_review')
    if d['action']=='call' and strong and any(a in (legal or []) for a in ('raise','all_in')):
        result['candidates'].append('strong_hand_call_requires_value_raise_comparison')
    if d['action']=='fold' and strong:result['candidates'].append('strong_hand_fold_requires_range_review')
    if exact_river_ceiling and strong and variant in HOLES:
        board=[boards[0][i:i+2] for i in range(0,10,2)]
        result['facts']['omahaHighCeiling']=river_high_ceiling(hero,board,variant)
        position=result['facts']['omahaHighCeiling']['fullHousePosition']
        if position is not None:
            result['facts']['fullHousePosition']=position
            if variant in ('plo4','plo5','plo6') and position['tier'] in ('middle','top'):
                if d['action']=='check' and opportunity and opportunity['openBetAvailable'] and opportunity['priorOpponentCheckObserved']:
                    result['candidates'].append('middle_top_full_house_checked_to_value_bet_review')
                if d['action'] in ('fold','raise','all_in') and isinstance(state.get('toCall'),(int,float)) and state['toCall']>0:
                    result['candidates'].append('middle_top_full_house_facing_bet_call_comparison')
    if variant in ('plo8','flo8'):
        result['requiredEvidence'].append('joint_high_low_scoop_quartering_and_counterfeit_model')
    result['requiredEvidence'].extend(['chronological_public_opponent_range',
        'size_specific_call_fold_raise_response','rake_side_pot_and_uncalled_return_model'])
    # No threshold or hand category alone authorizes a bet, call, fold or raise.
    # In tournaments even a positive chip-EV comparison is not prize utility.
    return result
