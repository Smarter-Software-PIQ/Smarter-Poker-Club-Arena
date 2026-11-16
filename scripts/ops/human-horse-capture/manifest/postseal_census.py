"""Complete-window slicing and counting for protocol v4. Pure: the reader is injected.
Slices are half-open [start, end), contiguous, 1 minute (a 5-minute slice timed out at 10 s under evening load on 2026-11-12), covering the window exactly once. One attempt per slice."""
import datetime
from collections import Counter
from postseal_selection import classify_roster
SLICE = datetime.timedelta(minutes=1)
MAX_ROWS = 6000   # the SQL reads LIMIT 6001, so 6001 rows proves truncation


def window_slices(start, end):
    if end <= start: raise ValueError('empty_window')
    out, cursor = [], start
    while cursor < end:
        nxt = min(cursor + SLICE, end); out.append((cursor, nxt)); cursor = nxt
    return out


def read_window(start, end, reader, excluded_ids):
    fmt = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')
    slices, total, seen, hands = [], Counter(), set(), []
    for slice_start, slice_end in window_slices(start, end):
        entry = {'startUtc': fmt(slice_start), 'endUtc': fmt(slice_end)}
        try:
            rows = reader(slice_start, slice_end)
            if len(rows) > MAX_ROWS: raise RuntimeError('slice_truncated_over_6000_headers')
            ids = [row['hand_id'] for row in rows]
            if len(set(ids)) != len(ids) or seen.intersection(ids): raise RuntimeError('duplicate_hand_across_or_within_slices')
            for row in rows:
                at = datetime.datetime.fromisoformat(row['created_at'])
                if not slice_start <= at < slice_end: raise RuntimeError('hand_outside_slice_boundary')
            counts, kept, sources = Counter(), [], Counter()
            for row in rows:
                roster_class = classify_roster(row.get('roster'), excluded_ids)
                cls = roster_class['class']
                kept.append({k: row[k] for k in ('hand_id', 'game_variant', 'tournament', 'original_speed', 'binding', 'has_human', 'created_at')} | {'roster_class': roster_class, 'speed_source': row.get('speed_source', 'recorded')})
                sources[row.get('speed_source', 'recorded')] += 1
                counts['|'.join((row['game_variant'] or 'null', 'tournament' if row['tournament'] else 'cash', row['original_speed'], row['binding'], cls,
                                 'flagged_human' if row['has_human'] else 'not_flagged'))] += 1
            seen.update(ids); hands.extend(kept)   # only a fully accepted slice contributes
            entry.update(status='read', hands=len(rows), counts=dict(sorted(counts.items())), speedSources=dict(sorted(sources.items()))); total.update(counts)
        except Exception as failure:
            entry.update(status='MISSING_SERIES', reason=str(failure)[:200])
        slices.append(entry)
    return slices, total, hands
