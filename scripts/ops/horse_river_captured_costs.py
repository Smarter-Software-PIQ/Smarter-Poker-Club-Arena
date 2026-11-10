"""Strict original-node binding to the existing pure TypeScript settlement owner."""
import hashlib
import json
from pathlib import Path
import subprocess
from fractions import Fraction


def captured_terminal_prices(request):
    original = request.get('capturedOriginal', {})
    info = original.get('informationSet')
    if not isinstance(info, dict):
        raise ValueError('original_information_required')
    digest = hashlib.sha256(json.dumps(info, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    if digest != original.get('informationSha256'):
        raise ValueError('original_information_hash_mismatch')
    state = info.get('publicState') or {}
    seats = state.get('seats') or []
    hero = next((s for s in seats if s[0] == info.get('heroSeat')), None)
    other = next((s for s in seats if s[0] != info.get('heroSeat')), None)
    def units(value):
        if type(value) not in (int, float):
            raise ValueError('original_amount_required')
        cents = Fraction(str(value)) * 100
        if cents.denominator != 1 or cents < 0:
            raise ValueError('original_amount_off_cent_grid')
        return int(cents)
    lightning = request.get('costModel') == 'captured-lightning-bb-ante-v1'
    if lightning:
        rule = original.get('ruleContext') or {}
        context = request['context']
        if (original.get('domain') != 'cash/' + str(info.get('variant')) + '/lightning'
                or any(rule.get(k) != v for k, v in {
                    'format': 'cash', 'variant': info.get('variant'), 'speedFormat': 'lightning',
                    'bettingStructure': 'pot_limit', 'anteType': 'big_blind', 'ante': state.get('ante'),
                    'bigBlind': state.get('bigBlind'), 'asset': 'chips', 'boardCount': 1,
                    'bombPot': False, 'allInOrFold': False, 'tournamentStage': 'cash'
                }.items())):
            raise ValueError('lightning_rule_context_required')
        if (not 2 <= len(seats) <= 10 or context['dealtCount'] != len(seats)
                or not all(len(s) == 7 and s[2] == s[5] == 0 and s[6] in (0, 1) for s in seats)
                or len({s[0] for s in seats}) != len(seats)):
            raise ValueError('unsupported_lightning_seats')
        live = sorted((s for s in seats if s[6] == 0), key=lambda s: (s[0] <= state['dealerSeat'], s[0]))
        if len(live) != 2 or not hero or live[-1] != hero:
            raise ValueError('original_closing_check_unproven')
        other = live[0]
        pre = [a for a in info.get('priorPublicActions', []) if a.get('stage') == 'preflop']
        blinds = [a for a in pre if a.get('action') == 'bb']
        antes = [a for a in pre if a.get('action') == 'ante']
        if (state.get('anteType') != 'big_blind' or units(state.get('ante')) != context['anteUnits']
                or len(blinds) != 1 or len(antes) != 1 or antes[0].get('dead') is not True
                or any(a.get('origin') != 'forced' for a in (blinds[0], antes[0]))
                or blinds[0].get('seat') != antes[0].get('seat')
                or units(blinds[0].get('amount')) != units(state.get('bigBlind'))
                or units(antes[0].get('amount')) != context['anteUnits']
                or context['deadUnits'] != context['anteUnits']
                or sum(units(s[4]) for s in seats) != context['deadUnits']
                or not any(s[0] == antes[0]['seat'] and units(s[4]) == context['anteUnits'] for s in seats)):
            raise ValueError('original_bb_ante_unproven')
        # Both continuing seats contest every chip. Refuse unmatched prior
        # money or a folded contribution beyond either live player's level.
        levels = [units(s[3]) - units(s[4]) for s in seats]
        matched = units(hero[3]) - units(hero[4])
        if (min(levels) < 0 or matched != units(other[3]) - units(other[4])
                or max(levels) != matched):
            raise ValueError('unsupported_original_pot')
    elif (len(seats) != 2 or not hero or not other or state.get('ante') != 0
            or info.get('heroSeat') != state.get('dealerSeat')
            or not all(len(s) == 7 and s[2] == s[4] == s[5] == s[6] == 0 for s in seats)
            or hero[3] != other[3]):
        raise ValueError('unsupported_original_context')
    if (info.get('street') != 'river' or info.get('tournamentStage', {}).get('phase') != 'cash'
            or info.get('structure') != 'pot_limit' or state.get('asset') != 'chips'
            or state.get('chipUnit') != 0.01 or state.get('boardCount') != 1
            or state.get('bombPot') is not False or state.get('allInOrFold') is not False
            or state.get('toCall') != 0 or state.get('currentBet') != 0
            or units(state.get('pot')) != sum(units(s[3]) for s in seats)):
        raise ValueError('unsupported_original_context')
    prior = [a for a in info.get('priorPublicActions', []) if (a.get('stage') or a.get('street')) == 'river']
    if not prior or prior[-1].get('seat') != other[0] or prior[-1].get('action') != 'check':
        raise ValueError('original_closing_check_unproven')
    board = state.get('boards')
    if not isinstance(board, list) or len(board) != 1 or not isinstance(board[0], str):
        raise ValueError('original_board_required')
    expected = {'hero': info.get('heroCards'), 'board': [board[0][n:n+2] for n in range(0, len(board[0]), 2)],
                'variant': info.get('variant'), 'potUnits': units(state['pot']),
                'heroStackUnits': units(hero[1]), 'opponentStackUnits': units(other[1]),
                'minimumBetUnits': units(state.get('minRaiseTo'))}
    for key, value in expected.items():
        if request.get(key) != value:
            raise ValueError('original_request_mismatch:' + key)
    if 'bet' not in (info.get('legalActions') or []) or 'check' not in info['legalActions']:
        raise ValueError('original_menu_required')
    if any(b > units(state.get('maxRaiseTo')) for b in request['betSizesUnits']):
        raise ValueError('original_maximum_bet_exceeded')
    costs = state.get('deductions') or {}
    if costs != request.get('capturedDeductions'):
        raise ValueError('original_deductions_mismatch')
    root = Path(__file__).resolve().parents[2]
    bridge = root / 'scripts/ops/horse-river-terminal-prices.mjs'
    payload = {'seats': seats, 'heroSeat': hero[0], 'dealerSeat': state['dealerSeat'],
               'bigBlind': state['bigBlind'], 'deductions': costs, 'bets': request['betSizesUnits']}
    if lightning:
        payload['lightningBbAnte'] = True
    result = subprocess.run(['node', str(bridge)], cwd=root,
                            input=json.dumps(payload), text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise ValueError('canonical_terminal_pricing_refused')
    rows = json.loads(result.stdout)
    table = {(r['bet'], r['result']): r['heroIncrementalUnits'] for r in rows}
    if len(table) != 4 * (len(request['betSizesUnits']) + 1):
        raise ValueError('incomplete_terminal_prices')
    files = ['scripts/ops/horse-river-terminal-prices.mjs', 'server/src/scripts/horseRiverTerminalPrices.ts', 'server/src/engine/PokerEngine.ts',
             'server/src/engine/WinnerUnitScaling.ts', 'server/src/engine/multiway/JointPotDistribution.ts',
             'server/src/engine/multiway/JointDeductions.ts']
    return table, {'informationSha256': digest, 'deductions': costs, 'terminalPrices': rows,
                   'arithmeticSourceSha256': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in files}}
