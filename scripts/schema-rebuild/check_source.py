#!/usr/bin/env python3
"""Fail closed on baseline provenance drift and recognizable secret literals."""
import hashlib,json,re
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]/'supabase/bootstrap'
def main():
 manifest=json.loads((BASE/'pokeriq-baseline.json').read_text());
 inventory=json.loads((BASE/'source-history.json').read_text())['repositories']
 if any(inventory[repo]['revision']!=manifest['sourceRevision'+repo.capitalize()] for repo in ('arena','hub')):
  raise ValueError('Baseline and inventory source cutoffs differ')
 if manifest.get('auditedSourceRevision')!='60c5d39b7d8b282460a359f20754cf8345a663c5' or manifest.get('sourceRevisionArena')!=manifest['auditedSourceRevision'] or manifest.get('laterMigrationsExcluded') is not True:raise ValueError('Fixed audit cutoff differs')
 source=(BASE/manifest['schemaFile']).read_bytes()
 if len(source)!=manifest['bytes'] or hashlib.sha256(source).hexdigest()!=manifest['schemaSHA256']:raise ValueError('Native baseline bytes differ from provenance')
 for name,expected in [('pokeriq-catalog-reference.json',manifest['catalogSHA256']),('source-history.json',manifest['sourceHistorySHA256']),('pokeriq-platform-contract.json',manifest['platformContractSHA256']),('pokeriq-extension-runtime.json',manifest['extensionRuntimeSHA256']),('pokeriq-role-contract.json',manifest['roleContractSHA256']),('historical-ledger-reconciliation.json',manifest['historicalLedgerReconciliationSHA256']),('forward-schema.json',manifest['forwardSchemaSHA256'])]:
  if hashlib.sha256((BASE/name).read_bytes()).hexdigest()!=expected:raise ValueError('Baseline evidence checksum differs: '+name)
 semantic=hashlib.sha256(json.dumps(json.loads((BASE/'pokeriq-catalog-reference.json').read_text()),sort_keys=True,separators=(',',':')).encode()).hexdigest()
 if semantic!=manifest['catalogSemanticSHA256']:raise ValueError('Published catalog differs semantically from independently captured source')
 if hashlib.sha256((BASE.parents[1]/'scripts/schema-rebuild/catalog.sql').read_bytes()).hexdigest()!=manifest['catalogQuerySHA256']:raise ValueError('Catalog comparison query differs from captured source contract')
 if json.loads((BASE/'forward-schema.json').read_text()) != {'arena': [], 'hub': []}:raise ValueError('This observed baseline cannot apply forward migrations')
 if not manifest['allSchemas'] or manifest['dataIncluded'] or manifest.get('sameExportedSnapshot') is not True:raise ValueError('Complete schema-only export required')
 patterns={
 'jwt':rb'(?<![A-Za-z0-9_])eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}',
 'private_key':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
 'password_url':rb'(?i)postgres(?:ql)?://[^\s:/]+:[^\s@]+@',
 'provider_token':rb'(?<![A-Za-z0-9_])(?:sbp_|sb_secret_|sk_live_|sk_test_|ghp_|github_pat_)[A-Za-z0-9_]{20,}',
 'assigned_secret':rb'''(?i)(?:api_key|access_token|service_role_key|client_secret)\s*[:=]\s*['"][A-Za-z0-9_/-]{24,}''',
 'psql_shell':rb'(?m)^\\!',
 'data_copy':rb'(?m)^COPY [^\n]+ FROM stdin;'}
 inputs=[source,*[(BASE/name).read_bytes() for name in (
  'pokeriq-catalog-reference.json','pokeriq-role-contract.json',
  'pokeriq-platform-contract.json','pokeriq-extension-runtime.json')]]
 findings={name:sum(len(re.findall(pattern,artifact)) for artifact in inputs)
           for name,pattern in patterns.items()}
 if any(findings.values()):raise ValueError('Baseline literal review required: '+json.dumps(findings))
 catalog=json.loads((BASE/'pokeriq-catalog-reference.json').read_text());captured_extensions=[{k:v for k,v in e.items() if k!='owner_dependencies'} for e in catalog['extensions']]
 if captured_extensions!=manifest['extensions']:raise ValueError('Extension manifest differs from independent catalog')
 contract=json.loads((BASE/'pokeriq-role-contract.json').read_text());allowed={'default_transaction_read_only','idle_in_transaction_session_timeout','lock_timeout','log_statement','pgrst.db_pre_request','plpgsql_check.constants_tracing','plpgsql_check.cursors_leaks','plpgsql_check.mode','search_path','session_preload_libraries','statement_timeout','synchronous_commit'}
 if contract['extensions']!=captured_extensions:raise ValueError('Role contract extensions differ from independent catalog')
 for role in contract['roles']:
  if any(x.split('=',1)[0] not in allowed for x in role.get('config') or []):raise ValueError('Unreviewed role configuration key')
 print(json.dumps({'nativeSHA256Verified':True,'recognizedSecretLiterals':findings,'roleSettingKeysReviewed':True,'limitation':'Pattern scanning complements source review; it is not a universal secret detector.'}))
if __name__=='__main__':main()
