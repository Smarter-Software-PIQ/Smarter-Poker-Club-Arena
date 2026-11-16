"""Window-bound producer metric deltas from two /metrics snapshots plus their /health bodies. Pure functions.
A counter delta is reported only when the process did not restart and the series exists at both ends."""
import re
LINE = re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(-?[0-9.eE+]+|NaN)$')

def parse(text):
    types, values = {}, {}
    for line in text.splitlines():
        if line.startswith('# TYPE '):
            _, _, name, kind = line.split(None, 3); types[name] = kind.strip()
        elif line and not line.startswith('#'):
            m = LINE.match(line.strip())
            if m: values[m.group(1) + (m.group(2) or '')] = float(m.group(3))
    return types, values

def window_delta(start_text, end_text, start_health, end_health, prefix='poker_horse_'):
    st, sv = parse(start_text); et, ev = parse(end_text)
    same_instance = bool(start_health.get('instanceId')) and start_health.get('instanceId') == end_health.get('instanceId')
    same_release = bool(start_health.get('releaseSha')) and start_health.get('releaseSha') == end_health.get('releaseSha')
    ps, pe = sv.get('process_start_time_seconds'), ev.get('process_start_time_seconds')
    same_process = ps is not None and ps == pe
    stable = same_instance and same_release and same_process
    out = {'processStable': stable, 'sameInstance': same_instance, 'sameRelease': same_release, 'sameProcessStart': same_process,
           'instanceIds': [start_health.get('instanceId'), end_health.get('instanceId')], 'releaseShas': [start_health.get('releaseSha'), end_health.get('releaseSha')],
           'counters': {}, 'info': {}, 'missingAtStart': [], 'missingAtEnd': [], 'resets': []}
    base = lambda series: series.split('{', 1)[0]
    for series in sorted(set(sv) | set(ev)):
        name = base(series)
        if not name.startswith(prefix): continue
        kind = et.get(name) or st.get(name)
        if name.endswith('_info'):
            out['info'][series] = {'start': sv.get(series), 'end': ev.get(series)}; continue
        if kind != 'counter': continue
        if series not in sv: out['missingAtStart'].append(series); out['counters'][series] = {'delta': None, 'reason': 'missing_at_start'}; continue
        if series not in ev: out['missingAtEnd'].append(series); out['counters'][series] = {'delta': None, 'reason': 'missing_at_end'}; continue
        delta = ev[series] - sv[series]
        if not stable: out['counters'][series] = {'delta': None, 'reason': 'process_restarted_or_identity_unknown'}
        elif delta < 0: out['resets'].append(series); out['counters'][series] = {'delta': None, 'reason': 'counter_reset'}
        else: out['counters'][series] = {'delta': delta, 'start': sv[series], 'end': ev[series]}
    return out
