import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { createPlugin } from './index.mjs';
const queued = {
  operationId: '00000000-0000-4000-8000-000000000001',
  ids: ['00000000-0000-4000-8000-000000000002'],
  phase: 'queued',
  messageId: '00000000-0000-4000-8000-000000000003',
  wake: 'uncertain',
};
function harness({
  clientFactory,
  state = structuredClone(queued),
  stateFactory,
  executeCommand,
  pending,
  statPath,
} = {}) {
  let service,
    statusMethod,
    closed = 0,
    effects = 0;
  const channels = [];
  const factory =
    clientFactory ??
    (() => ({
      rpc:
        pending ??
        (async () => ({ data: { version: 1, active_acknowledged: false, pending: [] } })),
      channel() {
        const channel = {
          on(_type, filter, callback) {
            this[filter.event] = callback;
            return this;
          },
          subscribe(cb) {
            this.callback = cb;
            return this;
          },
        };
        channels.push(channel);
        return channel;
      },
      async removeChannel(channel) {
        channel.callback('CLOSED');
      },
      async removeAllChannels() {},
    }));
  createPlugin({
    clientFactory: factory,
    executeCommand:
      executeCommand ??
      (async (file) => {
        if (file === '/usr/bin/security') return { stdout: 'a'.repeat(64) };
        effects++;
        throw new Error('no native effect authorized');
      }),
    statPath: statPath ?? (async (path) => ({ dev: path === '/' ? 1 : 2 })),
    stateFactory:
      stateFactory ??
      (async () => ({
        load: async () => structuredClone(state),
        save: async (value) => {
          state = structuredClone(value);
        },
        close() {
          closed++;
        },
      })),
  }).register({
    pluginConfig: {
      publishableKey: 'sb_publishable_fixture',
      stateDirectory: '/Volumes/SmarterWork/agent-work/fixture-only',
    },
    logger: { error() {} },
    registerService(value) {
      service = value;
    },
    registerGatewayMethod(_name, method) {
      statusMethod = method;
    },
  });
  return {
    service,
    channels,
    status: () => {
      let value;
      statusMethod({
        respond(_ok, result) {
          value = result;
        },
      });
      return value;
    },
    snapshot: () => ({ state, closed, effects }),
  };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));
