import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
export const terminalWelcomeFixtureSQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'reserved-terminal-welcome-fixture.sql'),
  'utf8'
);

// Only a persisted creation receipt from this account's own fixture admits this
// route. No terminal row or immutable cancellation receipt is deleted.
export async function retireTerminalWelcomeFixture({ client, clubId, account, reason }) {
  const request = account?.templateFixtureRequest;
  if (!account?.id || !account?.email || request?.clubId !== clubId || !request?.requestId) {
    throw new Error('Exact Owned Terminal Welcome Fixture Receipt Required.');
  }
  await client.query('SELECT public.fn_ca_lock_settlement_lane_global()');
  await client.query('SELECT id FROM public.clubs WHERE id=$1::uuid FOR UPDATE', [clubId]);
  await client.query(
    'SELECT id FROM public.tournaments WHERE club_id=$1::uuid ORDER BY id FOR UPDATE',
    [clubId]
  );
  await client.query('SELECT id FROM public.tables WHERE club_id=$1::uuid ORDER BY id FOR UPDATE', [
    clubId,
  ]);
  const values = [clubId, account.id, account.email, request.requestId];
  const rows = (await client.query(terminalWelcomeFixtureSQL, values)).rows;
  if (rows?.length !== 1 || rows[0].safe_terminal_template !== true) {
    throw new Error('Reserved Terminal Welcome Fixture Lineage Refused.');
  }
  const club = rows[0];
  // Same reserved owner claim used by the maintained idle-table close path;
  // obtained from the exact account+creation receipt, never a personal identity.
  await client.query(
    "SELECT set_config('request.jwt.claims',$1::text,true), set_config('request.jwt.claim.sub',$2::text,true)",
    [JSON.stringify({ sub: account.id, role: 'authenticated' }), account.id]
  );
  const result = (
    await client.query(
      'SELECT public.fn_retire_settled_club($1::uuid,$2::text,$3::text) AS result',
      [clubId, club.name, reason]
    )
  ).rows?.[0]?.result;
  if (
    result?.success !== true ||
    (result?.records_retained !== true && result?.already_retired !== true)
  ) {
    throw new Error(`Reserved Terminal Welcome Retirement Refused: ${result?.error || 'unknown'}`);
  }
  const retained = (await client.query(terminalWelcomeFixtureSQL, values)).rows;
  if (
    retained?.length !== 1 ||
    retained[0].lifecycle_status !== 'retired' ||
    retained[0].safe_terminal_template !== true
  ) {
    throw new Error('Reserved Terminal Welcome Retirement Readback Refused.');
  }
  return { ...result, disposition: 'retained_terminal_fixture_owner', owner_id: account.id };
}
