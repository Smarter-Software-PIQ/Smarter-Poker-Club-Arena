// Installed only on the isolated Backup host. Never log a bearer or a snapshot.
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const [mode, table, user, seat, from, to] = process.argv.slice(2);
const engine = 'club-arena-engine-standby:8080';
const kong = 'http://supabase_kong_standby:8000';
const deadline = Date.now() + 12 * 60_000;

async function session() {
  if (process.env.ENGINE_STANDBY_CLONE !== '1' || process.env.SUPABASE_URL !== kong)
    throw Error('Backup qualification requires isolated authentication');
  const password = randomBytes(32).toString('hex');
  const email = 'standby-' + user + '@example.invalid';
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const update = await fetch(kong + '/auth/v1/admin/users/' + user, {
    method: 'PUT',
    headers: {
      apikey: admin,
      authorization: 'Bearer ' + admin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!update.ok) throw Error('Backup fixture identity initialization failed ' + update.status);
  const response = await fetch(kong + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error('Backup fixture sign-in failed ' + response.status);
  const auth = await response.json();
  if (auth.user?.id !== user || !auth.access_token) throw Error('unexpected fixture identity');
  process.stdout.write(auth.access_token);
}

async function identity() {
  const health = await fetch('http://' + engine + '/health', { signal: AbortSignal.timeout(3000) });
  if (!health.ok) throw Error('Backup health ' + health.status);
  return (await health.json()).releaseSha;
}

export async function observe({ url, token, predecessor, table, user, seat, connected, deadline }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, ['bearer', token]);
    let proved = false;
    let firstHand;
    let lastResync = 0;
    const timer = setTimeout(
      () => finish(Error('player snapshot deadline')),
      Math.min(deadline - Date.now(), predecessor ? 600000 : 480000)
    );
    function finish(error) {
      clearTimeout(timer);
      socket.onclose = null;
      socket.close();
      if (error) reject(error);
      else resolve();
    }
    socket.onmessage = ({ data }) => {
      try {
        const frame = JSON.parse(data);
        if (frame.type === 'PING') socket.send(JSON.stringify({ type: 'PONG', ts: frame.ts }));
        if (
          !predecessor &&
          proved &&
          frame.type === 'DELTA' &&
          frame.tableId === table &&
          Date.now() - lastResync >= 2000
        ) {
          lastResync = Date.now();
          socket.send(JSON.stringify({ type: 'RESYNC' }));
        }
        if ((predecessor && proved) || frame.type !== 'SNAPSHOT' || frame.tableId !== table) return;
        const players = frame.state?.players;
        if (!Array.isArray(players)) return;
        const matching = players.filter(
          (player) => player.user_id === user && player.seat === Number(seat)
        );
        if (matching.length !== 1 || !Number.isFinite(matching[0].stack)) return;
        const hand = frame.state.hand_number;
        if (!Number.isSafeInteger(hand) || hand < 0) return;
        const nextHand = proved && hand > firstHand;
        if (!proved) firstHand = hand;
        proved = true;
        if (predecessor) connected();
        else if (nextHand) finish();
      } catch (error) {
        finish(error);
      }
    };
    socket.onerror = () => finish(Error('Backup table socket error'));
    socket.onclose = () => {
      clearTimeout(timer);
      if (predecessor && proved) resolve();
      else reject(Error('socket closed before player snapshot'));
    };
  });
}

async function witness() {
  const token = readFileSync(0, 'utf8').trim();
  if (!token || (await identity()) !== from) throw Error('predecessor unavailable');
  const connection = {
    url: 'ws://' + engine + '/ws/table/' + table + '?v=1',
    token,
    table,
    user,
    seat,
    deadline,
    connected: () => writeFileSync('/proof/connected', 'connected\n', { flag: 'wx' }),
  };
  await observe({ ...connection, predecessor: true });
  while (Date.now() < deadline) {
    let active;
    try {
      active = await identity();
    } catch {
      /* Engine is changing. */
    }
    if (active === to) {
      await observe({ ...connection, predecessor: false });
      if ((await identity()) !== to) throw Error('successor changed during snapshot');
      console.log(
        JSON.stringify({ from, to, sameSession: true, seatRecovered: true, nextHandObserved: true })
      );
      return;
    }
    await delay(500);
  }
  throw Error('successor unavailable');
}
// The session issuer is fed to node on stdin inside the predecessor.
if (
  process.argv[1] === '-' ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  if (mode === 'session') await session();
  else if (mode === 'witness') await witness();
  else throw Error('unknown qualification mode');
}
