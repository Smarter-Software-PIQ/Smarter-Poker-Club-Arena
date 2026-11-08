import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { observe } from './player-reconnect.mjs';

test('the same bearer loses its old transport and observes its seat in a later successor hand', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const options = {
    table: 'table',
    user: 'player',
    seat: 3,
    token: 'fixture-session',
    deadline: Date.now() + 5000,
    url: 'ws://127.0.0.1:' + server.address().port,
  };
  let connections = 0;
  let peer;
  const snapshot = (hand, seat) =>
    JSON.stringify({
      type: 'SNAPSHOT',
      tableId: options.table,
      state: { hand_number: hand, players: [{ user_id: options.user, seat, stack: 100 }] },
    });
  server.on('connection', (socket, request) => {
    connections++;
    peer = socket;
    assert.equal(
      request.headers['sec-websocket-protocol'].replaceAll(' ', ''),
      'bearer,fixture-session'
    );
    socket.send(snapshot(12, 3));
    if (connections === 2) {
      socket.send(snapshot(13, 4));
      socket.send(JSON.stringify({ type: 'DELTA', tableId: options.table }));
      socket.on('message', (data) => {
        assert.equal(JSON.parse(data).type, 'RESYNC');
        socket.send(snapshot(13, 3));
      });
    }
  });
  try {
    await observe({ ...options, predecessor: true, connected: () => peer.close() });
    await observe({ ...options, predecessor: false });
    assert.equal(connections, 2);
  } finally {
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});
