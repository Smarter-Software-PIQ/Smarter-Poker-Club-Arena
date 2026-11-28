/**
 * FORGE A UNION IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch U1, 2026-11-28)
 *
 * /unions/create moves from its own gradient dress to the arena workspace. The
 * condition: no printed figure, word, data hook, named region or control state
 * may change. This renders the real page with synthetic reads and pins all
 * five (tests/helpers/surfacePin.ts) in every state the page shows: checking
 * club ownership, the create-a-club-first refusal, each of the three steps, a
 * refused step, a failed creation and a creation in flight. The page head is
 * left out of the reading: it is the one part the pass replaces. The snapshots
 * were recorded against the old page on main 65a64d1f6 and are unchanged by
 * the pass.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const fixture = vi.hoisted(() => ({
  count: vi.fn(),
  createUnion: vi.fn(),
  toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} },
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => fixture.count() }) }),
  },
}));
vi.mock('../../src/services/UnionApiService', () => ({
  unionApi: { createUnion: fixture.createUnion },
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'owner-a' } }),
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => fixture.toast,
  useOptionalToast: () => null,
}));
vi.mock('../../src/core/MasterBus', () => ({ masterBus: { emit: vi.fn() } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import CreateUnionPage from '../../src/pages/CreateUnionPage';

function mount() {
  return render(
    <MemoryRouter>
      <CreateUnionPage />
    </MemoryRouter>
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
}

function pin(container: HTMLElement) {
  return surfacePin(container.firstElementChild as HTMLElement);
}

async function press(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
  await flush();
}

async function named() {
  fireEvent.change(screen.getByPlaceholderText('Enter Union Name...'), {
    target: { value: 'Midway Union' },
  });
  fireEvent.change(screen.getByPlaceholderText('Describe Your Union...'), {
    target: { value: 'Every Midway Club Under One Network.' },
  });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fixture.count.mockResolvedValue({ count: 2 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Forge A Union prints the same figures, words and controls', () => {
  it('checking club ownership', async () => {
    fixture.count.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button||Next →|",
          "input|checkbox||checked,value=on",
          "input|text||value=",
          "textarea|||value=",
        ],
        "money": {
          "figures": [
            "1 / 3",
            "1",
            "2",
            "3",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=attention",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "dl||Forge A Union Live Summary",
        ],
        "text": "SECURE | Step | 1 / 3 | Club Authority | Checking | 1 | Basics | 2 | Revenue | 3 | Review | Union Basics | Create A Network Of Clubs With Shared Resources. | Union Name * | Description | Public Union | Other Clubs Can Discover And Request To Join",
      }
    `);
  });

  it('owns no club', async () => {
    fixture.count.mockResolvedValue({ count: 0 });
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button||Create Your First Club|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Create A Club First | You Need To Own At Least One Club Before You Can Create A Union.",
      }
    `);
  });

  it('step one', async () => {
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button||Next →|",
          "input|checkbox||checked,value=on",
          "input|text||value=",
          "textarea|||value=",
        ],
        "money": {
          "figures": [
            "1 / 3",
            "1",
            "2",
            "3",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=attention",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "dl||Forge A Union Live Summary",
        ],
        "text": "SECURE | Step | 1 / 3 | Club Authority | Verified | 1 | Basics | 2 | Revenue | 3 | Review | Union Basics | Create A Network Of Clubs With Shared Resources. | Union Name * | Description | Public Union | Other Clubs Can Discover And Request To Join",
      }
    `);
  });

  it('step one refused', async () => {
    const { container } = mount();
    await flush();
    await press(/Next/);
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button||Next →|",
          "input|checkbox||checked,value=on",
          "input|text||value=",
          "textarea|||value=",
        ],
        "money": {
          "figures": [
            "1 / 3",
            "1",
            "2",
            "3",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=attention",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "dl||Forge A Union Live Summary",
        ],
        "text": "SECURE | Step | 1 / 3 | Club Authority | Verified | 1 | Basics | 2 | Revenue | 3 | Review | Union Basics | Create A Network Of Clubs With Shared Resources. | Union Name * | Description | Public Union | Other Clubs Can Discover And Request To Join | Union Name Is Required",
      }
    `);
  });

  it('step two', async () => {
    const { container } = mount();
    await flush();
    await named();
    await press(/Next/);
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button||Next →|",
          "button||← Previous|",
          "input|checkbox||checked,value=on",
          "input|checkbox||checked,value=on",
          "input|number||value=10",
          "input|number||value=3",
          "select||SundayMondayFriday|value=",
        ],
        "money": {
          "figures": [
            "2 / 3",
            "2",
            "3",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=attention",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "dl||Forge A Union Live Summary",
        ],
        "text": "SECURE | Step | 2 / 3 | Club Authority | Verified | Basics | 2 | Revenue | 3 | Review | Revenue & Features | Configure Profit Sharing And Shared Features. | Union Revenue Share | % | % Of Club Rake To Union | Settlement Day | Sunday | Monday | Friday | Grace Period | Days | Shared Player Pool | Players Can Move Between Clubs In The Union | Cross-Club Tournaments | Host Tournaments Across All Member Clubs",
      }
    `);
  });

  it('step three', async () => {
    const { container } = mount();
    await flush();
    await named();
    await press(/Next/);
    await press(/Next/);
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button||Create Union|",
          "button||← Previous|",
        ],
        "money": {
          "figures": [
            "3 / 3",
            "3",
            "10",
            "3",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=attention",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "dl||Forge A Union Live Summary",
        ],
        "text": "SECURE | Step | 3 / 3 | Club Authority | Verified | Basics | Revenue | 3 | Review | Review & Create | Review Your Union Settings Before Creating. | M | Midway Union | Public Union | Every Midway Club Under One Network. | 10 | % | Revenue Share | sunday | Settlement | 3 | Days | Grace Period | Shared Players | Cross-Club MTTs",
      }
    `);
  });

  it('step three, a private union with no shared features', async () => {
    const { container } = mount();
    await flush();
    fireEvent.change(screen.getByPlaceholderText('Enter Union Name...'), {
      target: { value: 'River Union' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    await press(/Next/);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    await press(/Next/);
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button||Create Union|",
          "button||← Previous|",
        ],
        "money": {
          "figures": [
            "3 / 3",
            "3",
            "10",
            "3",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=attention",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "dl||Forge A Union Live Summary",
        ],
        "text": "SECURE | Step | 3 / 3 | Club Authority | Verified | Basics | Revenue | 3 | Review | Review & Create | Review Your Union Settings Before Creating. | R | River Union | Private Union | 10 | % | Revenue Share | sunday | Settlement | 3 | Days | Grace Period",
      }
    `);
  });

  it('creation failed', async () => {
    fixture.createUnion.mockRejectedValue(new Error('Union Name Is Taken'));
    const { container } = mount();
    await flush();
    await named();
    await press(/Next/);
    await press(/Next/);
    await press(/Create Union/);
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button||Create Union|",
          "button||← Previous|",
        ],
        "money": {
          "figures": [
            "3 / 3",
            "3",
            "10",
            "3",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=attention",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "dl||Forge A Union Live Summary",
        ],
        "text": "SECURE | Step | 3 / 3 | Club Authority | Verified | Basics | Revenue | 3 | Review | Review & Create | Review Your Union Settings Before Creating. | M | Midway Union | Public Union | Every Midway Club Under One Network. | 10 | % | Revenue Share | sunday | Settlement | 3 | Days | Grace Period | Shared Players | Cross-Club MTTs | Union Name Is Taken",
      }
    `);
  });

  it('creating', async () => {
    fixture.createUnion.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await flush();
    await named();
    await press(/Next/);
    await press(/Next/);
    await press(/Create Union/);
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button||Creating...|disabled",
          "button||← Previous|",
        ],
        "money": {
          "figures": [
            "3 / 3",
            "3",
            "10",
            "3",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=attention",
            "data-tone=live",
          ],
        },
        "regions": [
          "span|status|",
          "dl||Forge A Union Live Summary",
        ],
        "text": "SECURE | Step | 3 / 3 | Club Authority | Verified | Basics | Revenue | 3 | Review | Review & Create | Review Your Union Settings Before Creating. | M | Midway Union | Public Union | Every Midway Club Under One Network. | 10 | % | Revenue Share | sunday | Settlement | 3 | Days | Grace Period | Shared Players | Cross-Club MTTs",
      }
    `);
  });
});
