import os,subprocess,sys
from pathlib import Path
from urllib.parse import urlparse,unquote
u=urlparse(Path('supabase/.temp/pooler-url').read_text().strip())
if not u.hostname or not u.hostname.endswith('.pooler.supabase.com') or 'kuklfnapbkmacvwxktbh' not in (u.username or ''):
 raise SystemExit('Configured pooler metadata does not match the assigned project')
if not os.environ.get('SUPABASE_DB_PASSWORD'):
 raise SystemExit('Configured SUPABASE_DB_PASSWORD is unavailable')
env={**os.environ,'PGHOST':u.hostname,'PGPORT':str(u.port or 5432),'PGUSER':unquote(u.username or ''),'PGDATABASE':u.path.lstrip('/') or 'postgres','PGPASSWORD':os.environ['SUPABASE_DB_PASSWORD'],'PGSSLMODE':'verify-full','PGSSLROOTCERT':str(Path('scripts/ci/certificates/supabase-prod-ca-2021.crt').resolve()),'PGCONNECT_TIMEOUT':'10','TMPDIR':str(Path('work').resolve())}
r=subprocess.run(['/opt/homebrew/bin/node',*sys.argv[2:]] if len(sys.argv)>1 and sys.argv[1]=='--node' else ['/opt/homebrew/bin/psql','-X','-v','ON_ERROR_STOP=1',*sys.argv[1:]],env=env)
raise SystemExit(r.returncode)
