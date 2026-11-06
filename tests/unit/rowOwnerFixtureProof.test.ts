import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('delivers real rows from an isolated target and retires it on every outcome', () => {
  const browser = readFileSync('tests/e2e/production-row-channel-owners.spec.ts', 'utf8');
  const workflow = readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8');
  expect(browser).toContain('expect(target.id).not.toBe(ownerId)');
  expect(browser).toContain('body?.p_target_user_id === target.id');
  expect(browser).toContain("await nickname.press('Tab')");
  expect(browser).toContain('await saveNickname(originalNickname)');
  expect(browser).toContain('owner.updates > 0');
  expect(browser).toContain('.toBeGreaterThan(afterUnmount)');
  expect(browser).not.toContain('naturalTrafficOnly: true');
  const create = workflow.indexOf('name: Prepare the isolated row-delivery target');
  const suite = workflow.indexOf('name: Run the specs that need a deployed page');
  const cleanup = workflow.indexOf('name: Retire the isolated row-delivery target');
  expect(create).toBeGreaterThan(0);
  expect(create).toBeLessThan(suite);
  expect(cleanup).toBeGreaterThan(suite);
  expect(workflow.slice(create, suite)).toContain('GITHUB_ENV=/dev/null');
  expect(
    workflow.slice(cleanup, workflow.indexOf('name: Retire interrupted assignment', cleanup))
  ).toContain('if: always()');
});
