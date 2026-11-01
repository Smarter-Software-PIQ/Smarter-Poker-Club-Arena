"""Install captured closure dependencies and the exact maintained boundary migration."""
import hashlib,json
from pathlib import Path
from tournament_abort_native import sql_file

def install_closure_boundary(e,db,root):
 migration=root/'supabase/migrations/20261101005048_operator_closure_records_a_stopped_unsettled_hand_dispositio.sql'
 data=root/'scripts/ci/fixtures/tournament-abort'
 relations=json.loads((data/'closure-boundary-relations.json').read_text())
 source='SET check_function_bodies=off;'
 for r in relations:
  columns=[]
  for c in r['columns']:
   default=' DEFAULT '+c['default'] if c['default'] and 'nextval(' not in c['default'] else ''
   columns.append('"'+c['name']+'" '+c['type']+default+(' NOT NULL' if c['notnull'] else ''))
  source+='CREATE TABLE IF NOT EXISTS '+r['relation']+'('+','.join(columns+[x['definition'] for x in r['constraints'] or []])+');'
 # The shared foundation predates operator-aborted states. Install the
 # captured current CHECK constraints, never weaken the installed guards.
 for r in json.loads((data/'current-relations.json').read_text()):
  if r['relation']=='smarter_private.f06_operations':
   for c in r['constraints']:
    if c['definition'].startswith('CHECK'):
     source+='ALTER TABLE '+r['relation']+' DROP CONSTRAINT IF EXISTS '+c['name']+';ALTER TABLE '+r['relation']+' ADD CONSTRAINT '+c['name']+' '+c['definition']+';'
 functions=json.loads((data/'closure-boundary-functions.json').read_text())
 for f in functions:
  assert hashlib.md5(f['definition'].encode()).hexdigest()==f['definition_md5']
  source+=f['definition']+';'
 source+="ALTER TABLE smarter_private.f06_hand_permits DROP CONSTRAINT f06_hand_permits_state_check;ALTER TABLE smarter_private.f06_hand_permits ADD CONSTRAINT f06_hand_permits_state_check CHECK(state IN('reserved','accepted','never_started','aborted_unsettled'));"
 source+='DROP TRIGGER IF EXISTS closure_native_retained_guard ON smarter_private.f06_hand_permits;CREATE TRIGGER closure_native_retained_guard AFTER UPDATE OF state ON smarter_private.f06_hand_permits FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_retained_submission_guard();'
 sql_file(e,db,'actual-connected-closure-preimages',source)
 e.sql(db,file=migration,label='exact-closure-boundary-migration',seconds=120)
 for path in [Path(__file__),migration,data/'closure-boundary-functions.json',data/'closure-boundary-relations.json']:
  e.report['source_sha256'][str(path.relative_to(root))]=hashlib.sha256(path.read_bytes()).hexdigest()
