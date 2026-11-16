#!/usr/bin/env python3
"""near_tight.py OBS_DIR OUT_JSON [ENGINE_LINE=0.1558] [METHOD_LINE=0.18]  (toolkit v3, 2026-11-15, session 01Gw7aDs)
REPORT ONLY. Does not grade and does not change the frozen method (af0bd14cbae3d66a). For Hold'em's tight-calibration review it lists the faced witnesses
whose opponent's prior VPIP sits in the band (ENGINE_LINE, METHOD_LINE], i.e. tight by the method but above the line where the engine reads tight, and for every
tight-class faced witness shows the engine's participation read and, on builds that journal decision.preflopReadReceipt, the base and final 3-bet/call/4-bet
thresholds (did the read move the bar?). Joins packet witnesses to witness rows by turnKey."""
import json, sys, collections, hashlib
from pathlib import Path
O = Path(sys.argv[1]); out = Path(sys.argv[2]); EL = float(sys.argv[3]) if len(sys.argv) > 3 else 0.1558; ML = float(sys.argv[4]) if len(sys.argv) > 4 else 0.18
if out.exists(): raise SystemExit('refused: output exists')
W = [json.loads(l) for l in (O / 'tight-maniac/witnesses.jsonl').read_text().splitlines() if l.strip()]
rows = {}
for l in (O / 'witness-rows.jsonl').read_text().splitlines():
    if l.startswith('{') and '"turnKey"' in l:
        r = json.loads(l); rows[r['turnKey']] = r
anon = lambda u: hashlib.sha256(u.encode()).hexdigest()[:8]
def moved(rc):
    if not rc: return None
    return any(rc.get('base' + k) is not None and rc.get(k[0].lower() + k[1:]) is not None and abs(rc['base' + k] - rc[k[0].lower() + k[1:]]) > 1e-9 for k in ('ThreeBetThreshold', 'CallThreshold', 'FourBetThreshold'))
def row(w):
    r = rows.get(w['turnKey']) or {}; rc = r.get('preflopReadReceipt'); st = ((w.get('engineRead') or {}).get('style') or {})
    return {'id': w['id'], 'opponent': anon(w['opponent']), 'variant': w['match']['variant'], 'mode': w['match']['mode'], 'stage': w['match']['stage'], 'class': w['class'], 'absentLike': w['absentLike'],
            'priorVpip': (w.get('prior') or {}).get('vpip'), 'priorPfr': (w.get('prior') or {}).get('pfr'), 'priorN': (w.get('prior') or {}).get('n'), 'engineParticipation': st.get('participation'),
            'tightRespect': bool(st.get('tightOpenerRespect') or st.get('tightReRaiserRespect')), 'receipt': rc, 'receiptMovedBar': moved(rc), 'proposal': w.get('proposal'), 'final': w.get('final'), 'changes': w.get('changes')}
faced = [w for w in W if w['type'] == 'faces_human_wager']
tight = [row(w) for w in faced if w['class'] == 'tight']
band = [row(w) for w in faced if (w.get('prior') or {}).get('vpip') is not None and EL < w['prior']['vpip'] <= ML]
def summ(rs):
    return {'n': len(rs), 'counting': sum(1 for r in rs if not r['absentLike']), 'humans': len({r['opponent'] for r in rs}), 'engineParticipation': dict(collections.Counter(str(r['engineParticipation']) for r in rs)),
            'tightRespect': sum(r['tightRespect'] for r in rs), 'withReceipt': sum(1 for r in rs if r['receipt']), 'receiptMovedBar': sum(1 for r in rs if r['receiptMovedBar']),
            'byHuman': {h: {'n': sum(1 for r in rs if r['opponent'] == h), 'vpip': next(r['priorVpip'] for r in rs if r['opponent'] == h), 'pfr': next(r['priorPfr'] for r in rs if r['opponent'] == h)} for h in sorted({r['opponent'] for r in rs})}}
R = {'reportOnly': True, 'method': 'TIGHT-MANIAC-METHOD-v1 af0bd14cbae3d66a (unchanged)', 'engineLine': EL, 'methodLine': ML, 'obs': str(O),
     'tightFaced': summ(tight), 'nearTightBand': summ(band), 'tightFacedRows': tight, 'nearTightBandRows': band,
     'note': 'receipt is null on builds before decision.preflopReadReceipt was journaled (7e8688d3 journals it); a null receipt is not evidence that the bar did not move'}
out.write_text(json.dumps(R, indent=1)); out.chmod(0o600)
print(json.dumps({k: R[k] for k in ('engineLine', 'methodLine', 'tightFaced', 'nearTightBand')}, indent=1))
