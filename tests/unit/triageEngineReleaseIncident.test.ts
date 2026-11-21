import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  classifyEngineReleaseTriage,
  validateIncidentClaimInputs,
  validateIncidentInspectInputs,
} from '../../scripts/ci/triage-engine-release-incident.mjs';

const ROOT = process.cwd();
const WF_TEXT = readFileSync(
  join(ROOT, '.github/workflows/triage-engine-release-incident.yml'),
  'utf8'
);
const WF = parse(WF_TEXT);

const SHA_A = 'e2140d2d1581daaf84857d98e671f2be832162c6';
const SHA_B = 'bb21dc82673117a937f67c9498dec46b8c27522e';
const HEALTHY_A = {
  status: 'ok',
  liveness: 'ok',
  settlementStatus: 'ok',
  wholeFleetStalled: false,
  releaseSha: SHA_A,
};
const HEALTHY_B = { ...HEALTHY_A, releaseSha: SHA_B };

describe('triage-engine-release-incident — read-only triage and sanctioned claim', () => {
  it('classifies already-live exact SHA, superseded newer SHA, not-serving, unhealthy, and unknown', () => {
    expect(classifyEngineReleaseTriage({ targetSha: SHA_A, liveHealth: HEALTHY_A })).toMatchObject({
      verdict: 'already_live_exact',
      actionableFailure: false,
      servingSha: SHA_A,
    });

    expect(
      classifyEngineReleaseTriage({
        targetSha: SHA_A,
        liveHealth: HEALTHY_B,
        isAncestor: (a, b) => a === SHA_A && b === SHA_B,
      })
    ).toMatchObject({
      verdict: 'already_superseded',
      actionableFailure: false,
      servingSha: SHA_B,
    });

    expect(
      classifyEngineReleaseTriage({
        targetSha: SHA_A,
        liveHealth: HEALTHY_B,
        isAncestor: () => false,
      })
    ).toMatchObject({
      verdict: 'target_not_serving',
      actionableFailure: true,
      servingSha: SHA_B,
    });

    expect(
      classifyEngineReleaseTriage({
        targetSha: SHA_A,
        liveHealth: { ...HEALTHY_A, liveness: 'degraded' },
      })
    ).toMatchObject({
      verdict: 'engine_unhealthy',
      actionableFailure: true,
    });

    expect(
      classifyEngineReleaseTriage({ targetSha: 'not-a-sha', liveHealth: HEALTHY_A })
    ).toMatchObject({
      verdict: 'unknown',
      actionableFailure: true,
    });
  });

  it('validates claim inputs strictly and rejects invalid UUIDs, empty sessions, or out-of-range TTLs', () => {
    const ok = validateIncidentClaimInputs({
      incidentId: '484c4cee-5b54-4bbd-bbf1-3b6ebdcc2c4c',
      agentSession: 'antigravity-session-1',
      branch: 'agent/fix',
      pullRequest: '#11579',
      ttlHours: '6',
    });
    expect(ok).toEqual({
      incidentId: '484c4cee-5b54-4bbd-bbf1-3b6ebdcc2c4c',
      agentSession: 'antigravity-session-1',
      branch: 'agent/fix',
      pullRequest: '#11579',
      ttlHours: 6,
    });

    expect(() => validateIncidentClaimInputs({ incidentId: 'bad-id', agentSession: 's1' })).toThrow(
      /UUID/
    );
    expect(() =>
      validateIncidentClaimInputs({
        incidentId: '484c4cee-5b54-4bbd-bbf1-3b6ebdcc2c4c',
        agentSession: '   ',
      })
    ).toThrow(/agent_session/);
    expect(() =>
      validateIncidentClaimInputs({
        incidentId: '484c4cee-5b54-4bbd-bbf1-3b6ebdcc2c4c',
        agentSession: 's1',
        ttlHours: '25',
      })
    ).toThrow(/ttl_hours/);
  });

  it('validates inspect inputs strictly by UUID', () => {
    expect(
      validateIncidentInspectInputs({ incidentId: '484c4cee-5b54-4bbd-bbf1-3b6ebdcc2c4c' })
    ).toEqual({ incidentId: '484c4cee-5b54-4bbd-bbf1-3b6ebdcc2c4c' });
    expect(() => validateIncidentInspectInputs({ incidentId: 'not-a-uuid' })).toThrow(/UUID/);
  });

  it('keeps the workflow strictly manual-only, least-privilege, bot-guarded, fast-checkout, and free of SSH/release mutation', () => {
    expect(Object.keys(WF.on)).toEqual(['workflow_dispatch']);
    expect(WF.on.workflow_dispatch.inputs.operation.options).toEqual([
      'triage',
      'inspect',
      'claim',
      'resolve',
    ]);
    expect(WF.permissions).toEqual({});
    expect(WF.jobs.execute.permissions).toEqual({ contents: 'read' });
    expect(WF.jobs.execute.if).toContain("github.actor != 'github-actions[bot]'");
    expect(WF.jobs.execute.if).toContain("github.triggering_actor != 'github-actions[bot]'");
    expect(WF.jobs.execute.if).toContain(
      "!(github.run_attempt != '1' && github.triggering_actor == 'github-actions[bot]')"
    );
    const checkout = WF.jobs.execute.steps.find(
      (s: { uses?: string }) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@')
    );
    expect(checkout?.uses).toBe('actions/checkout@v7.0.1');
    expect(checkout?.with?.['fetch-depth']).toBe(1);
    expect(checkout?.with?.['fetch-tags']).toBe(false);
    const setupNode = WF.jobs.execute.steps.find(
      (s: { uses?: string }) =>
        typeof s.uses === 'string' && s.uses.startsWith('actions/setup-node@')
    );
    expect(setupNode?.uses).toBe('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
    expect(WF_TEXT).not.toContain('@v4');
    expect(WF_TEXT).not.toContain('HETZNER_SSH_PRIVATE_KEY');
    expect(WF_TEXT).not.toContain('repository_dispatch');
    expect(WF_TEXT).not.toContain('schedule:');

    // Strict least-privilege secret scoping & read-only inspect SQL boundary
    const runStep = WF.jobs.execute.steps.find(
      (s: { name?: string }) => s.name === 'Run bounded incident operation'
    );
    expect(runStep?.env?.DATABASE_URL).toBe(
      "${{ (inputs.operation == 'claim' || inputs.operation == 'inspect' || inputs.operation == 'resolve') && secrets.DATABASE_URL || '' }}"
    );
    expect(runStep?.env?.DATABASE_URL).not.toContain("'triage'");
    const scriptText = readFileSync(
      join(ROOT, 'scripts/ci/triage-engine-release-incident.mjs'),
      'utf8'
    );
    const inspectStart = scriptText.indexOf('async function runInspect()');
    const claimStart = scriptText.indexOf('async function runClaim()');
    expect(inspectStart).toBeGreaterThan(0);
    expect(claimStart).toBeGreaterThan(inspectStart);
    const inspectBody = scriptText.slice(inspectStart, claimStart);
    expect(inspectBody).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE)\b/i
    );
    const claimBody = scriptText.slice(claimStart);
    expect(claimBody).toContain('SELECT smarter_private.fn_claim_reliability_incident(');
    expect(claimBody).toContain('$1::uuid');
    expect(claimBody).toContain('$5::text');
  });
});
