"""River opportunity denominators and price sensitivity, never bluff labels.

A bet is not necessarily a bluff and a check is not necessarily a missed bluff.
Only original public actions and the actor's cards enter these diagnostics.
"""
from collections import Counter
import math
from omaha_reference import card


def river_opportunity(info, action):
    state=info.get('publicState',{})
    if info.get('street')!='river':return None
    legal=info.get('legalActions') or []
    seats=state.get('seats');hero=info.get('heroSeat')
    valid=isinstance(seats,list) and all(isinstance(s,list) and len(s)>=7 and type(s[6]) is int for s in seats)
    # Sitting out never removes an already committed all-in pot claim.
    opponents=[s for s in seats if s[0]!=hero and not s[6]&1
               and not (s[6]&4 and not s[6]&2)] if valid else None
    open_node=state.get('toCall')==0 and 'check' in legal and any(a in legal for a in ('bet','raise','all_in'))
    history=info.get('priorPublicActions',[])
    aggressive=lambda a:a.get('action') in ('bet','raise') or (a.get('action')=='all_in' and a.get('isFullRaise') is True)
    is_hero=lambda a:a.get('seat')==hero or (info.get('heroId') is not None and (a.get('userId') or a.get('user_id'))==info['heroId'])
    turn=[a for a in history if (a.get('stage') or a.get('street'))=='turn']
    river=[a for a in history if (a.get('stage') or a.get('street'))=='river']
    result={'status':'public_opportunity_diagnostic','openBetAvailable':open_node,
        'actualAction':action,'actualActionIsBluff':None,
        'priorOpponentCheckObserved':any(not is_hero(a) and a.get('action')=='check' for a in river),
        'opponentsStillInHand':len(opponents) if opponents is not None else None,
        'opponentsAbleToRespond':sum(not s[6]&2 and s[1]>0 for s in opponents) if opponents is not None else None,
        'heroTurnAggressionObserved':any(is_hero(a) and aggressive(a) for a in turn),
        'opponentTurnAggressionObserved':any(not is_hero(a) and aggressive(a) for a in turn),
        'opponentTurnCallObserved':any(not is_hero(a) and a.get('action')=='call' for a in turn),
        'opponentPostflopRaiseObserved':any(not is_hero(a) and (a.get('stage') or a.get('street')) in ('flop','turn','river') and (a.get('action')=='raise' or (a.get('action')=='all_in' and a.get('isFullRaise') is True)) for a in history),
        'blockerFacts':[],'pureBluffSensitivity':[],
        'qualificationRequired':['chronological_range_and_response','size_legality_and_costs','check_showdown_value','raise_response','domain_utility'],
        'qualified':False,'activationAllowed':False}
    boards=state.get('boards');cards=info.get('heroCards')
    if isinstance(boards,list) and len(boards)==1 and isinstance(boards[0],str) and len(boards[0])==10 and cards:
        try:
            hole=list(map(card,cards));board=[card(boards[0][i:i+2]) for i in range(0,10,2)]
            if len(set(hole+board))!=len(hole+board):raise ValueError('duplicate_card')
            for suit,count in sorted(Counter(c[1] for c in board).items()):
                if count>=3:
                    remaining=[r+suit for r in reversed('23456789TJQKA') if r+suit not in board]
                    result['blockerFacts'].append({'suit':suit,'boardSuitCount':count,
                        'heroSuitCount':sum(c[1]==suit for c in hole),
                        'holdsHighestOffBoardSuitCard':remaining[0] in hole,
                        'interpretation':'Card removal only; not proof of nut range advantage or profitable bluff.'})
        except (ValueError,TypeError):result['qualificationRequired'].append('valid_original_cards')
    pot=state.get('pot')
    if open_node and type(pot) in (int,float) and math.isfinite(pot) and pot>0:
        # These dimensionless scenarios are not generated legal bet sizes.
        # Formula assumes zero showdown share when called, no rake, and only
        # fold/call responses. Multiway needs joint ALL-fold probability.
        result['pureBluffSensitivity']=[{'betPotFraction':s,'breakEvenAllFoldProbability':s/(1+s)} for s in (1/3,0.5,0.75,1,1.5)]
        result['sensitivityAssumptions']='Zero called equity, fold/call only, no costs; illustrative sizes may be illegal; not prize utility.'
    return result
