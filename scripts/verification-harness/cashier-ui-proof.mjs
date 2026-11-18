import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[1-9][0-9]*$/;
const UI_FIX = '23a8c4dc1b9e78b319b4693c3e414c95f993572b';
const CASE_FIX = '3d17703d0ab1bbb58815034c8510d0845ca8bcfd';
const ORIGINS = ['https://ca-static.smarter.poker', 'https://smarter.poker/hub/club-arena'];
export const COMPONENT_PATHS = [
  'src/pages/CashierTradePage.tsx',
  'src/pages/CashierPage.tsx',
  'src/components/agent/AgentPromoPanel.tsx',
  'src/components/wallet/WalletCashierModal.tsx',
  'src/pages/CashierTradePage.module.css',
  'src/pages/MemberManagementPage.tsx',
  'src/components/club/MemberCreditWalletRows.tsx',
];
export const CASES = [
  'reads Transaction History through the installed feed and scopes, with real receipts',
  'prints the existing agent credit agreement beneath member wallets without moving chips',
  'offers reclaim return wallets and keeps promo in promo without moving chips',
];
export const ECO_CASE = 'reads separate recorded cash and tournament ECO without changing settings or money';
export const ECO_COMPONENT_PATHS = ['src/pages/UnionDetailPage.tsx', 'src/pages/UnionDetailPage.module.css',
  'src/pages/UnionStatementsPage.tsx', 'src/pages/club/ClubDataPage.tsx',
  'src/services/UnionService.ts', 'src/utils/unionEco.ts', 'src/utils/unionStatementBoard.ts'];
const ecoRequest = event => event?.client_payload?.eco_components === true;

export function admitDispatch(environment, event) {
  if (
    environment.GITHUB_EVENT_NAME !== 'repository_dispatch' ||
    environment.GITHUB_REF !== 'refs/heads/main' ||
    environment.GITHUB_REPOSITORY_ID !== '1132369872' ||
    !SHA.test(environment.GITHUB_SHA || '') ||
    !ID.test(environment.PROOF_RUN_ID || '') ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(environment.GITHUB_REPOSITORY || '') ||
    event?.action !== 'verify-cashier-ui' ||
    !event.client_payload ||
    Array.isArray(event.client_payload) ||
    typeof event.client_payload !== 'object' ||
    !(Object.keys(event.client_payload).length === 0 ||
      (Object.keys(event.client_payload).length === 1 && ecoRequest(event)))
  ) {
    throw new Error('Cashier UI proof requires a closed default-branch repository dispatch.');
  }
}

export function assertCases(report, eco = false) {
  const selectedCases = eco ? [ECO_CASE] : CASES;
  if (!report || report.errors?.length || report.notRunReason || !Array.isArray(report.suites))
    throw new Error('Cashier browser report is missing or contains errors.');
  const actual = [];
  const visit = (suite) => {
    for (const spec of suite.specs || []) {
      const file = String(spec.file || suite.file || '').replaceAll('\\', '/');
      for (const test of spec.tests || []) {
        if (
          !file.endsWith(eco ? 'production-union-eco.spec.ts' : 'production-cashier.spec.ts') ||
          !selectedCases.includes(spec.title) ||
          spec.ok !== true ||
          test.projectName !== 'chromium' ||
          test.status !== 'expected' ||
          test.expectedStatus !== 'passed' ||
          test.results?.length !== 1 ||
          test.results[0].status !== 'passed' ||
          test.results[0].retry !== 0 ||
          test.annotations?.some((a) => a.type === 'skip' || a.type === 'fixme')
        )
          throw new Error('Each selected Cashier case must pass once without skips or retries.');
        actual.push(spec.title);
      }
    }
    for (const child of suite.suites || []) visit(child);
  };
  report.suites.forEach(visit);
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...selectedCases].sort()))
    throw new Error('Exactly the selected cashier cases must execute.');
  return actual;
}

