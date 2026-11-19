import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const script = readFileSync('scripts/agent-workspace.sh', 'utf8');
describe('one checkout at a time', () => {
  it('creates every new worktree inside the machine-wide checkout lock', () => {
    expect(script).toContain('agent-checkout.lock');
    const body = script.slice(script.indexOf('create_worktree() {'));
    const add = body.indexOf('worktree add');
    expect(body.indexOf('acquire_checkout_lock')).toBeGreaterThan(-1);
    expect(body.indexOf('acquire_checkout_lock')).toBeLessThan(add);
    expect(body.indexOf('release_checkout_lock')).toBeGreaterThan(add);
    expect(script).toContain('create_worktree || exit 1');
    expect(script.match(/git -C "\$ROOT" worktree add/g)).toHaveLength(2);
  });
  it('takes over a lock its holder abandoned and bounds the wait', () => {
    expect(script).toContain('! kill -0 "$holder"');
    expect(script).toContain('AGENT_CHECKOUT_WAIT_SECONDS:-900');
  });
});
