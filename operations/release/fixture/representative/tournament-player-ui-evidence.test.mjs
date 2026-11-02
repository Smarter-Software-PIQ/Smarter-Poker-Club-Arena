import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { collectPlayerUIWire } from './tournament-player-ui-wire.mjs';
import {
  validatePlayerUIIngress,
  verifyPreActionUI,
  verifyPaidRebuyReturn,
  verifyFinishReport,
  requireCompletePlayerUICoverage,
  requiredPlayerUIFlows,
} from './tournament-player-ui-evidence.mjs';
import {
  validateTournamentRead,
  tournamentObservationBinding,
} from '../../native/tournament-player-observations.mjs';
const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function playerUIIngress(runtimeImage = 'sha256:' + 'a'.repeat(64)) {
  return {
    version: 1, scope: 'isolated-tournament-player-ui',
    source_contract: {version:1,source_sha:'b'.repeat(40),current_database_contract_ready:true,exclusions:[]},
    control_sha: 'c'.repeat(40), schema_catalogue_digest: 'd'.repeat(64),
    runtime_image: runtimeImage, engine_sha: 'e'.repeat(40), web_sha: 'f'.repeat(40),
    cohorts: ['MTT','SPIN','SNG'].map((format, index) => ({
      format, tournament_id:id(30+index), club_id:id(20), anon_key:'synthetic-public-key',
      ...(format==='MTT'?{rebuy_cost:20,rebuy_chips:10000}:{}),
      users: [1,2,3].map(n => {
        const userId=id(100+index*10+n);
        const claims={sub:userId,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
        return {id:userId,session:{user:{id:userId},access_token:'synthetic.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic'}};
      }),
    })),
  };
}
test('actual connected tournament ingress accepts its exact immutable local runtime image ID', () => {
  const value=playerUIIngress();
  assert.equal(validatePlayerUIIngress(value),value);
});
test('tournament ingress preserves registry digests and rejects tags, partial IDs and whitespace', () => {
  for (const image of ['ghcr.io/example/fixture@sha256:'+'a'.repeat(64),
    'registry.example:5000/example/fixture:qualified@sha256:'+'0'.repeat(64)])
    assert.equal(validatePlayerUIIngress(playerUIIngress(image)).runtime_image,image);
  for (const image of [undefined,null,42,'', 'fixture:latest','sha256:'+ 'a'.repeat(63),
    'sha256:'+'a'.repeat(65),'sha256:'+'A'.repeat(64),'sha512:'+'a'.repeat(64),
    'sha256:'+'g'.repeat(64),' '+ 'sha256:'+'a'.repeat(64),
    'sha256:'+'a'.repeat(64)+' ', 'sha256:'+'a'.repeat(64)+'\n',
    'sha256:'+'a'.repeat(64)+'\r\n','fixture@sha256:'+'a'.repeat(63),
    'fixture@sha256:'+'a'.repeat(64)+'\n','fixture@sha256:'+'a'.repeat(64)+'/extra']) {
    const value=playerUIIngress();value.runtime_image=image;
    assert.throws(()=>validatePlayerUIIngress(value));
  }
  for(const change of [x=>{x.source_contract.current_database_contract_ready=false;},
    x=>{x.source_contract.exclusions=['public'];}, x=>{x.control_sha='tag';},
    x=>{x.schema_catalogue_digest='wrong';},x=>{x.engine_sha='tag';},x=>{x.web_sha='tag';},
    x=>{x.cohorts.pop();},x=>{x.cohorts[1].tournament_id=x.cohorts[0].tournament_id;},
    x=>{x.cohorts[0].users[0].session.user.id=id(999);},x=>{x.cohorts[0].rebuy_cost=0;}]) {
    const value=playerUIIngress();change(value);assert.throws(()=>validatePlayerUIIngress(value));
  }
});
test('existing connected and admitted callers retain exact runtime-image argument and result binding', async () => {
  const suite=await readFile(new URL('../../native/tournament-player-ui-suite.mjs',import.meta.url),'utf8');
  const connected=await readFile(new URL('../../native/observe-connected-ui.py',import.meta.url),'utf8');
  const owner=await readFile(new URL('../../native/qualify-components.py',import.meta.url),'utf8');
  assert.ok(suite.includes('runtime_image: runtimeImage,'));
  assert.ok(suite.includes('runtimeImage: process.argv[3],'));
  assert.ok(connected.includes('controls=repo, runtime_image=runtime_image,'));
  assert.ok(owner.includes('str(index), runtime_image], timeout='));
  assert.ok(owner.includes("result.get('runtime_image') == runtime_image"));
  assert.ok(owner.includes("require(re.fullmatch(r'[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}', runtime_image))"));
});
function preaction(choice = 'call_amount') {
  return {
    choice,
    tableId: id(1),
    userId: id(2),
    handNumber: 7,
    clickAt: 100,
    request: {
      method: 'POST',
      pathname: '/preaction',
      body: { tableId: id(1), action: choice === 'call_any' ? 'auto_call_any' : 'auto_call' },
      at: 101,
    },
    response: { status: 200, body: { success: true, armedToCall: 4 } },
    armed: {
      kind: 'pre_action',
      action: choice === 'call_any' ? 'auto_call_any' : 'auto_call',
      hand_number: 7,
      to_call_at_set: 4,
    },
    calls: [
      {
        tableId: id(1),
        user_id: id(2),
        hand_number: 7,
        action: 'call',
        receivedAt: 102,
        amount: 4,
      },
    ],
    directActions: [],
  };
}
test('preaction needs actual accepted same-hand same-player call and never direct input', () => {
  for (const choice of ['call_any', 'call_amount'])
    assert.equal(verifyPreActionUI(preaction(choice)).amount, 4);
  for (const mutate of [
    (x) => (x.calls = []),
    (x) => x.calls.push({ ...x.calls[0] }),
    (x) => x.calls[0].hand_number++,
    (x) => (x.calls[0].user_id = id(8)),
    (x) => (x.calls[0].replayed = true),
    (x) => x.directActions.push({}),
    (x) => (x.calls[0].amount = 5),
    (x) => (x.response.body.success = false),
  ]) {
    const value = preaction();
    mutate(value);
    assert.throws(() => verifyPreActionUI(value));
  }
});
function rebuy() {
  return {
    tournamentId: id(3),
    userId: id(2),
    request: {
      method: 'POST',
      pathname: '/rest/v1/rpc/process_tournament_rebuy',
      body: {
        p_tournament_id: id(3),
        p_user_id: id(2),
        p_rebuy_type: 'rebuy',
        p_client_token: 'original-token',
        p_cost: 20,
      },
    },
    response: {
      status: 200,
      body: {
        success: true,
        atomic_tournament_chip_purchase: 'v1',
        seated: true,
        table_id: id(1),
        seat_number: 2,
      },
    },
    before: {
      tournamentId: id(3),
      userId: id(2),
      activeSeatCount: 0,
      stack: 0,
      playerChipCount: 0,
      wallet: 100,
      purchaseCount: 0,
    },
    after: {
      tournamentId: id(3),
      userId: id(2),
      activeSeatCount: 1,
      tableId: id(1),
      seatNumber: 2,
      stack: 10000,
      playerStatus: 'playing',
      wallet: 80,
      purchaseCount: 1,
      purchaseToken: 'original-token',
      purchaseCommitted: true,
    },
    observedTableId: id(1),
    observedSeatNumber: 2,
    manualSeatRequests: [],
  };
}
test('paid return requires exact debit, original committed receipt and one automatic chair', () => {
  assert.equal(verifyPaidRebuyReturn(rebuy()).cost, 20);
  for (const mutate of [
    (x) => (x.after.wallet = 79),
    (x) => (x.after.purchaseCount = 2),
    (x) => (x.after.purchaseToken = 'another-token'),
    (x) => (x.after.purchaseCommitted = false),
    (x) => (x.after.activeSeatCount = 2),
    (x) => (x.after.tableId = id(9)),
    (x) => (x.before.stack = 1),
    (x) => (x.before.playerChipCount = 1),
    (x) => x.manualSeatRequests.push({}),
    (x) => (x.after.userId = id(8)),
  ]) {
    const value = rebuy();
    mutate(value);
    assert.throws(() => verifyPaidRebuyReturn(value));
  }
  const retainedZeroSeat = rebuy();
  retainedZeroSeat.before.activeSeatCount = 1;
  assert.equal(verifyPaidRebuyReturn(retainedZeroSeat).cost, 20);
});
test('all three persisted reports and supported MTT rebuy are required', () => {
  const rows = [1, 2, 3].map((n) => ({
    user_id: id(n),
    position: n,
    prize: n === 1 ? 54 : 0,
    bounty_winnings: 0,
  }));
  const input = {
    tournamentId: id(4),
    endedAt: '2026-10-31T15:00:00Z',
    status: 'COMPLETED',
    beforeReload: rows,
    afterReload: structuredClone(rows),
    visibleUserIds: rows.map((r) => r.user_id),
    reportTournamentId: id(4),
  };
  assert.equal(verifyFinishReport(input).players, 3);
  input.afterReload[0].prize = 53;
  assert.throws(() => verifyFinishReport(input));
  const cohorts = ['MTT', 'SPIN', 'SNG'].map((format) => ({
    format,
    flows: Object.fromEntries(requiredPlayerUIFlows(format).map((f) => [f, { verified: true }])),
  }));
  assert.equal(requireCompletePlayerUICoverage(cohorts).product_certificate, false);
  delete cohorts[1].flows.finish_report;
  assert.throws(() => requireCompletePlayerUICoverage(cohorts));
});
test('native request cannot select arbitrary IDs, SQL, users or out-of-range cohorts', () => {
  assert.equal(
    validateTournamentRead({ cohort_index: 0, actor_index: 2, token: null }).actor_index,
    2
  );
  for (const value of [
    { cohort_index: 3, actor_index: 0, token: null },
    { cohort_index: 0, actor_index: 9, token: null },
    { cohort_index: 0, actor_index: 0, token: null, sql: 'select 1' },
    { cohort_index: 0, actor_index: 0, token: "x'; select 1; --" },
  ])
    assert.throws(() => validateTournamentRead(value));
  const cohorts = ['MTT', 'SPIN', 'SNG'].map((format, i) => ({
    format,
    tournament_id: id(10 + i),
    club_id: id(20),
    actor_ids: [id(1), id(2), id(3)],
  }));
  assert.equal(tournamentObservationBinding(cohorts).length, 3);
  cohorts[1].tournament_id = cohorts[0].tournament_id;
  assert.throws(() => tournamentObservationBinding(cohorts));
});

test('wire collector cannot reuse an old arm across socket generations or archive private cards', () => {
  const page = new EventEmitter(),
    socket = new EventEmitter();
  socket.url = () => 'wss://engine.smarter.poker/ws/multi?v=0';
  const wire = collectPlayerUIWire(page, id(2));
  page.emit('websocket', socket);
  const emit = (message) =>
    socket.emit('framereceived', { payload: JSON.stringify({ tableId: id(1), ...message }) });
  const snapshot = { type: 'SNAPSHOT', seq: 1, state: { hand_number: 7, players: [] } };
  const key = { tableId: id(1), userId: id(2), handNumber: 7, since: Date.now() };
  emit(snapshot);
  emit({ type: 'USER_EVENT', payload: { kind: 'hole_cards', cards: ['Ah', 'As'] } });
  assert.equal(wire.readArm(wire, key), undefined);
  emit({
    type: 'USER_EVENT',
    payload: {
      kind: 'pre_action',
      action: 'auto_call',
      hand_number: 7,
      to_call_at_set: 4,
      cards: ['Ah', 'As'],
    },
  });
  assert.equal(wire.readArm(wire, key).to_call_at_set, 4);
  assert.equal('cards' in wire.readArm(wire, key), false);
  emit({
    type: 'EVENT',
    payload: {
      type: 'player_action',
      hand_number: 7,
      user_id: id(2),
      seat: 2,
      action: 'raise',
      amount: 6,
      stage: 'preflop',
      cards: ['private-canary'],
      deck: 'private-canary',
    },
  });
  const publicAction = wire.readActions({ tableId: id(1), handNumber: 7 })[0];
  assert.equal(publicAction.action, 'raise');
  assert.equal(publicAction.seat, 2);
  assert.equal(publicAction.stage, 'preflop');
  assert.equal('cards' in publicAction, false);
  assert.equal('deck' in publicAction, false);
  socket.emit('close');
  emit(snapshot);
  assert.deepEqual(wire.readActions({ tableId: id(1), handNumber: 7 }), []);
  assert.equal(wire.readArm(wire, key), undefined);
  wire.close();
  assert.equal(page.listenerCount('websocket'), 0);
  assert.equal(socket.listenerCount('framereceived'), 0);
});

test('gapped dealer state fails the same wire generation without accepting a later arm', () => {
  const page = new EventEmitter(),
    socket = new EventEmitter();
  socket.url = () => 'wss://engine.smarter.poker/ws/multi?v=0';
  const wire = collectPlayerUIWire(page, id(2));
  page.emit('websocket', socket);
  const emit = (message) =>
    socket.emit('framereceived', { payload: JSON.stringify({ tableId: id(1), ...message }) });
  emit({ type: 'SNAPSHOT', seq: 1, state: { hand_number: 7, players: [] } });
  emit({ type: 'DELTA', prev: 0, seq: 3, patch: [] });
  assert.throws(() => wire.state(id(1)), /PLAYER_UI_WIRE_REFUSED/);
  wire.close();
});

// The action oracle rejects plausible-looking wire/DB tuples unless they bind
// all four real browser intents, their original turns and player-origin history.
import { verifyBrowserActionHistory } from '../../native/component-observation-protocol.mjs';
function browserActionEvidence() {
  const ids = ['a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'];
  const actions = ['raise', 'call', 'all_in', 'fold'].map((action, i) => ({
    action,
    table_id: 'c1000000-0000-4000-8000-000000000001',
    user_id: ids[[0, 1, 1, 0][i]],
    seat: [1, 2, 2, 1][i],
    hand_number: 42,
    street: i < 2 ? 'preflop' : 'flop',
    amount: [6, 4, 194, 0][i],
    before_stack: [199, 198, 194, 194][i],
    before_bet: [1, 2, 0, 0][i],
    before_current_bet: [2, 6, 0, 194][i],
    status: 200,
    success: true,
    requests: 1,
    idempotency_key: 'key-' + i,
    action_context: 'original-turn-' + i,
  }));
  const public_actions = actions.map((a, i) => ({
    ordinal: i + 3,
    user_id: a.user_id,
    seat: a.seat,
    action: a.action,
    amount: a.amount,
    street: a.street,
    origin: 'player',
  }));
  return {
    tableId: 'c1000000-0000-4000-8000-000000000001',
    hand: { hand_number: 42, next_hand_number: 43 },
    actions,
    facts: {
      count: 1,
      seat_count: 0,
      rows: [
        {
          hand_number: 42,
          pot_size: '12',
          rake_amount: '0',
          action_count: 7,
          player_count: 2,
          public_actions,
        },
      ],
    },
    events: actions.map((a) => ({
      type: 'player_action',
      table_id: 'c1000000-0000-4000-8000-000000000001',
      hand_number: 42,
      user_id: a.user_id,
      seat: a.seat,
      action: a.action,
      amount: a.amount,
      stage: a.street,
      replayed: false,
    })),
  };
}
test('four browser intents match their same owned saved hand with raise-TO and full remaining all-in', () => {
  const value = browserActionEvidence();
  assert.deepEqual(verifyBrowserActionHistory(value), {
    table_id: value.tableId,
    hand_number: 42,
    accepted_http_count: 4,
    wire_event_count: 4,
    history_count: 1,
    actions: value.facts.rows[0].public_actions,
  });
});
test('browser action acceptance refuses missing/duplicate/refused/replayed/forced/private/wrong-hand evidence', () => {
  const changes = [
    (x) => (x.actions[2].action = 'call'),
    (x) => (x.actions[0].requests = 2),
    (x) => (x.actions[0].status = 400),
    (x) => (x.actions[0].success = false),
    (x) => (x.actions[0].action_context = ''),
    (x) => (x.actions[1].idempotency_key = x.actions[0].idempotency_key),
    (x) => (x.actions[0].hand_number = 41),
    (x) => (x.actions[0].table_id = 'd1000000-0000-4000-8000-000000000001'),
    (x) => (x.events[0].table_id = 'd1000000-0000-4000-8000-000000000001'),
    (x) => (x.actions[1].action_context = x.actions[0].action_context),
    (x) => (x.events[0].replayed = true),
    (x) => x.events.push({ ...x.events[0] }),
    (x) => x.events.shift(),
    (x) => x.events.reverse(),
    (x) => (x.facts.rows[0].public_actions[3].origin = 'forced'),
    (x) => (x.facts.rows[0].public_actions[3].origin = 'pre_action'),
    (x) => (x.facts.rows[0].public_actions[0].cards = ['private-canary']),
    (x) => (x.facts.rows[0].public_actions[0].street = 'flop'),
    (x) => (x.facts.rows[0].public_actions[0].user_id = x.actions[1].user_id),
    (x) => (x.facts.rows[0].public_actions[0].amount = 5),
    (x) => {
      x.actions[2].amount = 100;
      x.events[2].amount = 100;
      x.facts.rows[0].public_actions[2].amount = 100;
    },
    (x) => {
      x.actions[1].amount = 6;
      x.events[1].amount = 6;
      x.facts.rows[0].public_actions[1].amount = 6;
    },
    (x) => x.facts.rows[0].public_actions.push({ ...x.facts.rows[0].public_actions[3] }),
    (x) => (x.facts.count = 2),
    (x) => (x.facts.seat_count = 1),
  ];
  for (const change of changes) {
    const value = browserActionEvidence();
    change(value);
    assert.throws(() => verifyBrowserActionHistory(value));
  }
});
