// One finite data copy through the installed service RPCs. The DB owns each
// committed cursor. A transport failure stops the command at that exact cursor.
const expectedProject = 'https://kuklfnapbkmacvwxktbh.supabase.co';
const configuredUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!configuredUrl || new URL(configuredUrl).origin !== expectedProject || !key)
  throw new Error('Configured PokerIQ production service access is required');

async function rpc(name, args) {
  const response = await fetch(`${expectedProject}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}; inspect the durable copy cursor`);
  return response.json();
}
let complete = false;
for (let page = 0; page < 2000 && !complete; page++) {
  const progress = await rpc('fn_wheel_copy_wide_journal_batch', { p_rows: 1000 });
  if (typeof progress.complete !== 'boolean') throw new Error('The copy RPC returned no completion status');
  complete = progress.complete;
}
if (!complete) throw new Error('The bounded run ended; resume from the durable copy cursor');
console.log(JSON.stringify(await rpc('fn_wheel_verify_wide_journal_copy', {})));
