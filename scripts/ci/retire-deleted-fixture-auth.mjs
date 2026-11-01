#!/usr/bin/env node
// Retire the Auth rows of three named, already-erased test fixtures.
//
// 2026-11-01. Five retired test fixtures had their profiles erased (status
// 'deleted', tombstoned username, both GDPR requests 'anonymized') but kept a
// live Auth row. Two were already soft-deleted in GoTrue and had their GDPR
// requests completed by SQL; the three below still hold a usable Auth row.
// The owner ordered the deletion finished (Dan, 2026-10-31 15:34 and
// 2026-11-01 00:05 America/Chicago).
//
// This is a one-shot operator door, not a sweep: it acts on exactly the ids in
// FIXTURES and nothing else, refuses any id whose erasure it cannot prove first,
// and uses GoTrue's supported soft delete (the UUID survives, so every ledger
// row that names it keeps its actor; credentials, identities, sessions and
// refresh tokens are cleared by GoTrue). Running it again after success finds
// every row already soft-deleted and changes nothing. No wallet, chip or seat
// row is read or written; probebet's 300 diamonds stay where they are.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const FIXTURES = Object.freeze([
  'c81296d4-1b1f-4ec2-b9c4-fd795fbb63dd',
  '6fd4f8ef-5bd9-48b3-bfd8-0f32dd752dc4',
  '00000000-0000-0000-0000-000000000091',
]);

function readConfiguration(env) {
  const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!/^https:\/\/kuklfnapbkmacvwxktbh\.supabase\.co$/.test(supabaseUrl)) {
    throw new Error('SUPABASE_URL must be the pinned production project.');
  }
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  return { supabaseUrl, serviceRoleKey };
}

function headers(key) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function request(configuration, fetchImpl, path, init = {}) {
  const response = await fetchImpl(`${configuration.supabaseUrl}${path}`, {
    ...init,
    redirect: 'error',
    headers: headers(configuration.serviceRoleKey),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, ok: response.ok, body };
}

async function readErasure(configuration, fetchImpl, id) {
  const profile = await request(
    configuration,
    fetchImpl,
    `/rest/v1/profiles?select=id,status&id=eq.${id}`
  );
  if (!profile.ok || !Array.isArray(profile.body)) {
    throw new Error(`${id}: the profile could not be read (HTTP ${profile.status}).`);
  }
  const gdpr = await request(
    configuration,
    fetchImpl,
    `/rest/v1/gdpr_deletion_requests?select=id,status&user_id=eq.${id}`
  );
  if (!gdpr.ok || !Array.isArray(gdpr.body)) {
    throw new Error(`${id}: the erasure requests could not be read (HTTP ${gdpr.status}).`);
  }
  const auth = await request(configuration, fetchImpl, `/auth/v1/admin/users/${id}`);
  if (auth.status !== 200 && auth.status !== 404) {
    throw new Error(`${id}: the Auth row could not be read (HTTP ${auth.status}).`);
  }
  const user = auth.status === 200 ? auth.body?.user || auth.body : null;
  return { profiles: profile.body, requests: gdpr.body, user };
}

export async function retireDeletedFixtureAuth({
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const configuration = readConfiguration(env);
  const outcomes = [];
  for (const id of FIXTURES) {
    const before = await readErasure(configuration, fetchImpl, id);
    // Prove the erasure before touching Auth: one deleted profile and at least
    // one erasure request, every one already anonymized or completed.
    if (before.profiles.length !== 1 || before.profiles[0].status !== 'deleted') {
      throw new Error(`${id}: the profile is not an erased (status 'deleted') profile; refused.`);
    }
    if (
      before.requests.length === 0 ||
      before.requests.some((r) => r.status !== 'anonymized' && r.status !== 'completed')
    ) {
      throw new Error(`${id}: the erasure requests are not all anonymized or completed; refused.`);
    }
    if (before.user && before.user.id !== id) {
      throw new Error(`${id}: the Auth row answered for a different id; refused.`);
    }
    if (before.user && !before.user.deleted_at) {
      const removed = await request(configuration, fetchImpl, `/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ should_soft_delete: true }),
      });
      if (!removed.ok)
        throw new Error(`${id}: GoTrue refused the soft delete (HTTP ${removed.status}).`);
    }
    const after = await readErasure(configuration, fetchImpl, id);
    if (after.user && !after.user.deleted_at) {
      throw new Error(`${id}: the Auth row is still live after the soft delete.`);
    }
    let completed = 0;
    for (const req of after.requests.filter((r) => r.status === 'anonymized')) {
      const marked = await request(
        configuration,
        fetchImpl,
        '/rest/v1/rpc/fn_mark_gdpr_completed',
        {
          method: 'POST',
          body: JSON.stringify({ p_request_id: req.id }),
        }
      );
      if (!marked.ok)
        throw new Error(`${id}: request ${req.id} could not be completed (HTTP ${marked.status}).`);
      completed += 1;
    }
    const outcome = {
      id,
      auth: after.user ? 'soft_deleted' : 'absent',
      requestsCompleted: completed,
    };
    outcomes.push(outcome);
    log(`[retire-deleted-fixture-auth] ${JSON.stringify(outcome)}`);
  }
  return outcomes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  retireDeletedFixtureAuth().catch((error) => {
    console.error(`[retire-deleted-fixture-auth] ${error.message}`);
    process.exit(1);
  });
}
