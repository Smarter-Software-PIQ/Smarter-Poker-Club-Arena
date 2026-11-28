/**
 * UNION DATA IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch U1, 2026-11-28)
 *
 * /unions/:unionId/data moves its head from the page bar's lit words to the
 * arena workspace (the Club Data layout). The condition: no printed figure,
 * word, data hook, named region or control state may change. The rake
 * snapshot panel below the head is the shared RakeSnapshotPanel, which this
 * pass does not touch; it is stood in by a marker that records what the page
 * hands it. Pinned in every state: the union and its club count read, both
 * reads refused, both still checking, and no union in the route. The page
 * head is left out of the reading: it is the one part the pass replaces. The
 * snapshots were recorded against the old page on main 65a64d1f6 and are
 * unchanged by the pass.
 */
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const fixture = vi.hoisted(() => ({
  unionId: 'union-1' as string | undefined,
  canOperate: true,
  name: vi.fn(),
  count: vi.fn(),
}));

vi.mock('../../src/hooks/useUnionRouteId', () => ({
  useUnionRouteId: () => ({
    unionId: fixture.unionId,
    unionRef: 'midway-union',
    resolutionStatus: fixture.unionId ? 'ready' : 'not_found',
    retryResolution: () => {},
  }),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'owner-a' } }),
}));
vi.mock('../../src/hooks/useCanCreateUnion', () => ({
  useCanOperateUnionNetwork: () => ({ canOperateUnionNetwork: fixture.canOperate }),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/club/RakeSnapshotPanel', () => ({
  default: (props: { unionId: string | null; clubId: string | null; scopes: string[] }) => (
    <div
      data-panel="rake-snapshot"
      data-union={props.unionId ?? ''}
      data-club={props.clubId ?? ''}
      data-scopes={props.scopes.join(',')}
    />
  ),
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: () => (table === 'union_clubs' ? fixture.count() : q),
        maybeSingle: () => fixture.name(),
      };
      return q;
    },
  },
}));

import UnionDataPage from '../../src/pages/UnionDataPage';

function mount() {
  return render(
    <MemoryRouter>
      <UnionDataPage />
    </MemoryRouter>
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

function pin(container: HTMLElement) {
  return surfacePin(container.firstElementChild as HTMLElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.unionId = 'union-1';
  fixture.canOperate = true;
  fixture.name.mockResolvedValue({ data: { name: 'midway union' }, error: null });
  fixture.count.mockResolvedValue({ count: 12, error: null });
});

afterEach(() => {
  cleanup();
});

describe('Union Data prints the same figures, words and controls', () => {
  it('read', async () => {
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Statements|",
          "button|button|Union|",
        ],
        "money": {
          "figures": [
            "12",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=default",
            "data-panel=rake-snapshot",
            "data-union=union-1",
            "data-club=",
            "data-scopes=union",
          ],
        },
        "regions": [
          "dl||Union Data Live Summary",
        ],
        "text": "Union | Midway Union | Clubs | 12",
      }
    `);
  });

  it('refused', async () => {
    fixture.name.mockResolvedValue({ data: null, error: { message: 'refused' } });
    fixture.count.mockResolvedValue({ count: null, error: { message: 'refused' } });
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Statements|",
          "button|button|Union|",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-tone=default",
            "data-tone=default",
            "data-panel=rake-snapshot",
            "data-union=union-1",
            "data-club=",
            "data-scopes=union",
          ],
        },
        "regions": [
          "dl||Union Data Live Summary",
        ],
        "text": "Union | Unavailable | Clubs | Unavailable",
      }
    `);
  });

  it('checking', async () => {
    fixture.name.mockReturnValue(new Promise(() => {}));
    fixture.count.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Statements|",
          "button|button|Union|",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-tone=default",
            "data-tone=default",
            "data-panel=rake-snapshot",
            "data-union=union-1",
            "data-club=",
            "data-scopes=union",
          ],
        },
        "regions": [
          "dl||Union Data Live Summary",
        ],
        "text": "Union | Checking | Clubs | Checking",
      }
    `);
  });

  it('no union, for a union operator', async () => {
    fixture.unionId = undefined;
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Return To Unions|",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-tone=default",
          ],
        },
        "regions": [
          "span|status|",
        ],
        "text": "No Union",
      }
    `);
  });

  it('no union, for everybody else', async () => {
    fixture.unionId = undefined;
    fixture.canOperate = false;
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Return To Community|",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-tone=default",
          ],
        },
        "regions": [
          "span|status|",
        ],
        "text": "No Union",
      }
    `);
  });
});
