import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  certificationConfig,
  inSitAndGoWindow,
  verdict,
  HEADS_UP_CERT_CLUB_NAME_PREFIX,
} from '../../scripts/ci/certify-heads-up-rematch.mjs';

describe('heads-up rematch live certification', () => {
  it('runs only while Sit & Go entries are open (closed 03:00-06:00 Chicago)', () => {
    expect(inSitAndGoWindow(new Date('2026-11-09T08:59:00Z'))).toBe(true); // 02:59 CST
    expect(inSitAndGoWindow(new Date('2026-11-09T09:00:00Z'))).toBe(false); // 03:00 CST
    expect(inSitAndGoWindow(new Date('2026-11-09T11:59:00Z'))).toBe(false); // 05:59 CST
    expect(inSitAndGoWindow(new Date('2026-11-09T12:00:00Z'))).toBe(true); // 06:00 CST
  });

  it('copies the board game terms and changes only the club, union and opening', () => {
    const template = {
      id: 'board-game',
      club_id: 'house',
      union_id: 'house-union',
      name: "Hold'em Heads-Up 1 Turbo",
      buy_in_amount: 0.95,
      buy_in_fee: 0.05,
      starting_chips: 300,
      max_players: 2,
      payout_structure: [{ place: 1, percentage: 100 }],
      status: 'RUNNING',
      current_players: 1,
    };
    const config = certificationConfig(template, 'cert-club', Date.parse('2026-11-09T05:00:00Z'));
    expect(config).toMatchObject({
      club_id: 'cert-club',
      union_id: null,
      name: template.name,
      buy_in_amount: 0.95,
      buy_in_fee: 0.05,
      starting_chips: 300,
      max_players: 2,
      payout_structure: template.payout_structure,
      status: 'REGISTERING',
      current_players: 0,
      start_time: '2026-11-09T08:00:00.000Z',
    });
    expect(config).not.toHaveProperty('id');
  });

  it('is UNKNOWN when gated, and fails on any failed case or unfinished cleanup', () => {
    expect(verdict({ gate: { run: false, reason: 'closed' }, steps: [], cleanup: [] }).conclusion).toBe('unknown');
    const ok = [{ name: 'a', ok: true }];
    expect(verdict({ gate: { run: true }, steps: ok, cleanup: [{ step: 'x', ok: true }] }).conclusion).toBe('pass');
    expect(verdict({ gate: { run: true }, steps: ok, cleanup: [{ step: 'x', ok: false }] }).conclusion).toBe('fail');
    expect(verdict({ gate: { run: true }, steps: [{ name: 'a', ok: false }], cleanup: [] }).conclusion).toBe('fail');
    expect(verdict({ gate: { run: true }, steps: [], cleanup: [] }).conclusion).toBe('fail');
  });

  it('is started by hand only and uses the reserved certification route', () => {
    const workflow = readFileSync('.github/workflows/heads-up-rematch-certification.yml', 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    const script = readFileSync('scripts/ci/certify-heads-up-rematch.mjs', 'utf8');
    expect(script).toContain('createProductionE2EAccount');
    expect(script).toContain('settleRabbitHuntClub');
    expect(script).not.toContain('fn_ca_mint');
    expect(HEADS_UP_CERT_CLUB_NAME_PREFIX).toBe('Cert HU ');
  });
});
