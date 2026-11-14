import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    removeChannel: vi.fn(),
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { useLightningAnchorHandoff } from '../../src/lightning/useLightningAnchorHandoff';
import {
  resetLightningRegistryForTests,
  setLightningEntryIntent,
} from '../../src/lightning/lightningSession';

const ANCHOR = '33333333-3333-4333-8333-333333333333';
const CLUSTER = '22222222-2222-4222-8222-222222222222';
const USER = '77777777-7777-4777-8777-777777777777';
const POOL = '11111111-1111-4111-8111-111111111111';
const source = ts.createSourceFile(
  'TablePage.tsx',
  readFileSync('src/pages/TablePage.tsx', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let fundingSource = '',
  inputSource = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node)) {
    if (
      node.expression.getText(source) === 'setLightningAnchorFunding' &&
      node.arguments[0].getText(source).includes('existingSeats')
    )
      fundingSource = node.arguments[0].getText(source);
    if (node.expression.getText(source) === 'useLightningAnchorHandoff')
      inputSource = node.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
function evaluate(expression: string, values: Record<string, unknown>) {
  const script =
    ts.transpile(`const result = ${expression};`, { target: ts.ScriptTarget.ES2022 }) +
    '\nreturn result;';
  return new Function(...Object.keys(values), script)(...Object.values(values));
}
function consumer(
  rows: unknown[],
  embedded = false,
  fundingOwner = USER,
  observer = false,
  legacyFunded = false,
  departed = false,
  lightningCapableClusterId: string | null = CLUSTER
) {
  const navigate = vi.fn(),
    onTableInfoUpdate = vi.fn();
  const funding = fundingSource
    ? evaluate(fundingSource, { table: { id: ANCHOR }, userId: fundingOwner, existingSeats: rows })
    : undefined;
  const input = evaluate(inputSource, {
    tableId: ANCHOR,
    userId: USER,
    tableState: { clusterId: CLUSTER, heroSeat: 3, players: Array(6).fill(null) },
    lightningCapableClusterId,
    lightningRoom: null,
    lightningHero: null,
    lightningObserver: observer,
    lightningAnchorFunded: legacyFunded,
    lightningAnchorFunding: funding,
    tableGameLightningState: undefined,
    leftSeatPendingRef: { current: departed },
    embeddedTableId: embedded ? ANCHOR : undefined,
    navigate,
    onTableInfoUpdate,
  });
  return { input, navigate, onTableInfoUpdate };
}
beforeEach(() => {
  sessionStorage.clear();
  resetLightningRegistryForTests();
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      pool_session_id: POOL,
      state: 'active',
      cluster_mode: 'lightning',
      anchor_table_id: ANCHOR,
      stack: 200,
    },
    error: null,
  });
});
afterEach(cleanup);

/* Dan 2026-11-14: "I FOLDED AND WAS MOVED TO THE NEXT HAND... BUT THEN I
   WASN'T DEALT IN, IT WAS LIKE I WAS 'OBSERVING'". This test used to pin the
   opposite: the converted seat waited for a View Game tap whose notice the
   footer chain hid, while the pool dealt the seat and its clock ran out. The
   tab follows the chair now, in place, exactly once. */
it.each([false, true])(
  'a funded anchor with no public hero follows its own room at once, exactly once (embedded=%s)',
  async (embedded) => {
    const c = consumer([{ user_id: USER, stack: '200', leave_pending: false }], embedded);
    expect(c.input.heroBoughtIn).toBe(false); // The frozen public roster never seats this viewer.
    const { result } = renderHook(() => useLightningAnchorHandoff(c.input));
    await act(async () => {});
    expect(result.current.readyPoolSessionId).toBe(POOL);
    if (embedded) {
      expect(c.onTableInfoUpdate).toHaveBeenCalledTimes(1);
      expect(c.onTableInfoUpdate).toHaveBeenCalledWith({ movedToTableId: POOL });
      expect(c.navigate).not.toHaveBeenCalled();
    } else {
      expect(c.navigate).toHaveBeenCalledTimes(1);
      expect(c.navigate).toHaveBeenCalledWith(`/table/${POOL}`, { replace: true });
      expect(c.onTableInfoUpdate).not.toHaveBeenCalled();
    }
    // A repeated read of the same open room never re-points the tab again.
    await act(async () => {
      result.current.recheck();
    });
    expect(embedded ? c.onTableInfoUpdate : c.navigate).toHaveBeenCalledTimes(1);
  }
);

it.each(
  [
    [],
    [{ user_id: USER, stack: 200, leave_pending: true }],
    [{ user_id: USER, stack: 0, leave_pending: false }],
    [{ user_id: 'somebody-else', stack: 200, leave_pending: false }],
  ].map((rows) => ({ rows }))
)(
  'an empty, leaving, unfunded or other-player anchor does not offer a room (%j)',
  async ({ rows }) => {
    const c = consumer(rows);
    const { result } = renderHook(() => useLightningAnchorHandoff(c.input));
    await act(async () => {});
    expect(result.current.readyPoolSessionId).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(c.navigate).not.toHaveBeenCalled();
  }
);

