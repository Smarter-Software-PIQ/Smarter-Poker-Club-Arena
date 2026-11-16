#!/usr/bin/env python3
"""segments.py START END -> space-separated ISO points cutting [START, END) into segments of at most 2 hours (the maintained readers refuse longer)."""
import sys
from datetime import datetime, timedelta, timezone
def points(a, b, hours=2):
    p = lambda s: datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    a, b = p(a), p(b)
    if not a < b: raise SystemExit('END must be after START')
    if b - a > timedelta(hours=48): raise SystemExit('window over 48 hours refused')
    out = [a]
    while out[-1] + timedelta(hours=hours) < b: out.append(out[-1] + timedelta(hours=hours))
    return [x.strftime('%Y-%m-%dT%H:%M:%SZ') for x in out + [b]]
def pairs(a, b, hours=2):
    x = points(a, b, hours); return list(zip(x[:-1], x[1:]))
if __name__ == '__main__': print(' '.join(points(sys.argv[1], sys.argv[2])))
