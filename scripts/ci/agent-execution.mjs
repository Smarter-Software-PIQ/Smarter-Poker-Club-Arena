// Club Arena adapter. Shared primitives are owned by protected commander-shared.
import { execFileSync } from 'node:child_process';
import { classifyDelivery } from '../../docs/agent-policy/agent-policy.mjs';
export { inputFingerprint, reusableEvidence, readProviderEvidence, operationTransition, updateOperation, failureDisposition, summarizeMetrics } from './vendor/agentExecution.mjs';
const git = (root, ...args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024,
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

export function executionPlan({ root, classification, baseline = null, simulationsUnchanged = false }) {
  const { complete, paths = [], flags } = classification;
  const checks = [
    ['typecheck', true, 'Always-on repository invariants'],
    ['isolated-simulations', !simulationsUnchanged, simulationsUnchanged ? 'Exact immutable proof: simulation producers, fixtures and inputs unchanged' : 'No complete unchanged-input proof; preserve simulation checks'],
    ['client-unit', flags.tests || flags.src, 'Existing client/source-contract admission'],
    ['engine-unit', flags.server, 'Legacy server admission; independent selector pending shadow qualification'],
    ['accounting-postgres', flags.server, 'Legacy accounting admission preserved until dependency coverage is proved'],
    ['production-build', flags.src, 'Client build inputs'],
    ['browser', flags.src, 'Existing browser dependency admission'],
    ['solver', flags.phase4, 'Certified solver dependencies'],
    ['component-native', flags.fixture, 'Native fixture dependencies'],
  ].map(([id, selected, reason]) => ({ id, selected: Boolean(selected), reason,
    durationSeconds: baseline?.checks?.[id]?.durationSeconds ?? null,
    owner: '.github/workflows/ci.yml', reuse: 'requires successful exact-input evidence and owning gate support' }));
  const delivery = paths.length ? classifyDelivery(paths) : { components: ['unclassified'], engineActivationRequired: null };
  const components = delivery.components;
  const changedDelivery = paths.filter(p => /^(\.github|\.husky|scripts\/ci|package(?:-lock)?\.json)/.test(p));
  return { version: 1, mode: 'shadow', classificationSource: classification.source || 'immutable-git-diff', complete, head: classification.head ?? null,
    base: classification.base ?? null, components, paths, checks,
    engineActivationRequired: !complete || components.includes('unclassified') ? null : delivery.engineActivationRequired,
    publicationRequired: components.filter(c => c !== 'documentation'),
    scopeReview: changedDelivery.length ? { reason: 'Shared delivery/dependency inputs changed', paths: changedDelivery } : null,
    readiness: { trackedClean: git(root, 'status', '--porcelain', '--untracked-files=no') === '',
      access: 'unknown_until_authenticated_provider_readback', fixtureCoverage: 'existing_gates_retained' },
    estimates: { basis: baseline ? 'observed baseline' : 'unknown; no invented timing or token prices' },
    limitation: 'Preview only; never substitutes for required checks, installation or live proof' };
}

