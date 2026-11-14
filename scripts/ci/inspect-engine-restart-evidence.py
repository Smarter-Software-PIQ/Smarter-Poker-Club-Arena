#!/usr/bin/env python3
"""One manual read-only host diagnostic for an engine restart outside a break.

EngineRestartedOutsideTheBreak says the process uptime fell; it cannot say
who ended the process. That answer lives only on engine-01: the container's
state and restart count, Docker's event stream (die / kill / health_status),
the sp-autoheal log, the kernel log (an OOM kill), the systemd units that run
releases, and the last lines the dying process wrote. Without them a restart
is recorded with "root cause not established" (incident b6151c69, 2026-11-14).

This reads those sources for one bounded window and prints structured fields
and MASKED line templates only: every uuid, hex id, number, quoted string,
URL and e-mail is replaced before anything leaves this process, so no raw log
line, user id, chip amount or secret is exported. It never writes, restarts,
signals or changes anything on the host. The serving container's identity is
read before and after, and the run refuses if it is not the expected release.

An optional focus prefix (one 8-character tournament or table id prefix) also
keeps the masked templates of every engine line that names it, with the
prefix itself masked too, so one event's refusals inside the window can be
read without exporting any line.
"""
import datetime
import json
import re
import selectors
import subprocess
import sys
import time

CONTAINER = 'club-arena-engine'
AUTOHEAL = 'sp-autoheal'
READ_BUDGET_S = 60
MAX_LINES = 3_000_000
MAX_TEMPLATES = 200
TAIL_LINES = 60
MAX_WINDOW_MINUTES = 60
MAX_AGE_DAYS = 7
STAMP = re.compile(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z\s')
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.IGNORECASE)
HEX = re.compile(r'\b[0-9a-f]{6,}\b', re.IGNORECASE)
NUM = re.compile(r'(?<![A-Za-z_])-?\d+(?:\.\d+)?')
QUOTED = re.compile(r"'[^']{0,200}'|\"[^\"]{0,200}\"")
URL = re.compile(r'\b[a-z][a-z0-9+.-]*://\S+', re.IGNORECASE)
EMAIL = re.compile(r'\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b')
# Lines that describe the process lifecycle. Everything else is only counted.
LIFECYCLE = re.compile(
    r'FATAL|Uncaught|Unhandled|uncaughtException|unhandledRejection|shutdown|SIGTERM|SIGINT|SIGKILL'
    r'|Received shutdown|deadline|Leadership|leadership|liveness|process\.exit|heap|out of memory'
    r'|JavaScript heap|Allocation failed|ECONNRESET|Connection terminated|terminating connection'
    r'|draining|supervisor|Starting|http_listening|listening on|boot', re.IGNORECASE)
KERNEL = re.compile(r'oom|out of memory|killed process|segfault|general protection', re.IGNORECASE)
UNIT = re.compile(r'start|stop|restart|kill|fail|exit|deactivat|timeout', re.IGNORECASE)
EVENT_ACTIONS = {'create', 'start', 'restart', 'die', 'kill', 'stop', 'destroy', 'oom', 'pause',
                 'unpause', 'update'}


def mask(payload):
    text = URL.sub('<url>', payload)
    text = EMAIL.sub('<email>', text)
    text = UUID.sub('<id>', text)
    text = HEX.sub('<id>', text)
    text = QUOTED.sub('<s>', text)
    text = NUM.sub('<n>', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:240]


DOCKERD_LEVEL = re.compile(r'level=(warning|error)')
DOCKERD_FIELD = re.compile(r'\b(msg|error|container|exec|stream)=("(?:[^"\\]|\\.)*"|\S+)')


def mask_keep_words(payload):
    # Dockerd's own warning/error text names its failure ("OCI runtime exec
    # failed", "context deadline exceeded"); quoted strings are kept, every
    # address, identifier and number is still masked.
    text = URL.sub('<url>', payload)
    text = EMAIL.sub('<email>', text)
    text = UUID.sub('<id>', text)
    text = HEX.sub('<id>', text)
    text = NUM.sub('<n>', text)
    return re.sub(r'\s+', ' ', text).strip()[:400]


def read_dockerd_failures(argv):
    events, per_minute, scanned = [], {}, 0
    for line in stream(argv):
        if line is None:
            break
        scanned += 1
        stamp = line.split(' ', 1)[0][:16]
        per_minute[stamp] = per_minute.get(stamp, 0) + 1
        if 'dockerd' in line and DOCKERD_LEVEL.search(line) and len(events) < 200:
            fields = {k: mask_keep_words(v) for k, v in DOCKERD_FIELD.findall(line)}
            events.append({'at': line.split(' ', 1)[0][:32], 'level': DOCKERD_LEVEL.search(line).group(1), **fields})
    return {'linesScanned': scanned, 'hostLinesPerMinute': per_minute, 'dockerdFailures': events}


def parse_instant(text):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', text or ''):
        raise RuntimeError('window_start_refused')
    return datetime.datetime.strptime(text, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)


def iso(moment):
    return moment.strftime('%Y-%m-%dT%H:%M:%SZ')


