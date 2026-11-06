"""Outcome-blind PLO river opportunity appendix using existing review facts.

This is conditional response algebra, never a bluff classifier or policy issuer.
"""
import argparse
import collections
from fractions import Fraction as F
import gzip
import hashlib
import json
import os
import math
from pathlib import Path
import stat

def sha(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()

def q(value):
    return F(str(value))

def num(value):
    return {'exact': str(value), 'value': float(value)}

def review_opportunity(d):
    """Return an allowlisted diagnostic, never copying retrospective payloads."""
    i = d['informationSet']
    variant = i['variant']
    if d['street'] != 'river' or variant not in ('plo4', 'plo5', 'plo6', 'plo8') or (not i.get('heroCards')):
        return None
    state = i['publicState']
    facts = d['review']['facts']
    legal = i.get('legalActions') or []
    pot = state.get('pot')
    tc = state.get('toCall')
    seats = state.get('seats') or []
    hero = next((x for x in seats if x[0] == i['heroSeat']), None)
    opp = [x for x in seats if x[0] != i['heroSeat'] and (not x[6] & 5)]
    responsive = [x for x in opp if not x[6] & 6 and x[1] > 0]
    opportunity = facts.get('riverOpportunity') or {}
    notes = []
    prices = []
    gaps = []
    knownnode = bool(state) and hero is not None
    opening = knownnode and tc == 0 and ('bet' in legal)
    raising = knownnode and tc is not None and (tc > 0) and ('raise' in legal)
    if opening:
        kind = 'legal_open_bet_menu'
    elif raising:
        kind = 'legal_raise_menu'
    elif 'all_in' in legal and hero and (tc is not None) and (hero[1] > tc):
        kind = 'all_in_aggression_requires_bound_validation'
    else:
        kind = 'no_priced_aggressive_menu'
    if opening or raising:
        lo = state.get('minRaiseTo')
        hi = state.get('maxRaiseTo')
        unit = state.get('chipUnit')
        own = hero[2]
        if all((type(x) in (int, float) and math.isfinite(x) for x in (pot, lo, hi, unit, own, hero[1]))) and pot > 0 and (unit > 0) and (0 <= lo <= hi) and (own >= 0) and (hero[1] >= 0):
            P = q(pot)
            L = q(lo)
            H = min(q(hi), q(own) + q(hero[1]))
            U = q(unit)
            O = q(own)
            proposals = {L, H}
            for fraction in (F(1, 3), F(1, 2), F(3, 4), F(1)):
                proposals.add(O + P * fraction // U * U)
            for R in sorted(proposals):
                B = R - O
                if R < L or R > H or R / U != int(R / U) or (B <= 0):
                    continue
                if raising and R <= q(state.get('currentBet', 0)):
                    continue
                allfoldpossible = bool(opp) and all((not x[6] & 6 and x[1] > 0 for x in opp))
                C = R - q(state.get('currentBet', 0))
                prices.append({'raiseTo': num(R), 'incrementalRisk': num(B), 'incrementalRiskPotFraction': num(B / P), 'pureBluffBreakEvenJointAllFoldNoCosts': num(B / (P + B)), 'headsUpFullCallAdditionalOpponentContribution': num(C) if len(opp) == 1 else None, 'allOpponentsCanRespondAndFold': allfoldpossible, 'exampleSizeIsOptimal': False, 'conditionalFormula': 'EV = F_all * P + (1-F_all) * (-B), assuming all B is matched whenever anyone continues, zero final share, no added wager after this action, and no costs. Short calls/uncalled returns require replacing B with actual matched risk; this is not their exact EV.', 'compareToCheckRequirement': 'If check has value Q, require F_all > (B+Q)/(P+B) under the same zero-share/no-cost assumptions; Q is unknown.' if opening else 'Calling has separate unknown value; positive raise-versus-fold algebra does not establish raise better than call.'})
        else:
            gaps.append('captured_price_bounds_or_chip_unit_unavailable')
    if not knownnode:
        gaps.append('original_public_node_unavailable')
    if facts.get('madeHandsByBoard'):
        notes.append('Own high/low rank is established for the visible board(s), but actual action is not classified as bluff or value from rank alone.')
    else:
        gaps.append('current_exact_hand_rank_unavailable')
    notes.append('Observed action: ' + d['action'] + ' ' + str(d['amount']) + '. Legal labels: ' + str(legal) + '. Opportunity class: ' + kind + '.')
    if facts.get('closingUnbetStreet') is True:
        notes.append('Checking closes this unbet river. Its showdown value must be compared with each betting response tree; it is not automatically zero.')
    elif tc == 0:
        notes.append('Checking may leave a later actor. Its value needs later bet sizes and hero responses; check-through is not a valid unconditional baseline.')
    if tc and hero and pot:
        paid = min(q(tc), q(hero[1]))
        callprice = num(paid / (q(pot) + paid))
        notes.append('Before-cost call price fraction ' + callprice['exact'] + ' is a price diagnostic, not required equilibrium equity; side pots, sharing and utility can change the comparison.')
    else:
        callprice = None
    if len(opp) > 1:
        notes.append('Multiway bluff success is the joint event that every eligible opponent folds. Individual fold frequencies cannot be multiplied without a justified dependence model; raises and side pots require their own branches.')
    if opp and len(responsive) < len(opp):
        notes.append('At least one non-folded opponent cannot respond/fold. An all-opponents-fold bluff premise is unavailable; any bet must be evaluated through contested and side-pot shares.')
    blocker = opportunity.get('blockerFacts') or []
    if blocker:
        notes.append('Existing suit/card-removal facts: ' + str(blocker) + '. Holding a blocker removes combinations; it does not establish opponent range weights, fold rate or bluff profitability.')
    else:
        notes.append('No existing suit-blocker diagnostic is supplied. This is not evidence that all blockers or bluff opportunities are absent.')
    if variant == 'plo8':
        gaps.append('joint_high_low_holdings_scoop_quartering_response_model')
        notes.append('Own qualifying low is retained where evaluated. Opposing low ranks and sharing probabilities are not supplied; zero-equity bluff algebra is not the actual hand EV.')
    if d['domain'].startswith('tournament/'):
        notes.append('Tournament stage ' + str(i['tournamentStage']) + '. The displayed formula is wager-unit algebra, not prize/bounty utility; even a one-paid-place heads-up geometry does not supply a complete utility model.')
        gaps.append('full_field_payout_stack_bounty_utility')
    if state.get('asset') is None:
        gaps.append('asset_unavailable')
    elif state.get('asset') == 'diamonds':
        notes.append('Asset is diamonds. Numeric thresholds are dimensionless; amounts remain diamonds and cannot be relabeled chips or converted to money.')
    if len(state.get('boards') or []) > 1:
        gaps.append('joint_multiple_board_award_model')
    gaps.extend(['chronological_public_opponent_range', 'size_specific_fold_call_raise_response', 'raise_continuation', 'check_or_call_baseline_value', 'uncalled_returns_and_short_calls', 'captured_costs_and_side_pot_awards'])
    notes.append('A useful bluff requires a justified size-specific range/response model and better value than alternatives after costs. Neither the missing response model nor the threshold can be filled with a hand-result observation. Existing responses elsewhere in this study are descriptive selection-biased evidence, not automatic probabilities here.')
    row = {'decisionId': d['decisionId'], 'handId': d['handId'], 'informationSha256': d['informationSha256'], 'domain': d['domain'], 'ruleContext': d['ruleContext'], 'street': 'river', 'recordedAction': d['action'], 'recordedAmount': d['amount'], 'origin': d['origin'], 'heroSeat': i['heroSeat'], 'ownCards': i['heroCards'], 'visibleBoards': state.get('boards'), 'madeHandsByBoard': facts.get('madeHandsByBoard'), 'existingHighCeiling': facts.get('omahaHighCeiling'), 'blockerFacts': blocker, 'priorPublicActions': i['priorPublicActions'], 'publicPot': pot, 'toCall': tc, 'capturedDeductions': state.get('deductions'), 'legalActions': legal, 'closingUnbetStreet': facts.get('closingUnbetStreet'), 'opponentsInHand': len(opp) if knownnode else None, 'opponentsAbleToRespond': len(responsive) if knownnode else None, 'opportunityClass': kind, 'conditionalLegalSizeDiagnostics': prices, 'beforeCostCallPrice': callprice, 'foldBaselineIncrementalWagerValue': 0 if 'fold' in legal else None, 'notes': notes, 'requiredEvidence': gaps, 'actualActionIsBluff': None, 'recommendedBluff': None, 'strategyVerdict': 'unresolved', 'gtoVerified': False, 'activationAllowed': False}
    return row

def _private_directory(path):
    path = Path(path).absolute()
    if path.is_symlink() or path.resolve() != path:
        raise ValueError('real_private_directory_required')
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 63:
        raise ValueError('owner_private_directory_required')
    return path

def build_appendix(review, output):
    """Consume one immutable study batch; refuse overwrites and exposed paths."""
    review = _private_directory(review)
    output = Path(output).absolute()
    _private_directory(output.parent)
    if output.exists() or output.is_symlink():
        raise ValueError('new_output_directory_required')
    source = review / 'decisions.jsonl.gz'
    summary_path = review / 'summary.json'
    if source.is_symlink() or summary_path.is_symlink():
        raise ValueError('regular_source_files_required')
    summary_hash = sha(summary_path)
    summary = json.loads(summary_path.read_text())
    source_hash = sha(source)
    if source_hash != summary['decisions.jsonl.gz']['sha256']:
        raise ValueError('source_decisions_hash_mismatch')
    output.mkdir(mode=448)
    data_path = output / 'per-decision-opportunities.jsonl.gz'
    narrative_path = output / 'individual-opportunity-reviews.md.gz'
    counts = collections.Counter()
    domains = collections.defaultdict(collections.Counter)
    contexts = collections.defaultdict(collections.Counter)
    hands = set()
    with gzip.open(source, 'rt') as rows, gzip.open(data_path, 'xt') as data, gzip.open(narrative_path, 'xt') as narrative:
        narrative.write('# PLO river conditional opportunity reviews\n\nZero-equity thresholds are conditional algebra, not observed fold frequencies or recommendations. Existing exact rank and card-removal facts are reused.\n\n')
        for line in rows:
            row = review_opportunity(json.loads(line))
            if row is None:
                continue
            hands.add(row['handId'])
            data.write(json.dumps(row, separators=(',', ':'), allow_nan=False) + '\n')
            narrative.write('## ' + row['decisionId'] + ' / ' + row['domain'] + '\n\n' + '\n\n'.join(row['notes']) + '\n\nConditional size diagnostics: ' + json.dumps(row['conditionalLegalSizeDiagnostics']) + '\n\n')
            context = json.dumps(row['ruleContext'], sort_keys=True, separators=(',', ':'))
            for key in ('decisions', row['opportunityClass'], 'action_' + row['recordedAction']):
                counts[key] += 1
                domains[row['domain']][key] += 1
                contexts[context][key] += 1
            if row['conditionalLegalSizeDiagnostics']:
                counts['decisionsWithConditionalSizeDiagnostics'] += 1
                counts['sizeDiagnostics'] += len(row['conditionalLegalSizeDiagnostics'])
            if row['blockerFacts']:
                counts['existingBlockerFactDecisions'] += 1
    if sha(source) != source_hash or sha(summary_path) != summary_hash:
        raise ValueError('source_changed_during_appendix_generation')
    receipt = {'schemaVersion': 1, 'sourceDecisionsSha256': source_hash, 'sourceSummarySha256': summary_hash, 'generatorSha256': sha(Path(__file__)), 'counts': dict(counts), 'uniqueHands': len(hands), 'byDomain': dict(domains), 'byExactRuleContext': dict(contexts), 'artifacts': {path.name: {'sha256': sha(path), 'bytes': path.stat().st_size} for path in (data_path, narrative_path)}, 'gtoVerified': False, 'activationAllowed': False, 'limitations': ['Known-own-card PLO4/5/6/8 river decisions only; missing node and rank facts remain unknown.', 'Existing rank facts reused; no new enumeration, private opponent cards or outcome-informed ranges.', 'Captured legal bounds are not independently authenticated original-runtime authority.', 'Thresholds assume all incremental risk matched, zero final share on continuation, no later wager and no costs.', 'Short calls, split pots, multiway dependencies, check/call baselines and tournament utility remain unpriced.', 'No actual action is classified as a bluff, no fold probability fitted, and no strategy activated.']}
    (output / 'summary.json').write_text(json.dumps(receipt, indent=2) + '\n')
    for path in (data_path, narrative_path, output / 'summary.json'):
        path.chmod(384)
    return receipt

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = build_appendix(args.review, args.output)
    print(json.dumps({key: result[key] for key in ('counts', 'uniqueHands', 'gtoVerified', 'activationAllowed')}))
if __name__ == '__main__':
    main()