export function assertPins(before, after, cleanup, eco = false) {
  const paths = eco ? ECO_COMPONENT_PATHS : COMPONENT_PATHS;
  for (const pin of [before, after]) {
    if (
      pin?.schema !== 1 ||
      !SHA.test(pin.clientSha || '') ||
      !SHA.test(pin.verificationSha || '') ||
      !ID.test(pin.runId || '') ||
      !ID.test(pin.publisherRunId || '') ||
      pin.publisherVerified !== true ||
      !Array.isArray(pin.endpoints) ||
      pin.endpoints.length !== 2 ||
      pin.endpoints.some(
        (e, i) =>
          e.origin !== ORIGINS[i] ||
          e.clientSha !== pin.clientSha ||
          e.publisherRunId !== pin.publisherRunId
      ) ||
      Object.keys(pin.components || {})
        .sort()
          .join('|') !== [...paths].sort().join('|') ||
      (eco && pin.profile !== 'union-eco') ||
      Object.values(pin.components).some((value) => !SHA.test(value))
    )
      throw new Error('Cashier provenance is incomplete.');
  }
  if (before.clientSha !== after.clientSha || before.publisherRunId !== after.publisherRunId)
    throw new Error('The serving client changed during the cases; no scoped verdict.');
  if (
    before.verificationSha !== after.verificationSha ||
    before.runId !== after.runId ||
    JSON.stringify(before.components) !== JSON.stringify(after.components)
  )
    throw new Error('Verification source or component provenance changed.');
  if (!eco && (cleanup?.verified !== true || cleanup.runId !== before.runId))
    throw new Error('The owned isolated account cleanup was not verified.');
  if (eco && cleanup !== null) throw new Error('Existing-identity proof must not claim owned-account cleanup.');
}

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).trim();
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export async function readEcoIdentity({ environment = process.env, fetchImpl = fetch } = {}) {
  const origin = 'https://kuklfnapbkmacvwxktbh.supabase.co';
  if (environment.SUPABASE_URL !== origin || !environment.VITE_SUPABASE_ANON_KEY ||
    !environment.SP_EMAIL || !environment.SP_PASS) throw new Error('Configured ECO verification identity is unavailable.');
  // The approved service identity is an explicit policy boundary. A secret
  // name or an owner's permissions never authorize a personal account login.
  if (environment.SP_EMAIL.trim().toLowerCase() !== 'daniel@smarter.poker')
    throw new Error('Configured identity is not the canonical authorized service account.');
  const login = await fetchImpl(`${origin}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: environment.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: environment.SP_EMAIL, password: environment.SP_PASS }), signal: AbortSignal.timeout(15000),
  });
  if (!login.ok) throw new Error('Configured ECO verification identity authentication failed.');
  const session = await login.json();
  if (!session.access_token || !session.user?.id || session.user.email?.toLowerCase() !== 'daniel@smarter.poker') throw new Error('Configured ECO verification session is incomplete.');
  const profileResponse = await fetchImpl(`${origin}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=role`, {
    headers: { apikey: environment.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.timeout(15000),
  });
  if (!profileResponse.ok) throw new Error('Canonical service authority could not be established.');
  const profiles = await profileResponse.json();
  if (!Array.isArray(profiles) || profiles.length !== 1 || String(profiles[0].role).toLowerCase() !== 'god')
    throw new Error('Canonical service identity lacks its required God role.');
  const access = await fetchImpl(`${origin}/rest/v1/rpc/ca_can_oversee_union`, {
    method: 'POST', headers: { apikey: environment.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_union_id: 'fade0000-0000-0000-0000-000000000001' }), signal: AbortSignal.timeout(15000),
  });
  if (!access.ok || await access.json() !== true) throw new Error('Canonical service identity is unauthorized to read the union board.');
  const response = await fetchImpl(`${origin}/rest/v1/unions?id=eq.fade0000-0000-0000-0000-000000000001&select=id,owner_id,settings`, {
    headers: { apikey: environment.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.timeout(15000),
  });
  const rows = response.ok ? await response.json() : [];
  const union = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  const configuredTermsConfirmed = union?.settings?.eco_cash_enabled === true && union?.settings?.eco_tournament_enabled === true &&
    union?.settings?.eco_cash_rate === .1 && union?.settings?.eco_tournament_rate === .1;
  // Owner controls and overseer reads are different permissions. Never promote
  // this account or invent owner proof merely because its board read is allowed.
  return { session, ownerSettingsAuthorized: union?.owner_id === session.user.id, configuredTermsConfirmed };

}
export function ecoProofScope(preflight) {
  if (preflight.authorized !== true || typeof preflight.ownerControls !== 'boolean' || typeof preflight.configuredTermsConfirmed !== 'boolean') throw new Error('ECO identity preflight did not pass.');
  const ownerSettingsVerified = preflight.ownerControls && preflight.configuredTermsConfirmed;
  return { verdict: ownerSettingsVerified ? 'passed' : 'partial', boardVerified: true, ownerSettingsVerified };
}
async function jsonResponse(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Provenance read failed (${response.status}).`);
  const body = await response.text();
  if (body.length > 2 * 1024 * 1024) throw new Error('Provenance response exceeded its bound.');
  return JSON.parse(body);
}