def window(start_text, minutes_text, now):
    start = parse_instant(start_text)
    if not re.fullmatch(r'[0-9]{1,2}', minutes_text or '') or not 5 <= int(minutes_text) <= MAX_WINDOW_MINUTES:
        raise RuntimeError('window_minutes_refused')
    end = start + datetime.timedelta(minutes=int(minutes_text))
    if end > now or now - start > datetime.timedelta(days=MAX_AGE_DAYS):
        raise RuntimeError('window_refused')
    return start, end


def run(argv, timeout=20):
    return subprocess.run(argv, capture_output=True, text=True, errors='replace', timeout=timeout)


def identity(expected):
    raw = run(['docker', 'container', 'inspect', '-f',
               '{{.Id}} {{.Image}} {{index .Config.Labels "sp.release.sha"}}', CONTAINER]).stdout.strip()
    fields = raw.split()
    if (len(fields) != 3 or not re.fullmatch(r'[0-9a-f]{64}', fields[0])
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', fields[1]) or fields[2] != expected):
        raise RuntimeError('container_identity_refused')
    return {'containerId': fields[0][:12], 'imageId': fields[1][7:19], 'releaseSha': fields[2]}


def container_state(name):
    result = run(['docker', 'container', 'inspect', name])
    if result.returncode != 0:
        return {'present': False}
    try:
        data = json.loads(result.stdout)[0]
    except Exception:
        return {'present': True, 'readable': False}
    state = data.get('State') or {}
    health = state.get('Health') or {}
    host = data.get('HostConfig') or {}
    labels = (data.get('Config') or {}).get('Labels') or {}
    return {
        'present': True,
        'containerId': str(data.get('Id', ''))[:12],
        'created': data.get('Created'),
        'restartCount': data.get('RestartCount'),
        'restartPolicy': (host.get('RestartPolicy') or {}).get('Name'),
        'autohealLabel': labels.get('autoheal'),
        'status': state.get('Status'),
        'startedAt': state.get('StartedAt'),
        'finishedAt': state.get('FinishedAt'),
        'exitCode': state.get('ExitCode'),
        'oomKilled': state.get('OOMKilled'),
        'error': mask(str(state.get('Error') or '')),
        'healthStatus': health.get('Status'),
        'healthFailingStreak': health.get('FailingStreak'),
        # Docker keeps only the last five probes; they describe now, not the window.
        'healthLog': [{'start': entry.get('Start'), 'end': entry.get('End'),
                       'exitCode': entry.get('ExitCode'), 'output': mask(str(entry.get('Output') or ''))}
                      for entry in (health.get('Log') or [])[-5:]],
    }


def docker_events(start, end):
    argv = ['docker', 'events', '--since', iso(start), '--until', iso(end), '--format', '{{json .}}',
            '--filter', f'container={CONTAINER}', '--filter', f'container={AUTOHEAL}']
    result = run(argv, timeout=30)
    events = []
    for line in result.stdout.splitlines()[:2000]:
        try:
            event = json.loads(line)
        except Exception:
            continue
        action = str(event.get('Action') or event.get('status') or '')
        base = action.split(':', 1)[0].strip()
        if base not in EVENT_ACTIONS and not base.startswith('health_status') and base != 'exec_die':
            continue
        attributes = (event.get('Actor') or {}).get('Attributes') or {}
        nanos = event.get('timeNano')
        events.append({
            'at': (datetime.datetime.fromtimestamp(int(nanos) / 1e9, datetime.timezone.utc)
                   .isoformat(timespec='milliseconds') if nanos else None),
            'action': mask(action) if base == 'exec_die' else action[:80],
            'container': attributes.get('name'),
            'exitCode': attributes.get('exitCode'),
            'signal': attributes.get('signal'),
            'releaseSha': attributes.get('sp.release.sha'),
        })
    return {'readOk': result.returncode == 0, 'count': len(events), 'events': events}


def stream(argv):
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                               errors='replace', bufsize=1)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    started = time.monotonic()
    scanned = 0
    try:
        while True:
            if time.monotonic() - started > READ_BUDGET_S or scanned >= MAX_LINES:
                yield None
                return
            if not selector.select(timeout=1):
                if process.poll() is not None:
                    return
                continue
            line = process.stdout.readline()
            if not line:
                return
            scanned += 1
            yield line
    finally:
        try:
            process.kill()
        except Exception:
            pass


def add_template(bucket, template, when):
    entry = bucket.get(template)
    if entry is None:
        if len(bucket) >= MAX_TEMPLATES:
            entry = bucket.setdefault('<more templates>', {'count': 0, 'first': when, 'last': when})
        else:
            entry = bucket[template] = {'count': 0, 'first': when, 'last': when}
    entry['count'] += 1
    entry['last'] = when


def ordered(bucket):
    return [{'template': template, **entry}
            for template, entry in sorted(bucket.items(), key=lambda item: (item[1]['first'] or '', -item[1]['count']))]


