/**
 * AN ENGINE RELEASE RE-ASKS THE MONITORING QUESTION (2026-11-10)
 *
 * Production Alerts incident: MonitoringDeployFailed episode a09be630
 * (operational_alert_events 353025, 353026, 353157, 370466, 373822).
 *
 * `check-alert-rules-match.mjs` refuses a rule whose metric is emitted only by
 * an engine newer than the one running ("RULES AHEAD OF THE ENGINE THAT IS
 * RUNNING"). Engines release once a day, so every merge that adds a metric and
 * its rule together reaches that refusal on its monitoring deploy. That part is
 * correct. The defect was that nothing asked again when the engine caught up:
 * engine bff6eed3 released at 19:41Z on 11-09, and the episode stayed firing
 * until 04:54Z on 11-10, when an unrelated push happened to touch
 * infra/monitoring. Closing an episode depended on chance.
 *
 * These pins keep the re-ask wired to the event that ends the condition:
 *   - deploy-monitoring.yml listens for the engine publisher by its `name:`;
 *   - only a successful Engine Release or Engine Withdrawal on main re-runs it;
 *   - the verdict job carries the same condition, so a skipped re-run (a
 *     failed release, a horse observation run) records no false verdict;
 *   - the refusal text no longer sends a reader to the retired :55 break.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(__dirname, '..');
const WF_TEXT = readFileSync(join(ROOT, '.github/workflows/deploy-monitoring.yml'), 'utf8');
const WF = parse(WF_TEXT) as any;
const ENGINE = parse(
  readFileSync(join(ROOT, '.github/workflows/auto-deploy-hetzner.yml'), 'utf8')
) as any;
const ENGINE_TEXT = readFileSync(join(ROOT, '.github/workflows/auto-deploy-hetzner.yml'), 'utf8');
const CHECKER = readFileSync(join(ROOT, 'scripts/ci/check-alert-rules-match.mjs'), 'utf8');

const RERUN =
  "github.event_name != 'workflow_run' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main' && (startsWith(github.event.workflow_run.display_title, 'Engine Release ') || startsWith(github.event.workflow_run.display_title, 'Engine Withdrawal ')))";

describe('an engine release re-asks the monitoring question', () => {
  it('listens for the engine publisher by its name, on completion', () => {
    const wr = WF.on?.workflow_run;
    expect(wr, 'deploy-monitoring.yml has no workflow_run trigger').toBeTruthy();
    expect(wr.types).toEqual(['completed']);
    expect(wr.workflows).toEqual([ENGINE.name]);
  });

  it('keeps the push and recovery triggers it already had', () => {
    expect(WF.on.push.branches).toEqual(['main']);
    expect(WF.on.repository_dispatch.types).toEqual(['deploy-club-arena-monitoring']);
  });

  it('re-runs only for a successful release or withdrawal on main', () => {
    // The display titles it matches are the engine publisher's run-name.
    expect(ENGINE_TEXT).toContain("format('Engine Release {0}'");
    expect(ENGINE_TEXT).toContain("format('Engine Withdrawal {0}'");
    expect(ENGINE_TEXT).toContain("format('Private Horse Fleet Observation {0}'");
    expect(WF.jobs.deploy.if).toBe('${{ (' + RERUN + ') }}');
  });

  it('records a verdict only when the deploy job was owed', () => {
    const verdict = WF.jobs['monitoring-deploy-verdict'];
    expect(verdict.needs).toBe('deploy');
    expect(verdict.if).toBe('${{ always() && (' + RERUN + ') }}');
  });

  it('a re-run converges on current main exactly as a push run does', () => {
    const resolve = WF.jobs.deploy.steps.find(
      (s: any) => s.name === 'Resolve current protected main'
    );
    expect(resolve.run).toContain('[ "$GITHUB_EVENT_NAME" = repository_dispatch ]');
    expect(resolve.run).not.toContain('workflow_run');
  });

  it('the refusal no longer sends anyone to the retired :55 break', () => {
    expect(CHECKER).not.toContain('at the :55 break');
    expect(CHECKER).toContain('04:00 America/Chicago');
    expect(CHECKER).toContain('deploy-monitoring.yml');
    expect(CHECKER).toContain('runs again by itself');
  });
});
