"""Independent exact Omaha showdown reference and conditional river-bet model.

This is not an equilibrium solver. A response range is an explicit assumption,
not an observed opponent's private cards. No production-policy activation.
"""
from collections import Counter
from itertools import combinations
from functools import lru_cache
import math

RANKS='23456789TJQKA'
SUITS={'clubs':'c','diamonds':'d','hearts':'h','spades':'s'}
HOLES={'plo4':4,'plo5':5,'plo6':6,'plo8':4,'flo8':4}


def card(value):
    if isinstance(value,dict):
        rank=str(value.get('rank','')).replace('10','T')
        suit=SUITS.get(value.get('suit'),value.get('suit'))
        value=rank+str(suit)
    if not isinstance(value,str) or len(value)!=2 or value[0] not in RANKS or value[1] not in 'cdhs':
        raise ValueError('invalid_card')
    return value


@lru_cache(maxsize=100000)
def five(cards):
    """Lexicographic high rank; separate ace-to-five eight-or-better low."""
    ranks=[RANKS.index(c[0])+2 for c in cards]
    groups=sorted(((n,r) for r,n in Counter(ranks).items()),reverse=True)
    unique=sorted(set(ranks),reverse=True)
    straight=5 if unique==[14,5,4,3,2] else (unique[0] if len(unique)==5 and unique[0]-unique[-1]==4 else 0)
    flush=len({c[1] for c in cards})==1
    if flush and straight: high=(8,straight)
    elif groups[0][0]==4: high=(7,groups[0][1],groups[1][1])
    elif [g[0] for g in groups]==[3,2]: high=(6,groups[0][1],groups[1][1])
    elif flush: high=(5,*sorted(ranks,reverse=True))
    elif straight: high=(4,straight)
    elif groups[0][0]==3: high=(3,groups[0][1],*sorted((r for n,r in groups[1:]),reverse=True))
    elif [g[0] for g in groups[:2]]==[2,2]: high=(2,*sorted((groups[0][1],groups[1][1]),reverse=True),groups[2][1])
    elif groups[0][0]==2: high=(1,groups[0][1],*sorted((r for n,r in groups[1:]),reverse=True))
    else: high=(0,*sorted(ranks,reverse=True))
    lows=sorted((1 if r==14 else r for r in ranks),reverse=True)
    low=tuple(lows) if len(set(lows))==5 and lows[0]<=8 else None
    return high,low


def omaha(holes,board,variant):
    if variant not in HOLES or len(holes)!=HOLES[variant] or not 3<=len(board)<=5:
        raise ValueError('unsupported_omaha_state')
    holes=tuple(map(card,holes));board=tuple(map(card,board))
    if len(set(holes+board))!=len(holes+board): raise ValueError('duplicate_card')
    values=[five(tuple(sorted(h+b))) for h in combinations(holes,2) for b in combinations(board,3)]
    low=min((v[1] for v in values if v[1] is not None),default=None) if variant in ('plo8','flo8') else None
    return max(v[0] for v in values),low


def share(hero,opponent,board,variant):
    if len(board)!=5: raise ValueError('showdown_requires_river')
    all_cards=list(map(card,[*hero,*opponent,*board]))
    if len(set(all_cards))!=len(all_cards): raise ValueError('duplicate_card')
    h,l=omaha(hero,board,variant);oh,ol=omaha(opponent,board,variant)
    high=1 if h>oh else 0.5 if h==oh else 0
    if l is None and ol is None: return high
    low=0 if l is None else 1 if ol is None or l<ol else 0.5 if l==ol else 0
    return (high+low)/2


def river_high_ceiling(hero, board, variant):
    """Exact possible high hands, NOT a range distribution or win probability.

    Every Omaha winning high uses exactly two hole cards. Enumerating each
    unblocked pair therefore proves whether a better high is possible for
    four, five or six hole cards, without sampling full opponent holdings.
    Pair counts overlap within holdings and MUST NOT be used as equity.
    Low shares are intentionally outside this high-only certificate.
    """
    if len(board)!=5: raise ValueError('ceiling_requires_river')
    rank,_=omaha(hero,board,variant)
    known=set(map(card,[*hero,*board]))
    deck=[r+s for r in RANKS for s in 'cdhs' if r+s not in known]
    triples=list(combinations(tuple(map(card,board)),3))
    above=ties=below=0;best=();witness=None;boat_ranks=set();higher_categories=set()
    for pair in combinations(deck,2):
        other=max(five(tuple(sorted(pair+t)))[0] for t in triples)
        if other>rank: above+=1
        elif other==rank: ties+=1
        else: below+=1
        if other>best:best=other;witness=pair
        if other[0]==6:boat_ranks.add(other)
        if other>rank:higher_categories.add(other[0])
    boat=None
    if rank[0]==6:
        higher=sorted(r for r in boat_ranks if r>rank)
        lower=sorted(r for r in boat_ranks if r<rank)
        boat={'tier':'top' if not higher else 'middle' if lower else 'bottom',
              'higherFullHouseRanks':[list(r) for r in higher],
              'lowerFullHouseRanks':[list(r) for r in lower],
              'definition':'Relative to physically possible opposing best two-hole full houses after removing hero and board cards; not a range probability.',
              'quadsPossible':7 in higher_categories,'straightFlushPossible':8 in higher_categories}
    return {'heroHigh':list(rank),'maximumOpponentHigh':list(best),
            'higherPairs':above,'tyingPairs':ties,'lowerPairs':below,
            'higherHighPossible':above>0,'highUnbeatable':above==0,
            'highUnbeatableAndUntieable':above==0 and ties==0,
            'maximumWitnessPair':list(witness),
            'pairCountsAreNotEquity':True,'lowShareEvaluated':False,'fullHousePosition':boat}


def river_bet_model(hero,board,variant,pot,bet,range_rows):
    """Heads-up, single-board cash, no outstanding bet, no rake/fees.

    Opponent responds only fold/call; rows supply size-specific fold probability
    and weight. Compare with check-through value under exactly this model.
    Raises, later opponent bets and tournaments are outside this model.
    """
    if not all(type(v) in (int,float) and math.isfinite(v) and v>0 for v in (pot,bet)):
        raise ValueError('invalid_price')
    if not range_rows: raise ValueError('empty_range')
    total=0;ev=0;check=0;folds=0
    for row in range_rows:
        weight=row.get('weight');f=row.get('foldProbability')
        if not all(type(v) in (int,float) and math.isfinite(v) for v in (weight,f)) or weight<=0 or not 0<=f<=1:
            raise ValueError('invalid_response_assumption')
        e=share(hero,row['cards'],board,variant)
        total+=weight;folds+=weight*f
        ev+=weight*(f*pot+(1-f)*(e*(pot+2*bet)-bet))
        check+=weight*e*pot
    return {'model':'hu-river-fold-call-no-costs-v1','variant':variant,
            'betEv':ev/total,'checkThroughEv':check/total,'foldProbability':folds/total,
            'betMinusCheckThrough':(ev-check)/total,'pureBluffBreakEvenFoldRate':bet/(pot+bet),
            'conditionalOnDeclaredRangeAndResponse':True,'qualified':False,'gtoVerified':False,
            'activationAllowed':False,'unsupported':['opponent_raises','opponent_bets_after_check','rake_or_fees','multiway','tournaments']}
