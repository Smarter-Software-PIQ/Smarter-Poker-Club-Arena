#!/usr/bin/env python3
"""window.py: the ONLY place capture times become epochs (toolkit v3, 2026-11-15, session 01Gw7aDs).
Why: the a7965514 preservation END was hand-typed as an epoch for 08:15Z instead of 10:15Z. Every time is now given as ISO UTC (YYYY-MM-DDTHH:MM:SSZ), converted here, and printed back.
  window.py epochs START END            -> "FROM_EPOCH END_EPOCH" on stdout; round trip on stderr; refuses bad order, >48 h, an END more than 48 h in the future
  window.py boundary ENGINE_START ANNOUNCEMENT -> effective window [first whole minute at/after engine start, last whole minute before the announcement)
  window.py iso EPOCH                   -> ISO UTC
"""
import sys
from datetime import datetime, timedelta, timezone
FMT = '%Y-%m-%dT%H:%M:%SZ'
def parse(s):
    s = s.strip()
    if '.' in s:  # accept 13:13:24.630Z from custodian lines
        head, frac = s.split('.', 1)
        if not frac.endswith('Z') or not frac[:-1].isdigit(): raise SystemExit('refused: bad time %r' % s)
        d = datetime.strptime(head + 'Z', FMT); return d.replace(tzinfo=timezone.utc, microsecond=int(frac[:-1].ljust(6, '0')[:6]))
    try: return datetime.strptime(s, FMT).replace(tzinfo=timezone.utc)
    except ValueError: raise SystemExit('refused: time must be ISO UTC like 2026-11-15T10:15:00Z, got %r' % s)
def iso(d): return d.astimezone(timezone.utc).strftime(FMT)
def epochs(a, b, now=None):
    A, B = parse(a), parse(b); now = now or datetime.now(timezone.utc)
    if not A < B: raise SystemExit('refused: END must be after START')
    if B - A > timedelta(hours=48): raise SystemExit('refused: window over 48 hours')
    if B > now + timedelta(hours=48): raise SystemExit('refused: END more than 48 h in the future')
    fa, fb = int(A.timestamp()), int(B.timestamp())
    assert iso(datetime.fromtimestamp(fa, timezone.utc)) == iso(A.replace(microsecond=0)) and iso(datetime.fromtimestamp(fb, timezone.utc)) == iso(B.replace(microsecond=0))
    return fa, fb
def boundary(start, announce):
    S, N = parse(start), parse(announce)
    s = S.replace(second=0, microsecond=0) + (timedelta(minutes=1) if (S.second or S.microsecond) else timedelta(0))
    e = N.replace(second=0, microsecond=0)
    if N.second == 0 and N.microsecond == 0: e -= timedelta(minutes=1)  # announcement exactly on a minute: that minute is excluded
    if not s < e: raise SystemExit('refused: empty window')
    return iso(s), iso(e)
if __name__ == '__main__':
    c = sys.argv[1] if len(sys.argv) > 1 else ''
    if c == 'epochs':
        fa, fb = epochs(sys.argv[2], sys.argv[3]); print(fa, fb)
        print('round trip: %s = %d, %s = %d' % (iso(datetime.fromtimestamp(fa, timezone.utc)), fa, iso(datetime.fromtimestamp(fb, timezone.utc)), fb), file=sys.stderr)
    elif c == 'boundary': print(*boundary(sys.argv[2], sys.argv[3]))
    elif c == 'iso': print(iso(datetime.fromtimestamp(int(sys.argv[2]), timezone.utc)))
    else: raise SystemExit(__doc__)