test('original queued wake uncertainty survives close, stop, start and stale callbacks without a second side effect', async () => {
  const h = harness();
  await h.service.start();
  h.channels[0].callback('SUBSCRIBED');
  await turn();
  assert.equal(h.status().serviceActive, true);
  h.channels[0].callback('CLOSED');
  await turn();
  assert.equal(h.channels.length, 2);
  h.channels[1].callback('SUBSCRIBED');
  await turn();
  assert.deepEqual(h.status().active, queued);
  await assert.rejects(h.service.start(), /already started/);
  await h.service.stop();
  assert.equal(h.status().lifecycle, 'stopped');
  assert.equal(h.status().channelStatus, 'stopped');
  h.channels[1].callback('SUBSCRIBED');
  assert.equal(h.status().serviceActive, false);
  await h.service.start();
  h.channels[2].callback('SUBSCRIBED');
  await turn();
  assert.deepEqual(h.snapshot().state, queued);
  assert.equal(h.snapshot().effects, 0);
  await h.service.stop();
  assert.equal(h.snapshot().closed, 2);
});
test('repeated terminal close is bounded and explicitly degraded; stop does not resubscribe', async () => {
  const h = harness();
  await h.service.start();
  h.channels[0].callback('CLOSED');
  await turn();
  h.channels[1].callback('CLOSED');
  await turn();
  assert.equal(h.channels.length, 2);
  assert.equal(h.status().lifecycle, 'degraded');
  assert.equal(h.status().closeRecoveries, 1);
  await h.service.stop();
  assert.equal(h.channels.length, 2);
});
test('stop during asynchronous start closes acquired ownership and prevents subscription', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness({
    executeCommand: async () => {
      await gate;
      return { stdout: 'a'.repeat(64) };
    },
  });
  const start = h.service.start();
  const stop = h.service.stop();
  release();
  await Promise.all([start, stop]);
  assert.equal(h.status().lifecycle, 'stopped');
  assert.equal(h.channels.length, 0);
  assert.equal(h.snapshot().closed, 1);
});
test('unavailable journal is start_failed, never active or a fabricated empty queue', async () => {
  const h = harness({
    stateFactory: async () => {
      throw new Error('owned');
    },
  });
  await assert.rejects(h.service.start(), /owned/);
  assert.equal(h.status().lifecycle, 'start_failed');
  assert.equal(h.status().serviceActive, false);
});
test('actual Supabase websocket phx_close obtains one fresh subscription and reads the same accepted batch', async () => {
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  let joins = 0,
    reads = 0,
    first;
  sockets.on('connection', (socket) => {
    socket.on('message', (bytes) => {
      const msg = JSON.parse(bytes.toString());
      if (msg.event === 'phx_join') {
        joins++;
        if (!first) first = { socket, msg };
      }
      if (['phx_join', 'phx_leave', 'heartbeat'].includes(msg.event))
        socket.send(
          JSON.stringify({
            topic: msg.topic,
            event: 'phx_reply',
            payload: { status: 'ok', response: {} },
            ref: msg.ref,
            join_ref: msg.join_ref,
          })
        );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const h = harness({
    clientFactory: (_url, key, options) => {
      const client = createClient(`http://127.0.0.1:${server.address().port}`, key, options);
      client.rpc = async () => {
        reads++;
        return { data: { version: 1, active_acknowledged: false, pending: [] } };
      };
      return client;
    },
  });
  const until = async (predicate) => {
    const end = Date.now() + 5000;
    while (!predicate()) {
      assert.ok(
        Date.now() < end,
        JSON.stringify({
          joins,
          reads,
          lifecycle: h.status().lifecycle,
          channelStatus: h.status().channelStatus,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  try {
    await h.service.start();
    await until(() => joins === 1 && reads === 1);
    first.socket.send(
      JSON.stringify({
        topic: first.msg.topic,
        event: 'phx_close',
        payload: {},
        ref: null,
        join_ref: first.msg.join_ref,
      })
    );
    await until(() => joins === 2 && reads === 2);
    first = null;
    // The next independently recovered episode must not consume a lifetime-only allowance.
    const connection = [...sockets.clients][0];
    connection.send(
      JSON.stringify({
        topic: 'realtime:ca-native-alert-intake-v1:' + 'a'.repeat(64),
        event: 'phx_close',
        payload: {},
        ref: null,
      })
    );
    await until(() => joins === 3 && reads === 3);
    assert.equal(h.status().lifecycle, 'active');
    assert.deepEqual(h.status().active, queued);
    assert.equal(h.snapshot().effects, 0);
  } finally {
    await h.service.stop();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a joined channel with a failed pending read does not replenish close recovery', async () => {
  const h = harness({ pending: async () => ({ error: { code: 'fixture_unavailable' } }) });
  try {
    await h.service.start();
    h.channels[0].callback('SUBSCRIBED');
    await turn();
    h.channels[0].callback('CLOSED');
    await turn();
    h.channels[1].callback('SUBSCRIBED');
    await turn();
    assert.match(h.status().lastError, /pending read unavailable/);
    h.channels[1].callback('CLOSED');
    await turn();
    assert.equal(h.channels.length, 2);
    assert.equal(h.status().lifecycle, 'degraded');
    assert.equal(h.snapshot().effects, 0);
  } finally {
    await h.service.stop();
  }
});

test('failed subscribe invalidates callbacks before transport cleanup closes the channel', async () => {
  let created = 0,
    callback;
  const h = harness({
    clientFactory: () => ({
      channel() {
        created++;
        return {
          on() {
            return this;
          },
          subscribe(cb) {
            callback = cb;
            throw new Error('subscription setup failed');
          },
        };
      },
      async removeAllChannels() {
        callback('CLOSED');
      },
    }),
  });
  await assert.rejects(h.service.start(), /subscription setup failed/);
  await turn();
  assert.equal(created, 1);
  assert.equal(h.status().lifecycle, 'start_failed');
  callback('SUBSCRIBED');
  assert.equal(h.status().serviceActive, false);
  assert.equal(h.snapshot().closed, 1);
  assert.equal(h.service.client, null);
  assert.equal(h.service.channel, null);
});
test('a later successful broadcast read completes the same recovered episode', async () => {
  let failed = true;
  const h = harness({
    pending: async () =>
      failed ? { error: {} } : { data: { version: 1, active_acknowledged: false, pending: [] } },
  });
  try {
    await h.service.start();
    h.channels[0].callback('CLOSED');
    await turn();
    h.channels[1].callback('SUBSCRIBED');
    await turn();
    assert.match(h.status().lastError, /pending read unavailable/);
    failed = false;
    h.channels[1].inbox_committed();
    await turn();
    assert.equal(h.status().lastError, null);
    assert.equal(h.status().closeRecoveryAttempts, 0);
    h.channels[1].callback('CLOSED');
    await turn();
    assert.equal(h.channels.length, 3);
    assert.deepEqual(h.snapshot().state, queued);
    assert.equal(h.snapshot().effects, 0);
  } finally {
    await h.service.stop();
  }
});

test('journal on the external volume starts even when /Volumes/SmarterWork is a startup-disk folder', async () => {
  const h = harness({
    statPath: async (path) => ({
      dev: path === '/Volumes/SmarterWork/agent-work/fixture-only' ? 2 : 1,
    }),
  });
  await h.service.start();
  assert.notEqual(h.status().lifecycle, 'start_failed');
});
test('journal on the startup disk is start_failed even when /Volumes/SmarterWork is external', async () => {
  const h = harness({
    statPath: async (path) => ({ dev: path === '/' || path.includes('fixture-only') ? 1 : 2 }),
  });
  await assert.rejects(h.service.start(), /external work volume is not mounted/);
  assert.equal(h.status().lifecycle, 'start_failed');
});