export async function pin(file, environment = process.env) {
  if (
    ![
      'before.json',
      'after.json',
      'e2e-report/cashier-ui-proof/before.json',
      'e2e-report/cashier-ui-proof/after.json',
    ].includes(file)
  )
    throw new Error('Unknown proof phase.');
  admitDispatch(environment, readJson(environment.GITHUB_EVENT_PATH));
  const eco = ecoRequest(readJson(environment.GITHUB_EVENT_PATH));
  const source = git('rev-parse', 'HEAD');
  if (source !== environment.GITHUB_SHA)
    throw new Error('Verification checkout differs from its admitted source.');
  git('fetch', '--no-tags', '--filter=blob:none', 'origin', 'main');
  git('merge-base', '--is-ancestor', source, 'origin/main');
  git('merge-base', '--is-ancestor', CASE_FIX, source);
  const endpoints = [];
  for (const origin of ORIGINS) {
    const info = await jsonResponse(
      `${origin}/build-info.json?cashier-proof=${environment.PROOF_RUN_ID}-${file}`
    );
    if (
      !SHA.test(info.ca_sha || '') ||
      !ID.test(String(info.run_id || '')) ||
      info.built_by !== 'publish-club-arena.yml'
    )
      throw new Error('Invalid published client identity.');
    endpoints.push({ origin, clientSha: info.ca_sha, publisherRunId: String(info.run_id) });
  }
  const { clientSha, publisherRunId } = endpoints[0];
  if (endpoints.some((e) => e.clientSha !== clientSha || e.publisherRunId !== publisherRunId))
    throw new Error('The two public client endpoints disagree.');
  git('cat-file', '-e', `${clientSha}^{commit}`);
  git('merge-base', '--is-ancestor', UI_FIX, clientSha);
  git('merge-base', '--is-ancestor', clientSha, 'origin/main');
  const components = {};
  for (const path of eco ? ECO_COMPONENT_PATHS : COMPONENT_PATHS) {
    const live = git('rev-parse', `${clientSha}:${path}`);
    if (live !== git('rev-parse', `${source}:${path}`))
      throw new Error(`The served Cashier component differs from the verifier source: ${path}`);
    components[path] = live;
  }
  if (!environment.GITHUB_TOKEN)
    throw new Error('Read-only publisher provenance access is unavailable.');
  const api = `https://api.github.com/repos/${environment.GITHUB_REPOSITORY}/actions/runs/${publisherRunId}`;
  const headers = {
    Authorization: `Bearer ${environment.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
  };
  const run = await jsonResponse(api, headers);
  if (
    String(run.repository?.id) !== environment.GITHUB_REPOSITORY_ID ||
    run.path !== '.github/workflows/publish-club-arena.yml' ||
    run.head_branch !== 'main' ||
    !['push', 'repository_dispatch'].includes(run.event) ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    throw new Error('The live client lacks a successful protected publisher.');
  const jobs = [];
  let expected;
  for (let page = 1; page <= 10; page++) {
    const value = await jsonResponse(`${api}/jobs?per_page=100&page=${page}`, headers);
    if (!Array.isArray(value.jobs) || !Number.isSafeInteger(value.total_count))
      throw new Error('Publisher job metadata is incomplete.');
    expected ??= value.total_count;
    if (expected !== value.total_count) throw new Error('Publisher job metadata changed.');
    jobs.push(...value.jobs);
    if (jobs.length >= expected) break;
  }
  if (
    jobs.length !== expected ||
    !jobs.some(
      (j) =>
        (j.name === 'publish-to-origin' || j.name.endsWith(' / publish-to-origin')) &&
        j.conclusion === 'success'
    )
  )
    throw new Error('The actual client origin installation did not pass.');
  const result = {
    ...(eco ? { profile: 'union-eco' } : {}),
    schema: 1,
    runId: environment.PROOF_RUN_ID,
    verificationSha: source,
    clientSha,
    publisherRunId,
    publisherVerified: true,
    endpoints,
    components,
    observedAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  console.log(
    `Pinned Cashier UI ${clientSha}; publisher ${publisherRunId}; verification ${source}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'admit' && process.argv.length === 3) {
    admitDispatch(process.env, readJson(process.env.GITHUB_EVENT_PATH));
    if (git('rev-parse', 'HEAD') !== process.env.GITHUB_SHA)
      throw new Error('Wrong verifier checkout.');
    git('merge-base', '--is-ancestor', CASE_FIX, process.env.GITHUB_SHA);
  } else if (process.argv[2] === 'eco-preflight' && process.argv.length === 3) {
    admitDispatch(process.env, readJson(process.env.GITHUB_EVENT_PATH));
    if (!ecoRequest(readJson(process.env.GITHUB_EVENT_PATH))) throw new Error('Wrong ECO request.');
    const identity = await readEcoIdentity();
    writeFileSync('e2e-report/cashier-ui-proof/eco-preflight.json', JSON.stringify({ authorized: true, ownerControls: identity.ownerSettingsAuthorized, configuredTermsConfirmed: identity.configuredTermsConfirmed }));
    console.log('Canonical service identity has actual union-board read permission; owner settings authority is reported separately.');
  } else if (process.argv[2] === 'assert-eco' && process.argv.length === 7) {
    const [before, after, report, preflight] = process.argv.slice(3).map(readJson);
    assertPins(before, after, null, true);
    const scope = ecoProofScope(preflight);
    const cases = assertCases(report, true);
    writeFileSync('cashier-ui-proof.json', JSON.stringify({ schema: 1, ...scope, scope: cases, readonly: true,
      clientSha: before.clientSha, publisherRunId: before.publisherRunId, verificationSha: before.verificationSha, runId: before.runId }));
    console.log('The recorded ECO board case passed on the pinned live client. Owner settings proof is a separate permission-bound result.');
    if (!scope.ownerSettingsVerified) process.exitCode = 2;
  } else if (process.argv[2] === 'pin' && process.argv.length === 4) await pin(process.argv[3]);
  else if (process.argv[2] === 'assert' && process.argv.length === 7) {
    const [before, after, report, cleanup] = process.argv.slice(3).map(readJson);
    assertPins(before, after, cleanup);
    const cases = assertCases(report);
    writeFileSync(
      'cashier-ui-proof.json',
      JSON.stringify(
        {
          schema: 1,
          verdict: 'passed',
          scope: cases,
          clientSha: before.clientSha,
          publisherRunId: before.publisherRunId,
          verificationSha: before.verificationSha,
          runId: before.runId,
          cleanupVerified: true,
        },
        null,
        2
      ) + '\n'
    );
    console.log(
      'All scoped Cashier cases passed once on the pinned live client; owned account cleanup verified.'
    );
  } else
    throw new Error(
      'Usage: cashier-ui-proof.mjs pin before.json|after.json | assert BEFORE AFTER REPORT CLEANUP'
    );
}
