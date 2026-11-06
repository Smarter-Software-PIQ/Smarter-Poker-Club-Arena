import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { useEffect, useRef, useState } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cashSeatOfferKey, liveCashSeatOffer } from '../../src/components/common/waitlistSeatOffer';
const source = readFileSync('src/pages/TablePage.tsx', 'utf8');
const ast = ts.createSourceFile(
  'TablePage.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const declaration = source.indexOf('const autoBuyInFiredRef = useRef(false);');
let effect: ts.Block | undefined;
const visit = (node: ts.Node) => {
  if (
    !effect &&
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === 'useEffect' &&
    node.getStart(ast) > declaration &&
    ts.isArrowFunction(node.arguments[0]) &&
    ts.isBlock(node.arguments[0].body) &&
    node.arguments[0].body.getText(ast).includes('let wantsBuyIn = openBuyInOnArrival')
  ) {
    effect = node.arguments[0].body;
  }
  ts.forEachChild(node, visit);
};
visit(ast);
if (!effect) throw new Error('The Accepted-Chair Effect Was Not Found');
const body = ts.transpile(
  effect.statements.map((statement) => statement.getFullText(ast)).join('\n'),
  {
    target: ts.ScriptTarget.ES2022,
  }
);
// Run the maintained refs AND effects under React too: a correct body is
// insufficient if a same-table route arrival never triggers its dependencies.
const mountedBody = ts.transpile(
  source.slice(
    source.indexOf('const [acceptedChair, setAcceptedChair] = useState(0);'),
    effect.parent.parent.parent.end
  ),
  { target: ts.ScriptTarget.ES2022 }
);
function fixture(overrides: Record<string, unknown> = {}) {
  const d = {
    autoBuyInFiredRef: { current: false },
    consumedSeatOffersRef: { current: new Set<string>() },
    cashSeatOfferKey,
    liveCashSeatOffer,
    leftSeatPendingRef: { current: false },
    openBuyInOnArrival: true,
    acceptedChair: 0,
    cashAdmissionPending: false,
    location: { pathname: '/table/destination', search: '' },
    window: { location: { search: '' } },
    tableId: 'destination',
    tableState: { arenaAsset: 'chips', players: [null, null, null], heroSeat: 0 },
    engineSnapshot: { table_id: 'destination', players: [{ seat: 1, user_id: 'other' }] },
    heroSeatRef: { current: 0 },
    userId: 'viewer',
    handleSeatClick: vi.fn(),
    setShowMustMoveLobby: vi.fn(),
    ...overrides,
  };
  return { d, run: () => new Function(...Object.keys(d), body)(...Object.values(d)) };
}
describe('an accepted waiting-list chair opens the destination buy-in', () => {
  it('keeps an offer unconsumed while the earlier admission reply is in flight', () => {
    const f = fixture({
      cashAdmissionPending: true,
      location: {
        pathname: '/table/destination',
        search: '?buyin=1',
        state: {
          cashSeatOffer: {
            id: 'offer-during-admission',
            tableId: 'destination',
            userId: 'viewer',
            notifiedAt: new Date().toISOString(),
            holdExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      },
    });
    f.run();
    expect(f.d.handleSeatClick).not.toHaveBeenCalled();
    expect(f.d.consumedSeatOffersRef.current.size).toBe(0);
    f.d.cashAdmissionPending = false;
    f.run();
    expect(f.d.handleSeatClick).toHaveBeenCalledExactlyOnceWith(2);
    expect(source.slice(effect!.end, effect!.parent.parent.parent.end)).toContain(
      'cashAdmissionPending'
    );
  });
  it('reacts to a same-table offer while the roster, funding and first-arrival props stay unchanged', () => {
    const f = fixture();
    const { autoBuyInFiredRef, consumedSeatOffersRef, acceptedChair, ...context } = f.d;
    const run = new Function(
      'useEffect',
      'useRef',
      'useState',
      ...Object.keys(context),
      mountedBody
    );
    const mounted = renderHook(
      ({ location }) =>
        run(useEffect, useRef, useState, ...Object.values({ ...context, location })),
      { initialProps: { location: context.location as any } }
    );
    try {
      // The initial request has already run (its admission may be waitlisted).
      expect(context.handleSeatClick).toHaveBeenCalledTimes(1);
      const offer = {
        id: 'committed-offer',
        tableId: 'destination',
        userId: 'viewer',
        notifiedAt: new Date().toISOString(),
        holdExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      mounted.rerender({ location: { ...context.location, state: { cashSeatOffer: offer } } });
      expect(context.handleSeatClick).toHaveBeenCalledTimes(2);
      mounted.rerender({
        location: {
          ...context.location,
          state: {
            cashSeatOffer: {
              ...offer,
              holdExpiresAt: new Date(Date.now() + 120_000).toISOString(),
            },
          },
        },
      });
      expect(context.handleSeatClick).toHaveBeenCalledTimes(2);
      mounted.rerender({
        location: {
          ...context.location,
          state: {
            cashSeatOffer: {
              ...offer,
              id: 'later-reservation',
            },
          },
        },
      });
      expect(context.handleSeatClick).toHaveBeenCalledTimes(3);
    } finally {
      mounted.unmount();
    }
  });
  it('opens a later reservation after the mounted table already spent its first arrival', () => {
    const f = fixture({
      autoBuyInFiredRef: { current: true },
      leftSeatPendingRef: { current: true },
      openBuyInOnArrival: false,
      location: {
        pathname: '/table/destination',
        search: '?buyin=1',
        state: {
          cashSeatOffer: {
            id: 'offer-one',
            tableId: 'destination',
            userId: 'viewer',
            notifiedAt: new Date().toISOString(),
            holdExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      },
    });
    f.run();
    expect(f.d.handleSeatClick).toHaveBeenCalledExactlyOnceWith(2);
    expect(f.d.setShowMustMoveLobby).toHaveBeenCalledExactlyOnceWith(false);
    f.run();
    expect(f.d.handleSeatClick).toHaveBeenCalledTimes(1);
  });
  it.each(['expired', 'wrong-user', 'wrong-table', 'invalid-deadline'])(
    'does not open a %s offer through the retained query string',
    (reason) => {
      const offer = {
        id: 'offer-one',
        tableId: reason === 'wrong-table' ? 'another' : 'destination',
        userId: reason === 'wrong-user' ? 'another' : 'viewer',
        notifiedAt: new Date().toISOString(),
        holdExpiresAt:
          reason === 'invalid-deadline'
            ? 'invalid'
            : new Date(Date.now() + (reason === 'expired' ? -1000 : 60_000)).toISOString(),
      };
      const f = fixture({
        openBuyInOnArrival: false,
        location: {
          pathname: '/table/destination',
          search: '?buyin=1',
          state: { cashSeatOffer: offer },
        },
      });
      f.run();
      expect(f.d.handleSeatClick).not.toHaveBeenCalled();
    }
  );
  it('does not consume an offer until the table is ready, or revive it after expiry', () => {
    const f = fixture({
      openBuyInOnArrival: false,
      engineSnapshot: null,
      location: {
        pathname: '/table/destination',
        search: '?buyin=1',
        state: {
          cashSeatOffer: {
            id: 'offer-one',
            tableId: 'destination',
            userId: 'viewer',
            notifiedAt: new Date().toISOString(),
            holdExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      },
    });
    f.run();
    expect(f.d.consumedSeatOffersRef.current.size).toBe(0);
    (f.d as any).location.state.cashSeatOffer.holdExpiresAt = new Date(
      Date.now() - 1000
    ).toISOString();
    (f.d as any).engineSnapshot = { table_id: 'destination', players: [] };
    f.run();
    expect(f.d.handleSeatClick).not.toHaveBeenCalled();
  });
  it('carries explicit acceptance without relying on the global URL', () => {
    const f = fixture();
    f.run();
    expect(f.d.handleSeatClick).toHaveBeenCalledExactlyOnceWith(2);
    f.run();
    expect(f.d.handleSeatClick).toHaveBeenCalledTimes(1);
  });
  it('waits for the destination snapshot and never selects an occupied bootstrap chair', () => {
    const f = fixture({ engineSnapshot: null });
    f.run();
    expect(f.d.handleSeatClick).not.toHaveBeenCalled();
    expect(f.d.autoBuyInFiredRef.current).toBe(false);
    (f.d as any).engineSnapshot = { table_id: 'destination', players: [{ seat: 1 }, { seat: 2 }] };
    f.run();
    expect(f.d.handleSeatClick).toHaveBeenCalledExactlyOnceWith(3);
  });
  it('waits for a live vacancy instead of consuming acceptance on a full opening snapshot', () => {
    const f = fixture({
      engineSnapshot: { table_id: 'destination', players: [{ seat: 1 }, { seat: 2 }, { seat: 3 }] },
    });
    f.run();
    expect(f.d.autoBuyInFiredRef.current).toBe(false);
    (f.d as any).engineSnapshot = { table_id: 'destination', players: [{ seat: 1 }] };
    f.run();
    expect(f.d.handleSeatClick).toHaveBeenCalledExactlyOnceWith(2);
  });
  it('never reopens a departed seat from a retained buy-in query', () => {
    const f = fixture({
      leftSeatPendingRef: { current: true },
      openBuyInOnArrival: true,
      window: { location: { search: '?buyin=1' } },
    });
    f.run();
    f.run();
    expect(f.d.handleSeatClick).not.toHaveBeenCalled();
    expect(f.d.autoBuyInFiredRef.current).toBe(false);
  });
  it("does not spend another mounted table's buy-in query", () => {
    const f = fixture({
      openBuyInOnArrival: false,
      location: { pathname: '/table/another' },
      window: { location: { search: '?buyin=1' } },
    });
    f.run();
    expect(f.d.handleSeatClick).not.toHaveBeenCalled();
  });
});
