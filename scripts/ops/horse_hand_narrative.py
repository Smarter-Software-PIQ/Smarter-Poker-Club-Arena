"""Readable individual street reviews from evidence, with unresolved EV explicit."""
import json


def render_hand(hand,decisions):
    by_id={d['decisionId']:d for d in decisions}
    lines=[f"# Hand {hand['handId']}",
        f"Format: {hand['format']}; variant: {hand['variant']}; played: {hand.get('playedAt') or 'unknown'}.",
        f"Tournament: {hand.get('tournamentId') or 'not applicable'}; inclusion: {hand['status']}.",
        'Status: evidence-limited individual review; no qualified optimal-action verdict.','']
    for horse in hand['horses']:
        lines.append(f"## Horse {horse['horseId']}")
        for street,entry in horse['streets'].items():
            lines.append(f'### {street.capitalize()}')
            if not entry['decisions']:
                lines.extend(['No recorded decision. This does not establish that the street was never reached.',''])
            for identity in entry['decisions']:
                d=by_id[identity];info=d['informationSet'];state=info['publicState'];review=d['review']
                facts=review['facts'];made=facts.get('madeHandsByBoard',[])
                lines.extend([f"Decision {identity}: {d['action']} ({d.get('amount')}); origin {d.get('origin') or 'unknown'}.",
                    'Rules: '+json.dumps(d['ruleContext'],sort_keys=True)+'.',
                    'Own cards: '+(json.dumps(info['heroCards']) if info['heroCards'] else 'unavailable')+'.',
                    'Board(s) at decision: '+json.dumps(state.get('boards'))+'.',
                    f"Pot: {state.get('pot')}; amount to call: {state.get('toCall')}; legal actions: {', '.join(info.get('legalActions') or []) or 'unavailable'}.",
                    'Prior public line: '+json.dumps(info.get('priorPublicActions',[]),separators=(',',':'))+'.'])
                if made:
                    lines.append('Exact made-hand facts: '+json.dumps(made,separators=(',',':'))+'. Made rank alone is not range equity.')
                if d.get('callPriceFractionBeforeCosts') is not None:
                    lines.append(f"Call-price fraction before costs: {d['callPriceFractionBeforeCosts']:.6f}. This is not a call recommendation; eligible pots, rake and future action matter.")
                if 'omahaHighCeiling' in facts:
                    ceiling=facts['omahaHighCeiling']
                    lines.append(f"Omaha high ceiling: better high {'possible' if ceiling['higherHighPossible'] else 'impossible'} from unblocked opposing pairs; tying pairs {ceiling['tyingPairs']}. Pair counts are not probabilities; low share is not certified.")
                    if ceiling.get('fullHousePosition'):
                        lines.append('Full-house position: '+json.dumps(ceiling['fullHousePosition'],separators=(',',':'))+'.')
                if facts.get('riverOpportunity'):
                    lines.append('River opportunity: '+json.dumps(facts['riverOpportunity'],separators=(',',':'))+'.')
                lines.append('Review candidates: '+(', '.join(review['candidates']) or 'none from the implemented factual screens')+'.')
                lines.append('Alternatives: '+json.dumps(review['alternatives'],separators=(',',':'))+'. Null EV means uncomputed, never zero.')
                lines.append('To resolve the action comparison: '+', '.join(sorted(set(review['requiredEvidence'])))+'.')
                lines.extend(['Verdict: unresolved. Neither the result of this hand nor the hand category establishes that this action was right or wrong.',''])
    return '\n'.join(lines)+'\n'
