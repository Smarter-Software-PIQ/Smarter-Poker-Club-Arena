import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
export const terminalWelcomeFixtureSQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'reserved-terminal-welcome-fixture.sql'),
  'utf8'
);

export const preparedTerminalStaffClubs = Object.freeze([
  'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
  '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3',
  'fade0000-0000-0000-0000-000000000001',
]);
export const terminalStaffSQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'reserved-terminal-staff.sql'),
  'utf8'
);

// Only a persisted creation receipt from this account's own fixture admits this
// route. No terminal row or immutable cancellation receipt is deleted.
export async function retireTerminalWelcomeFixture({ client, clubId, account, reason }) {
  const request = account?.templateFixtureRequest;
  if (!account?.id || !account?.email || request?.clubId !== clubId || !request?.requestId) {
    throw new Error('Exact Owned Terminal Welcome Fixture Receipt Required.');
  }
  // Join/cleanup own the membership lane first. All cashier hierarchy lanes
  // precede club/member rows: DELETE's maintained trigger takes the same lane.
  await client.query('SELECT public.fn_club_membership_lock($1::uuid)', [account.id]);
  await client.query('SELECT public.fn_ca_lock_settlement_lane_global()');
  const clubScopes = [...new Set([clubId, ...preparedTerminalStaffClubs])].sort();
  for (const scope of clubScopes) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:'||$1::text,0))",
      [scope]
    );
  }
  await client.query(
    'SELECT id FROM public.clubs WHERE id=ANY($1::uuid[]) ORDER BY id FOR KEY SHARE',
    [preparedTerminalStaffClubs]
  );
  await client.query(
    'SELECT club_id FROM public.club_members WHERE user_id=$1::uuid ORDER BY club_id FOR UPDATE',
    [account.id]
  );
  await client.query(
    'SELECT id FROM public.wallets WHERE user_id=$1::uuid ORDER BY id FOR UPDATE',
    [account.id]
  );
  await client.query(
    'SELECT user_id FROM public.diamond_wallets WHERE user_id=$1::uuid FOR UPDATE',
    [account.id]
  );
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
  const staffValues = [account.id, clubId, preparedTerminalStaffClubs];
  const staff = (await client.query(terminalStaffSQL, staffValues)).rows;
  if (
    staff?.length !== 1 ||
    staff[0].safe_staff_retirement !== true ||
    !Array.isArray(staff[0].prepared_club_ids)
  ) {
    throw new Error('Reserved Terminal Fixture Staff Custody Or Authority Refused.');
  }
  for (const scope of staff[0].prepared_club_ids) {
    const left = (
      await client.query('SELECT public.fn_member_leave_to_treasury($1::uuid,$2::uuid) AS result', [
        scope,
        account.id,
      ])
    ).rows?.[0]?.result;
    if (left?.success !== true || left.chips_returned !== 0) {
      throw new Error('Reserved Terminal Fixture Staff Departure Refused.');
    }
  }
  const privileges = (
    await client.query(
      'SELECT bool_or(public.fn_club_is_staff(club_id,$1::uuid)) AS has_live_staff FROM unnest($2::uuid[]) AS scopes(club_id)',
      [account.id, preparedTerminalStaffClubs]
    )
  ).rows;
  if (privileges?.length !== 1 || privileges[0].has_live_staff !== false) {
    throw new Error('Reserved Terminal Fixture Still Holds Live Staff Authority.');
  }
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
  const creation = (
    await client.query(
      'SELECT bool_or(public.fn_can_create_games(club_id,$1::uuid)) AS can_create_games FROM unnest($2::uuid[]) AS scopes(club_id)',
      [account.id, clubScopes]
    )
  ).rows;
  if (creation?.length !== 1 || creation[0].can_create_games !== false) {
    throw new Error('Reserved Terminal Fixture Still Holds Game Creation Authority.');
  }
  const staffAfter = (await client.query(terminalStaffSQL, staffValues)).rows;
  if (
    staffAfter?.length !== 1 ||
    staffAfter[0].safe_staff_retirement !== true ||
    staffAfter[0].prepared_club_ids?.length !== 0
  ) {
    throw new Error('Reserved Terminal Fixture Staff Departure Readback Refused.');
  }
  return {
    ...result,
    disposition: 'retained_terminal_fixture_owner',
    owner_id: account.id,
    prepared_staff_clubs_retired: staff[0].prepared_club_ids,
  };
}
