/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A REFUSAL THAT CANNOT SUCCEED IS NOT SENT - LAW (2026-11-26, binding)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CLAUDE.md 10.10 rule 4 and 10.11: a client asks before it spins, and a
 * defect is fixed at the line that produced it. On 2026-11-26 the Club Arena
 * browser was the source of these production errors, every one a call the
 * database could only refuse:
 *
 *   454  not authorized for this club  ca_club_operations_overview, polled
 *        every minute for managers and agents (the client gated on
 *        isClubStaff; the RPC admits owner, co_owner, admin and platform staff)
 *   164  ACCOUNT_CLOSED                fn_update_presence, beaten every two
 *        minutes by one closed account's open tab for four hours
 *    59  invalid input syntax for type uuid  a route slug (`kings-club`,
 *        `crest-cert-*`) sent to /api/club-arena/spin-activation by Club
 *        Settings, and `demo` sent to fn_game_creation_access and tables.id
 *     7  new row violates row-level security policy  horse_bug_reports
 *        upserts a player's role can never perform
 *
 * and a CI check sent 64 proofs naming a function its migration had not
 * installed yet. Each pin below is the guard at the source. If one goes red,
 * restore the guard; do not widen the pin.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasMissingObject } from '../scripts/ci/check-migrations-are-live.mjs';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('a uuid argument is never sent a route segment', () => {
  it('Club Settings hands the Spin panel the resolved uuid, never the route param', () => {
    const src = code('src/pages/ClubSettingsPage.tsx');
    expect(src).toMatch(/\{clubUUID && <SpinActivationPanel clubId=\{clubUUID\} \/>\}/);
    expect(src).not.toMatch(/<SpinActivationPanel clubId=\{clubId\}/);
  });

  it('the Spin route refuses a non-uuid owner before any request is made', () => {
    const src = code('src/services/SpinActivationService.ts');
    const guard = src.indexOf('!isUUID(body.clubId)');
    const send = src.indexOf("fetch('/api/club-arena/spin-activation'");
    expect(guard).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(guard);
    expect(code('src/hooks/useSpinsWallet.ts')).toMatch(/!enabled \|\| !ownerKey \|\| !isUUID\(ownerKey\)/);
  });

  it('fn_game_creation_access is only asked about an id', () => {
    const src = code('src/services/GameAccessService.ts');
    const guard = src.indexOf('!isUUID(clubUuid)');
    expect(guard).toBeGreaterThan(-1);
    expect(src.indexOf("rpc('fn_game_creation_access'")).toBeGreaterThan(guard);
  });

  it("the multi-table home lookup sends only table ids to tables.id", () => {
    const src = code('src/pages/MultiTablePage.tsx');
    expect(src).toMatch(/\.filter\(\(id\) => isUUID\(id\) && !clubLookupCacheRef\.current\.has\(id\)\)/);
  });
});

describe('a read the database refuses is not asked again', () => {
  const CALLERS = [
    'src/components/navigation/ClubOperationsRailBody.tsx',
    'src/pages/club/ClubOperationsPage.tsx',
    'src/pages/workspaces/ArenaWorkspacePages.tsx',
  ];

  it.each(CALLERS)('%s asks for the overview only under the RPC rule', (file) => {
    const src = code(file);
    const call = src.indexOf('useClubOperationsOverview(');
    expect(call).toBeGreaterThan(-1);
    const args = src.slice(call, src.indexOf(');', call));
    expect(args).toContain('mayReadClubOperationsOverview(access)');
    expect(args).not.toContain('isClubStaff');
  });

  it('the gate is canControlClub, the same roles the RPC admits', () => {
    const src = code('src/hooks/useClubOperationsOverview.ts');
    expect(src).toMatch(/access\.canControlClub && !access\.loading && !access\.error/);
    const nav = code('src/config/clubArenaNavigation.ts');
    expect(nav).toMatch(/CLUB_CONTROL_ROLES = new Set\(\['owner', 'co_owner', 'admin'\]\)/);
  });

  it('a refused scope answers from memory until identity or role changes', () => {
    const src = code('src/hooks/useClubOperationsOverview.ts');
    expect(src).toMatch(/if \(deniedScopes\.has\(scope\)\) throw OVERVIEW_ALREADY_REFUSED;/);
    expect(src).toMatch(/deniedScopes\.add\(scope\)/);
    const invalidate = src.slice(src.indexOf('function invalidateScope'), src.indexOf('function observeScope'));
    expect(invalidate).toContain('deniedScopes.clear()');
  });

  it('a closed account or a revoked session stops the presence heartbeat', () => {
    const lib = code('src/lib/presenceHeartbeat.ts');
    expect(lib).toMatch(/if \(isTerminalPresenceRefusal\(error\)\) \{\s*silenced = userId;/);
    const hook = code('src/hooks/usePresenceHeartbeat.ts');
    expect(hook).toMatch(/if \(isTerminalPresenceRefusal\(e\)\) \{\s*stopped = true;/);
  });

  it('a browser never upserts horse_bug_reports (the policies allow a player INSERT only)', () => {
    const src = code('src/services/HorseBugReporter.ts');
    expect(src).not.toMatch(/from\('horse_bug_reports'\)\s*\.upsert\(/);
    expect(src).toMatch(/worthPersisting && due && !dedupe && !isAutomatedSession\(\)/);
  });
});

describe('a CI proof is not asked of a migration step 2 already proved missing', () => {
  it('hasMissingObject answers from the object probe', () => {
    const missing = new Set(['function\tpublic.fn_cashier_mint_scope']);
    expect(
      hasMissingObject({ objects: [{ kind: 'function', name: 'public.fn_cashier_mint_scope' }] }, missing)
    ).toBe(true);
    expect(hasMissingObject({ objects: [{ kind: 'function', name: 'public.other' }] }, missing)).toBe(false);
    expect(hasMissingObject({ objects: [] }, missing)).toBe(false);
  });

  it('the proof batch is filtered by it before anything is sent', () => {
    const src = code('scripts/ci/check-migrations-are-live.mjs');
    const filter = src.indexOf('if (hasMissingObject(m, missing)) m.runnableProofs = [];');
    const ask = src.indexOf('const all = ask(union(proofChecks));');
    expect(filter).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(filter);
  });
});
