#!/usr/bin/env python3
"""A fake host for the rolling release harness: docker, curl, systemctl,
caddy, the release seal, engine-up and the database proof, all backed by one
JSON world file. Engines advance one unit per status read while yielding."""
import json, os, re, sys

WORLD = os.environ['ROLLING_WORLD']
def load():
    with open(WORLD) as f: return json.load(f)
def save(w):
    with open(WORLD, 'w') as f: json.dump(w, f)
def log(w, entry): w.setdefault('ops', []).append(entry)

def container(w, ref):
    for name, c in w['containers'].items():
        if name == ref or c['id'] == ref: return name, c
    return None, None

def status(w, name, c):
    e = c.get('engine')
    if e is None: return None
    fail = w.get('fail', {})
    if e['mode'] == 'yielding' and c['running']:
        target = next((n for n, x in w['containers'].items() if x.get('engine') and x['engine']['instance'] == e['successor']), None)
        stuck = fail.get('stuck') == name or (fail.get('stuck_after', {}).get(name) is not None and w.get('moves', 0) >= fail['stuck_after'][name])
        if target and w['containers'][target]['running'] and not stuck and e['owned'] > 0:
            e['owned'] -= 1
            t = w['containers'][target]['engine']
            t['owned'] += 1; t['adopted'] += 1
            w['moves'] = w.get('moves', 0) + 1
        if e['owned'] == 0 and not stuck:
            e['mode'] = 'retired'
    return {'flag': 'on', 'instanceId': e['instance'], 'version': c['sha'], 'mode': e['mode'],
            'successor': e.get('successor'), 'owned': e['owned'],
            'yields': [{'state': 'kept'}] * e.get('kept', 0),
            'adoptions': [{'state': 'adopted'}] * e['adopted'], 'blockedRetirement': None, 'retiredAtMs': None}

def docker(args):
    w = load()
    rc, out = 0, ''
    if args[0] == 'exec':
        i = args.index('-'); method, path, body = args[i+1], args[i+2], args[i+3] if len(args) > i+3 else ''
        name, c = container(w, args[2])
        if not c or not c['running'] or c.get('engine') is None: rc = 1
        elif not c['engine'].get('capable', True): rc = 4; out = '{"error":"Not found"}'
        else:
            e = c['engine']
            if path.endswith('/yield'):
                succ = json.loads(body)['successorInstanceId']
                if e['mode'] == 'retired' or (e['mode'] == 'yielding' and e['successor'] != succ) or w.get('fail', {}).get('refuse_yield') == name: rc = 1
                else: e['mode'] = 'yielding'; e['successor'] = succ; e['kept'] = 0; log(w, f'yield {name} -> {succ}')
            elif path.endswith('/abort'):
                if e['mode'] == 'yielding': e['mode'] = 'serving'; e['successor'] = None; log(w, f'abort {name}')
            st = status(w, name, c)
            if rc == 0: out = json.dumps(st)
    elif args[0] == 'container' and args[1] == 'inspect' or args[0] == 'inspect':
        fmt = args[args.index('-f') + 1] if '-f' in args else None
        name, c = container(w, args[-1])
        if not c: rc = 1
        elif fmt is None: out = ''
        elif fmt == '{{.State.Running}}': out = 'true' if c['running'] else 'false'
        elif fmt == '{{.Id}}': out = c['id']
        elif fmt == '{{.Image}}': out = c['image']
        elif fmt == '{{.State.StartedAt}}': out = '2026-11-20T03:00:00.000000000Z'
        elif 'sp.release.sha' in fmt: out = c['sha']
        elif 'sp.engine-up.successor' in fmt: out = '1' if c.get('successor') else ''
        else: out = ''
    elif args[0] in ('update', 'tag', 'start'):
        if args[0] == 'start':
            name, c = container(w, args[-1])
            if c: c['running'] = True
        log(w, ' '.join(args[:1] + args[-1:]))
    elif args[0] == 'stop':
        name, c = container(w, args[-1])
        if c: c['running'] = False; log(w, f'stop {name}')
    elif args[0] == 'rename':
        name, c = container(w, args[1])
        if c: w['containers'][args[2]] = w['containers'].pop(name); log(w, f'rename {name} {args[2]}')
    elif args[0] == 'rm':
        name, c = container(w, args[-1])
        if c: w['containers'].pop(name); log(w, f'rm {name}')
    elif args[0] == 'ps':
        out = '\n'.join(n for n, c in w['containers'].items() if c.get('engine') is not None)
    save(w)
    sys.stdout.write(out + ('\n' if out else ''))
    return rc

def curl(args):
    w = load(); url = next(a for a in args if a.startswith('http'))
    m = re.match(r'http://127\.0\.0\.1:(\d+)/health', url)
    if m: port = int(m.group(1))
    elif url.startswith(os.environ.get('ENGINE_URL', 'https://engine.example')):
        port = int(re.search(r'reverse_proxy localhost:(\d+)', open(os.environ['ENGINE_ROLLING_CADDYFILE']).read()).group(1))
    else: return 22
    for name, c in w['containers'].items():
        if c['running'] and c.get('port') == port and c.get('engine'):
            print(json.dumps({'running': True, 'releaseSha': c['sha'], 'liveness': 'ok', 'instanceId': c['engine']['instance']}))
            if '--write-out' in args: print(200)
            return 0
    return 7

def seal(args):
    w = load(); cmd = args[0]
    if cmd == 'prepare':
        if w.get('fail', {}).get('prepare'): return 1
        w['token'] = 'a' * 64; log(w, 'seal prepare'); save(w); print(w['token']); return 0
    if cmd == 'commit':
        name = args[args.index('--container') + 1]; w['desired'] = {'sha': args[args.index('--sha') + 1], 'container': name}
        log(w, f'seal commit {name}'); save(w); return 0
    if cmd == 'attest-commit': return 0 if w.get('desired') else 1
    if cmd == 'abort': log(w, 'seal abort'); save(w); return 0
    if cmd == 'get':
        print(w['desired']['sha'] if args[1] == 'desired-sha' else w.get('desiredImage', 'sha256:' + '1' * 64)); return 0
    return 0

def engine_up(args):
    w = load(); name = os.environ['CONTAINER']; port = int(os.environ['PORT'])
    if w.get('fail', {}).get('engine_up') == name: return 1
    if name in w['containers']: return 1
    n = len(w['containers']) + 1
    w['containers'][name] = {'id': f'{n:064x}', 'image': os.environ['IMAGE'], 'sha': w['target'], 'port': port, 'running': True,
                             'successor': True, 'engine': {'instance': f'179500000000{n}-0000000{n}', 'mode': 'serving', 'owned': 0, 'adopted': 0, 'successor': None}}
    log(w, f'engine-up --successor {name} {port} autoheal={os.environ.get("SUCCESSOR_AUTOHEAL")}')
    save(w); return 0

tool = os.path.basename(sys.argv[0])
handler = {'docker': docker, 'curl': curl, 'seal': seal, 'engine-up': engine_up,
           'systemctl': lambda a: 1 if (a[0] == 'reload' and load().get('fail', {}).get('caddy')) else 0,
           'caddy': lambda a: 0, 'dbproof': lambda a: 0}[tool]
sys.exit(handler(sys.argv[1:]) or 0)
