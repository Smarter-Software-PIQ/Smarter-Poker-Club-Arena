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
    if (len(seats) != 2 or not hero or not other or info.get('street') != 'river'
            or info.get('tournamentStage', {}).get('phase') != 'cash'
            or info.get('structure') != 'pot_limit' or state.get('asset') != 'chips'
            or state.get('chipUnit') != 0.01 or state.get('boardCount') != 1
            or state.get('bombPot') is not False or state.get('allInOrFold') is not False
            or state.get('ante') != 0 or state.get('toCall') != 0
            or state.get('currentBet') != 0 or info.get('heroSeat') != state.get('dealerSeat')
            or not all(len(s) == 7 and s[2] == 0 and s[4] == 0 and s[5] == 0 and s[6] == 0 for s in seats)
            or hero[3] != other[3] or units(state.get('pot')) != units(hero[3]) + units(other[3])):
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
