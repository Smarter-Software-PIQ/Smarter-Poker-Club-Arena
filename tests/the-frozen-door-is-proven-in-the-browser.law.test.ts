import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sliceCall } from './helpers/sourceWindow';

// Dan, 2026-11-07: after the 13:20 Lightning refusals, prove the frozen-door
// behaviour (#9945, #9963) on the deployed client after every publication,
// without ever freezing production.

const spec = readFileSync('tests/e2e/production-freeze-entry-door.spec.ts', 'utf8');
const workflow = readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8');
const src = (p: string) => readFileSync(p, 'utf8');

describe('the frozen door is proven in the browser on every publication', () => {
  it('runs in the client browser job with the isolated account, on no new timer', () => {
    const step = workflow.slice(
      workflow.indexOf('- name: Certify the authenticated Lightning operator cold loads'),
      workflow.indexOf(
        '- name: Classify the release the Lightning operator certificate ran against'
      )
    );
    expect(step).toContain('tests/e2e/production-freeze-entry-door.spec.ts');
    expect(step).toContain("E2E_REQUIRE_AUTH: '1'");
    expect(step).toContain('--retries=0');
  });

  it('never freezes production: only the freeze answers are faked in the browser', () => {
    const routes = [...spec.matchAll(/page\.route\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(routes.sort()).toEqual([
      '**/rest/v1/rpc/fn_entry_purchases_frozen*',
      '**/rest/v1/rpc/fn_lightning_rejoin_seated*',
      '**/rest/v1/rpc/fn_maintenance_break_state*',
    ]);
    // The rejoin door is answered here, never continued to production.
    const rejoin = sliceCall(spec, "page.route('**/rest/v1/rpc/fn_lightning_rejoin_seated*'");
    expect(rejoin).toContain('json(route, 400');
    expect(spec).not.toMatch(/route\.continue\(/);
    // No write of any kind is issued by the spec itself.
    expect(spec).not.toMatch(/method:\s*'(POST|PATCH|DELETE)'|\.rpc\(|request\.post\(/);
    // Any admission or buy-in reaching the network fails every case.
    expect(spec.match(/toEqual\(\[\]\)/g)?.length).toBe(3);
  });

  it('asserts the three behaviours, and the open door too', () => {
    expect(spec).toContain('Tables Are Back\\. New Seats Open In');
    expect(spec).toContain('Seats Reopen In About');
    expect(spec).toContain('page.getByText(/Could Not Open/)).toHaveCount(0)');
    expect(spec).toContain('const OPENS_IN = /^Opens In \\d:\\d\\d$/;');
    expect(spec).toContain('with entry open a Lightning panel offers an enabled Join Lightning');
  });

  it('a seated player keeps Return To Game while the door is closed, in all three layouts', () => {
    const panel = src('src/components/lobby/GameLobbyPanel.tsx');
    expect(panel.indexOf('if (seated)')).toBeGreaterThan(-1);
    expect(panel.indexOf('if (seated)')).toBeLessThan(panel.indexOf('if (seatsClosedLabel)'));
    const card = src('src/components/lobby/game-cards/ArenaLobbyGameCard.tsx');
    expect(card.indexOf("if (mine === 'seated')")).toBeGreaterThan(-1);
    expect(card.indexOf("if (mine === 'seated')")).toBeLessThan(
      card.indexOf('if (ctx.seatsClosedLabel)')
    );
    const table = src('src/components/lobby/LobbyTable.tsx');
    expect(table).toContain('ctx.seatsClosedLabel && !seated && !waiting');
    expect(table).toContain('!(ctx.seatsClosedLabel && !seated)');
  });
});
