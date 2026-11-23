/**
 * LAW: THE LIGHTNING POOL VPIP FLOOR JUDGES HUMANS AND HORSES FAIRLY
 * (25% floor / 30-hand rolling window / 10 grace hands, warn before boot,
 * between hands only, clean reset on leave/rejoin and pool switch-off).
 *
 * Every pin below guards a structural invariant of the Lightning Pool VPIP
 * Floor Judge so it cannot silently regress into:
 *   - unenforced pools,
 *   - horse-exempt or human-only enforcement (CLAUDE.md 10.5),
 *   - mid-hand eviction or chip loss,
 *   - instant eviction without warning or initial grace,
 *   - direct seat/wallet writes from src/lightning/,
 *   - cron/watcher/repair loops (CLAUDE.md 10.12),
 *   - stale samples surviving pool switch-off or leave/rejoin.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sliceMethod } from './helpers/sourceWindow';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const JUDGE = read('server/src/lightning/LightningPoolVpipJudge.ts');
const DOOR = read('server/src/services/LightningPoolVpipDoor.ts');
const HOST = read('server/src/lightning/LightningHandHost.ts');
const SUPERVISOR = read('server/src/lightning/LightningSupervisor.ts');
const REGISTRY = read('server/src/lightning/LightningRegistry.ts');
const SEATING = read('server/src/engine/ServerTableEngineSeating.ts');
const INDEX = read('server/src/index.ts');

describe('LAW: the Lightning pool VPIP floor judges humans and Horses fairly', () => {
  it('defaults to 25% floor, 30-hand rolling window, and 10 grace hands', () => {
    expect(JUDGE).toMatch(/LIGHTNING_POOL_VPIP_DEFAULT_FLOOR_PCT\s*=\s*25\b/);
    expect(JUDGE).toMatch(/LIGHTNING_POOL_VPIP_DEFAULT_WINDOW_HANDS\s*=\s*30\b/);
    expect(JUDGE).toMatch(/LIGHTNING_POOL_VPIP_DEFAULT_GRACE_HANDS\s*=\s*10\b/);
    // Floor percentage is read dynamically from the host table's maintain_percent_min.
    expect(JUDGE).toMatch(/rules\.maintain_percent_min/);
  });

  it('reads no horse identity anywhere in the judge or eviction door (CLAUDE.md 10.5)', () => {
    expect(stripComments(JUDGE)).not.toMatch(/is_?[Hh]orse/);
    expect(stripComments(DOOR)).not.toMatch(/is_?[Hh]orse/);
  });

  it('builds no cron, watcher, sweep or repair path (CLAUDE.md 10.12)', () => {
    expect(stripComments(JUDGE)).not.toMatch(/setInterval|setTimeout|cron\.(schedule|job)/);
    expect(stripComments(DOOR)).not.toMatch(/setInterval|setTimeout|cron\.(schedule|job)/);
  });

  it('keeps src/lightning/ free of direct seat, wallet, or money RPC writes', () => {
    const code = stripComments(JUDGE);
    expect(code).not.toMatch(/table_seats|wallet|fn_cash_|fn_ca_commit_hand|\.rpc\(|\.from\(/);
  });

  it('warns before evicting and enforces initial grace', () => {
    expect(JUDGE).toMatch(/row\.totalEligibleHands < policy\.graceHands/);
    expect(JUDGE).toMatch(/row\.warnedAtEligibleHands === null/);
    // Grace is counted in eligible hands numbered AFTER the warning, so a delayed earlier hand that
    // commits late cannot spend it (2026-11-22).
    expect(JUDGE).toMatch(/row\.postWarningEligibleHands < policy\.graceHands/);
    expect(JUDGE).toMatch(/handNumber > row\.warnedAtHandNumber/);
    expect(JUDGE).toMatch(/verdict:\s*wasWarned \? 'recovered' : 'ok'/);
  });

  it('is wired into committed hand settlement BEFORE releasing players back to the matcher', () => {
    const settledIdx = HOST.indexOf("this.state = 'complete';");
    const evalIdx = HOST.indexOf('const vpipEvicted = await this.evaluatePoolVpipFloor();');
    const releaseIdx = HOST.indexOf('this.releaseAtHandEnd(vpipEvicted);');
    expect(settledIdx).toBeGreaterThan(-1);
    expect(evalIdx).toBeGreaterThan(settledIdx);
    expect(releaseIdx).toBeGreaterThan(evalIdx);
    // Emits private warning and recovery frames to the participant's own room.
    expect(HOST).toContain("type: 'lightning_vpip_warning'");
    expect(HOST).toContain("type: 'lightning_vpip_recovered'");
  });

  it('evicts ONLY cleanly between hands through atomicCashout on leaveMode vpip_evicted', () => {
    const body = sliceMethod(SEATING, 'public async evictForLightningVpip(');
    expect(body).toContain('isMaintenanceFrozen()');
    expect(body).toContain('await this.inLiveLightningHand(userId)');
    expect(body).toContain("leaveMode: 'vpip_evicted' as const");
    expect(body).toContain('onLightningHandInProgress:');
    expect(body).toContain("reason: 'nit_game_vpip'");
    expect(body).toContain('mid_hand: false');
  });

  it('resets samples cleanly on pool switch-off/restart and ended room close, and wires the leader door', () => {
    expect(SUPERVISOR).toContain('this.vpipJudge.resetCluster(clusterId)');
    expect(REGISTRY).toContain('this.vpipJudge.resetSession(roomId)');
    expect(INDEX).toContain('startLightningPoolVpipDoor(');
    expect(INDEX).toContain("['LightningPoolVpipDoor', stopLightningPoolVpipDoor]");
  });
});