it('does not reuse a funded record from another account', async () => {
  const c = consumer([{ user_id: 'previous-account', stack: 200 }], false, 'previous-account');
  const { result } = renderHook(() => useLightningAnchorHandoff(c.input));
  await act(async () => {});
  expect(result.current.readyPoolSessionId).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});

it('known empty anchor truth refuses conversion even if a stale public roster still calls the viewer a hero', async () => {
  const c = consumer([]);
  c.input.heroBoughtIn = true;
  const { result } = renderHook(() => useLightningAnchorHandoff(c.input));
  await act(async () => {});
  expect(result.current.readyPoolSessionId).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});

it('a locally confirmed departure overrides an earlier funded anchor lookup', async () => {
  const c = consumer([{ user_id: USER, stack: 200, leave_pending: false }]);
  const input = evaluate(inputSource, {
    tableId: ANCHOR,
    userId: USER,
    tableState: { clusterId: CLUSTER, heroSeat: 0 },
    lightningCapableClusterId: CLUSTER,
    lightningRoom: null,
    lightningHero: null,
    lightningObserver: false,
    lightningAnchorFunded: false,
    lightningAnchorFunding: { tableId: ANCHOR, userId: USER, funded: true },
    tableGameLightningState: undefined,
    leftSeatPendingRef: { current: true },
    embeddedTableId: undefined,
    navigate: c.navigate,
    onTableInfoUpdate: c.onTableInfoUpdate,
  });
  const { result } = renderHook(() => useLightningAnchorHandoff(input));
  await act(async () => {});
  expect(result.current.readyPoolSessionId).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});

it('a new observer-anchor purchase completes its original Join intent from scoped funding even before legacy roster restoration', async () => {
  setLightningEntryIntent(ANCHOR, CLUSTER);
  const c = consumer(
    [{ user_id: USER, stack: 200, leave_pending: false }],
    false,
    USER,
    true,
    false
  );
  renderHook(() => useLightningAnchorHandoff(c.input));
  await act(async () => {});
  expect(c.navigate).toHaveBeenCalledWith(`/table/${POOL}`, { replace: true });
});
it.each([
  { rows: [], departed: false },
  { rows: [{ user_id: USER, stack: 200, leave_pending: true }], departed: false },
  { rows: [{ user_id: USER, stack: 200, leave_pending: false }], departed: true },
])(
  'known negative/departed anchor truth cannot fulfill a Join intent from stale legacy funding (%j)',
  async ({ rows, departed }) => {
    setLightningEntryIntent(ANCHOR, CLUSTER);
    const c = consumer(rows, false, USER, true, true, departed);
    renderHook(() => useLightningAnchorHandoff(c.input));
    await act(async () => {});
    expect(c.navigate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  }
);

it('an observer never reuses a previous account record even while the legacy flag remains true', async () => {
  setLightningEntryIntent(ANCHOR, CLUSTER);
  const c = consumer(
    [{ user_id: 'previous-account', stack: 200 }],
    false,
    'previous-account',
    true,
    true
  );
  renderHook(() => useLightningAnchorHandoff(c.input));
  await act(async () => {});
  expect(c.navigate).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

/* Dan 2026-10-24: "NO PART OF THE LIGHTNING GAMES OR FUNCTIONALITY SHOULD BE
   TOUCHING THE CLASSIC GAMES." A funded seat at a Classic game is never
   watched for a Lightning conversion: no session read, no realtime channel,
   no room offered. */
it('a funded seat at a Classic game is never watched for a Lightning conversion', async () => {
  const c = consumer(
    [{ user_id: USER, stack: '200', leave_pending: false }],
    false,
    USER,
    false,
    false,
    false,
    null
  );
  expect(c.input.clusterId).toBeNull();
  const { result } = renderHook(() => useLightningAnchorHandoff(c.input));
  await act(async () => {});
  expect(rpc).not.toHaveBeenCalled();
  expect(result.current.readyPoolSessionId).toBeNull();
  expect(result.current.joining).toBe(false);
});

it('the original Join intent follows scoped durable funding before any observer or public hero snapshot', async () => {
  setLightningEntryIntent(ANCHOR, CLUSTER);
  const c = consumer([{ user_id: USER, stack: 200, leave_pending: false }]);
  expect(c.input.heroBoughtIn).toBe(false);
  renderHook(() => useLightningAnchorHandoff(c.input));
  await act(async () => {});
  expect(c.navigate).toHaveBeenCalledWith(`/table/${POOL}`, { replace: true });
});

it('a Join intent never follows a session whose durable anchor is another table', async () => {
  setLightningEntryIntent(ANCHOR, CLUSTER);
  rpc.mockResolvedValue({
    data: { pool_session_id: POOL, state: 'active', anchor_table_id: POOL },
    error: null,
  });
  const c = consumer([{ user_id: USER, stack: 200, leave_pending: false }]);
  renderHook(() => useLightningAnchorHandoff(c.input));
  await act(async () => {});
  expect(c.navigate).not.toHaveBeenCalled();
});