def read_container_log(name, start, end, keep, boundary=None, focus=None):
    templates, per_minute, tail, focused = {}, {}, [], {}
    scanned, truncated, first, last = 0, False, None, None
    argv = ['docker', 'logs', '--since', iso(start), '--until', iso(end), '--timestamps', name]
    for line in stream(argv):
        if line is None:
            truncated = True
            break
        scanned += 1
        if len(line) > 8192:
            continue
        stamp = STAMP.match(line)
        when = (stamp.group(1) + '.' + (stamp.group(2) or '0')[:3] + 'Z') if stamp else None
        payload = line[stamp.end():] if stamp else line
        if when:
            first = first or when
            last = when
            minute = when[:16]
            per_minute[minute] = per_minute.get(minute, 0) + 1
        if boundary and when and when < boundary:
            tail.append({'at': when, 'line': mask(payload)})
            if len(tail) > TAIL_LINES:
                tail.pop(0)
        if keep(payload):
            add_template(templates, mask(payload), when)
        if focus and focus in payload:
            add_template(focused, mask(payload.replace(focus, '<F>')), when)
    return {'linesScanned': scanned, 'readTruncated': truncated, 'firstLineAt': first, 'lastLineAt': last,
            'linesPerMinute': per_minute, 'templates': ordered(templates),
            'focusTemplates': ordered(focused) if focus else None,
            'tailBeforeBoundary': tail if boundary else None, 'boundary': boundary}


def read_journal(argv, keep):
    templates, scanned = {}, 0
    for line in stream(argv):
        if line is None:
            break
        scanned += 1
        if keep(line):
            parts = line.split(' ', 1)
            add_template(templates, mask(parts[1] if len(parts) == 2 else line), parts[0][:32])
    return {'linesScanned': scanned, 'templates': ordered(templates)}


def parse_focus(text):
    # '-' means none; otherwise one 8-character lowercase hex prefix (a
    # tournament or table id prefix, as the engine logs them).
    if text == '-':
        return None
    if not re.fullmatch(r'[0-9a-f]{8}', text or ''):
        raise RuntimeError('focus_refused')
    return text


def main(expected, start_text, minutes_text, focus_text='-'):
    if not re.fullmatch(r'[0-9a-f]{40}', expected or ''):
        raise RuntimeError('expected_sha_refused')
    focus = parse_focus(focus_text)
    start, end = window(start_text, minutes_text, datetime.datetime.now(datetime.timezone.utc))
    before = identity(expected)
    engine = container_state(CONTAINER)
    started_at = str(engine.get('startedAt') or '')
    # The current process's own start is the boundary: lines before it were
    # written by whatever ran before, and the last of them are the ones that
    # say how it ended.
    boundary = None
    if re.match(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', started_at) and iso(start) <= started_at[:19] + 'Z' <= iso(end):
        boundary = started_at[:23] + 'Z' if len(started_at) >= 23 else started_at[:19] + '.000Z'
    report = {
        'schemaVersion': 1,
        'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'engineSha': expected,
        'window': {'start': iso(start), 'end': iso(end)},
        'focusPrefixGiven': focus is not None,
        'identityBefore': before,
        'hostBootedAt': run(['uptime', '-s']).stdout.strip()[:32],
        'engineContainer': engine,
        'autohealContainer': container_state(AUTOHEAL),
        'dockerEvents': docker_events(start, end),
        'autohealLog': read_container_log(AUTOHEAL, start, end, lambda payload: True),
        'engineLog': read_container_log(CONTAINER, start, end, lambda payload: bool(LIFECYCLE.search(payload)),
                                        boundary, focus),
        'kernelLog': read_journal(['journalctl', '-k', '--since', start.strftime('%Y-%m-%d %H:%M:%S UTC'),
                                   '--until', end.strftime('%Y-%m-%d %H:%M:%S UTC'), '--no-pager',
                                   '-o', 'short-iso'], lambda line: bool(KERNEL.search(line))),
        'unitJournal': read_journal(['journalctl', '--since', start.strftime('%Y-%m-%d %H:%M:%S UTC'),
                                     '--until', end.strftime('%Y-%m-%d %H:%M:%S UTC'), '--no-pager',
                                     '-o', 'short-iso', '-u', 'club-arena-engine*', '-u', 'docker.service'],
                                    lambda line: bool(UNIT.search(line))),
        'hostJournal': read_dockerd_failures(['journalctl', '--since', start.strftime('%Y-%m-%d %H:%M:%S UTC'),
                                              '--until', end.strftime('%Y-%m-%d %H:%M:%S UTC'), '--no-pager',
                                              '-o', 'short-iso']),
    }
    report['identityAfter'] = identity(expected)
    report['rawLogsExported'] = False
    report['readOnly'] = True
    print(json.dumps(report, sort_keys=True))


def cli(argv):
    try:
        if len(argv) not in (4, 5):
            raise RuntimeError('argument_refused')
        main(*argv[1:])
        return 0
    except Exception:
        # Never emit subprocess output, exception messages, URLs or log bodies.
        print('{"readOnly":true,"status":"diagnostic_refused","rawLogsExported":false}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(cli(sys.argv))
