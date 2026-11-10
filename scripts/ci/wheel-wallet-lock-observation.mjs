// Only this qualified financial cutover needs a longer observation interval.
// No transaction remains open between reads. The migration still acquires its
// locks once, with NOWAIT, after the ordinary installer's own preconditions.
export const WHEEL_WALLET_CUTOVER =
  '20261110023653_admit_single_full_wallet_spins_and_guarantee_earned_payouts.sql';

export async function observeWheelWalletReaders(client, source) {
  const admission = /^\s*LOCK TABLE ([a-z0-9_., ]+) IN ACCESS EXCLUSIVE MODE NOWAIT;$/m.exec(
    source
  );
  const tables = admission?.[1].split(',').map((name) => name.trim());
  if (tables?.length !== 15 || tables.some((name) => !/^public\.[a-z0-9_]+$/.test(name)))
    throw new Error('Expected the qualified 15-relation NOWAIT wallet cutover');

  const deadline = Date.now() + 60000;
  let holders;
  while (Date.now() < deadline) {
    const { rows } = await client.query({
      text: `SELECT count(*)::integer AS holders FROM pg_catalog.pg_locks
        WHERE database = (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
          AND relation = ANY($1::regclass[]) AND pid IS DISTINCT FROM pg_backend_pid()`,
      values: [tables],
      query_timeout: Math.min(2000, Math.max(1, deadline - Date.now())),
    });
    holders = rows[0]?.holders;
    if (!Number.isInteger(holders) || holders < 0) throw new Error('Unreadable wallet lock state');
    if (holders === 0) return;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(125, Math.max(0, deadline - Date.now())))
    );
  }
  throw new Error(`Wallet relations remained busy for 60s (last observed holds: ${holders})`);
}
