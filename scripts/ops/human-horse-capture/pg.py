"""Read-only psql helper shared by the post-capture tools (same route as the maintained census)."""
import importlib.util, json, os, subprocess
from pathlib import Path
# HVH_REPO: checkout providing scripts/dr/native-supabase-export.py and the CA certificate (default: this repository).
# HVH_SUPABASE_LINK: the supabase-linked directory (default: the owner's canonical clone).
REPO = Path(os.environ.get('HVH_REPO') or Path(__file__).resolve().parents[3]); LINK = Path(os.environ.get('HVH_SUPABASE_LINK', '/Users/smarter.poker/Documents/club-arena'))
_env = None
def env(timeout_ms=25000):
    global _env
    if _env is None:
        spec = importlib.util.spec_from_file_location('native_export', REPO / 'scripts/dr/native-supabase-export.py'); native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
        native.linked_project(LINK, 'kuklfnapbkmacvwxktbh'); _env = native.cli_environment(os.environ.get('HVH_SUPABASE_CLI', '/opt/homebrew/bin/supabase'), LINK)
        _env['PGSSLROOTCERT'] = str(REPO / 'scripts/ci/certificates/supabase-prod-ca-2021.crt'); _env['PGAPPNAME'] = 'human-horse-window-post-capture'
    e = dict(_env); e['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=%d -c lock_timeout=2000' % timeout_ms; return e
def rows(sql, timeout_ms=25000):
    """Returns (list of json rows, None) or (None, reason). One attempt."""
    try: r = subprocess.run([os.environ.get('HVH_PSQL', '/opt/homebrew/bin/psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, env=env(timeout_ms), capture_output=True, text=True, timeout=timeout_ms / 1000 + 15)
    except subprocess.TimeoutExpired: return None, 'client_timeout'
    if r.returncode != 0: return None, next((l for l in r.stderr.splitlines() if 'ERROR' in l), 'sql_error')[:200]
    return [json.loads(l) for l in r.stdout.splitlines() if l.strip()[:1] in '{['], None
