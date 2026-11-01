/**
 * THE CREATE-TABLE MTT TAB, RENDERED (owner requirements, 2026-09-20).
 *
 * The pure mappers are pinned elsewhere (TournamentFromTableConfig,
 * mttEntryRulesAndPrizeStyleAreIndependent, quarterHourStartSelect,
 * tableConfigRecurrence). This renders the real page on the MTT tab and drives
 * it the way an owner would, then reads what Start actually hands the
 * services: nothing reaches Supabase, the two creation calls are spied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
const access = vi.hoisted(() => vi.fn());
const seal = vi.hoisted(() => vi.fn());
const verify = vi.hoisted(() => vi.fn());
vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'actor-1' } }),
}));
vi.mock('../../src/hooks/usePlatformCapability', () => ({
  usePlatformCapability: () => 'available',
}));
vi.mock('../../src/services/TournamentStageService', async (importActual) => ({
  ...(await importActual<typeof import('../../src/services/TournamentStageService')>()),
  sealStagePlan: seal,
  verifySealedStagePlan: verify,
}));

vi.mock('../../src/lib/supabase', () => {
  const chain = (): unknown => {
    const handler: ProxyHandler<object> = {
      get: (_t, prop) => {
        if (prop === 'maybeSingle' || prop === 'single')
          return () => Promise.resolve({ data: null, error: null });
        if (prop === 'then')
          return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
        return () => new Proxy({}, handler);
      },
    };
    return new Proxy({}, handler);
  };
  return {
    supabase: {
      from: () => chain(),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
    getAuthUser: vi.fn().mockResolvedValue({ data: { user: null } }),
  };
});
vi.mock('../../src/core/MasterBus', () => {
  const channel = {
    on() {
      return channel;
    },
    subscribe() {
      return channel;
    },
  };
  return {
    masterBus: {
      emit: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      getOrCreateChannel: vi.fn(() => channel),
      removeRegisteredChannel: vi.fn(),
    },
  };
});
vi.mock('../../src/utils/clubIdResolver', () => ({
  resolveClubUUID: vi.fn().mockResolvedValue('11111111-1111-4111-8111-111111111111'),
}));
vi.mock('../../src/services/GameAccessService', () => ({ fetchGameCreationAccess: access }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => toast }));
// The cash flow is never on screen on the MTT tab; keep its dependencies out.
vi.mock('../../src/components/cash/CashGameCreateFlow', () => ({ default: () => null }));

import TableConfigPage from '../../src/pages/TableConfigPage';
import { tournamentService } from '../../src/services/TournamentService';
import { tournamentScheduleService } from '../../src/services/TournamentScheduleService';
import { MTT_ENTRY_WINDOW_REQUIRED } from '../../src/lib/tournamentFromTableConfig';
import { localDateValue } from '../../src/lib/quarterHourStartSelect';

type Created = Parameters<typeof tournamentService.createTournament>[1];

let create: ReturnType<typeof vi.spyOn>;
let upsert: ReturnType<typeof vi.spyOn>;
const onExit = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  seal.mockReset();
  verify.mockReset().mockResolvedValue(false);
  sessionStorage.clear();
  access.mockResolvedValue({ allowed: true, unionId: null, reason: 'ok' });
  create = vi
    .spyOn(tournamentService, 'createTournament')
    .mockResolvedValue({ id: 't-1' } as never);
  upsert = vi.spyOn(tournamentScheduleService, 'upsert').mockResolvedValue('s-1');
  try {
    localStorage.clear();
  } catch {
    /* storage unavailable */
  }
});

afterEach(() => {
  cleanup();
  create.mockRestore();
  upsert.mockRestore();
});

async function openMttTab() {
  const mounted = render(
    <MemoryRouter>
      <TableConfigPage clubIdOverride="club-1" gameTypeOverride="nlh" embedded onExit={onExit} />
    </MemoryRouter>
  );
  await waitFor(() => expect(access).toHaveBeenCalled());
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'MTT' }));
  return mounted;
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;
const choose = (name: string, value: string) =>
  fireEvent.change(select(name), { target: { value } });
const optionLabels = (name: string) =>
  within(select(name))
    .getAllByRole('option')
    .map((o) => o.textContent);

async function start() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  });
}

const created = (): Created => create.mock.calls[0][1] as Created;

async function openMultiDay() {
  const mounted = await openMttTab();
  const day = localDateValue(new Date(Date.now() + 3 * 86400000));
  choose('Start Date', day);
  choose('Start Time', '19:15');
  fireEvent.click(screen.getByRole('switch', { name: 'Multi-Day MTT' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Day 1 Ends After Level' }), {
    target: { value: '100' },
  });
  fireEvent.change(screen.getByLabelText('Day 2 Starts At'), {
    target: { value: localDateValue(new Date(Date.now() + 4 * 86400000)) + 'T19:15' },
  });
  return mounted;
}
it('does not claim one-day creation when the seal outcome is unknown', async () => {
  seal.mockResolvedValue({ ok: false, reason: 'fetch failed' });
  await openMultiDay();
  await start();
  expect(create).toHaveBeenCalledTimes(1);
  expect(seal).toHaveBeenCalledTimes(1);
  expect(toast.error.mock.calls.some(([text]) => text.includes('One-Day Event'))).toBe(false);
  expect(onExit).not.toHaveBeenCalled();
});
it('retains the acknowledged created tournament when a seal rejects and Start is pressed again', async () => {
  seal
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValue({ ok: true, replay: true, raw: { tournament_id: 't-1' } });
  await openMultiDay();
  await start();
  expect(create).toHaveBeenCalledTimes(1);
  verify.mockResolvedValue(true);
  await start();
  expect(create).toHaveBeenCalledTimes(1);
  expect(seal.mock.calls.every(([id]) => id === 't-1')).toBe(true);
});

it('reads an accepted seal after its acknowledgement is lost without creating again', async () => {
  seal.mockRejectedValue(new Error('connection lost'));
  verify.mockResolvedValue(true);
  await openMultiDay();
  await start();
  expect(create).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledWith('t-1', seal.mock.calls[0][1]);
  expect(onExit).toHaveBeenCalledWith('tournament_created');
  expect(toast.error).not.toHaveBeenCalled();
});
it('retains the accepted event and original plan through remount and edited draft', async () => {
  seal.mockResolvedValue({ ok: false, reason: 'fetch failed' });
  await openMultiDay();
  await start();
  const originalPlan = seal.mock.calls[0][1];
  cleanup();
  await openMttTab();
  verify.mockResolvedValue(true);
  await start();
  expect(create).toHaveBeenCalledTimes(1);
  expect(seal).toHaveBeenLastCalledWith('t-1', originalPlan);
  expect(onExit).toHaveBeenCalledWith('tournament_created');
});
it('keeps an unreadable retained identity from authorizing a replacement', async () => {
  sessionStorage.setItem('ca_created_stage_intent_v1:["actor-1","club-1"]', 'broken');
  await openMultiDay();
  await start();
  expect(create).not.toHaveBeenCalled();
  expect(onExit).not.toHaveBeenCalled();
});

it('does not publish a delayed prior form seal after unmount', async () => {
  let release!: (value: unknown) => void;
  seal.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  await openMultiDay();
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(seal).toHaveBeenCalled());
  cleanup();
  await act(async () => {
    release({ ok: true });
  });
  expect(verify).not.toHaveBeenCalled();
  expect(onExit).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(1);
});
it('refuses creation if its accepted identity cannot be retained', async () => {
  await openMultiDay();
  const storage = window.sessionStorage;
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('Storage unavailable');
      },
    },
  });
  try {
    await start();
    expect(create).not.toHaveBeenCalled();
    expect(seal).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: storage });
  }
});

it('retires the first A response across an A to B to A scope roundtrip', async () => {
  let release!: (value: unknown) => void;
  seal.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  verify.mockResolvedValue(true);
  const mounted = await openMultiDay();
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(seal).toHaveBeenCalled());
  mounted.rerender(
    <MemoryRouter>
      <TableConfigPage clubIdOverride="club-2" gameTypeOverride="nlh" embedded onExit={onExit} />
    </MemoryRouter>
  );
  mounted.rerender(
    <MemoryRouter>
      <TableConfigPage clubIdOverride="club-1" gameTypeOverride="nlh" embedded onExit={onExit} />
    </MemoryRouter>
  );
  await act(async () => {
    release({ ok: true });
  });
  expect(verify).not.toHaveBeenCalled();
  expect(onExit).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(1);
});

it('retains a retired initial acknowledgement without allowing a duplicate during scope roundtrip', async () => {
  let release!: (value: unknown) => void;
  create.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  seal.mockResolvedValue({ ok: true });
  verify.mockResolvedValue(true);
  const mounted = await openMultiDay();
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  mounted.rerender(
    <MemoryRouter>
      <TableConfigPage clubIdOverride="club-2" gameTypeOverride="nlh" embedded onExit={onExit} />
    </MemoryRouter>
  );
  mounted.rerender(
    <MemoryRouter>
      <TableConfigPage clubIdOverride="club-1" gameTypeOverride="nlh" embedded onExit={onExit} />
    </MemoryRouter>
  );
  await start();
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => {
    release({ id: 't-original' });
  });
  expect(seal).not.toHaveBeenCalled();
  expect(onExit).not.toHaveBeenCalled();
  await start();
  expect(create).toHaveBeenCalledTimes(1);
  expect(seal).toHaveBeenCalledWith('t-original', expect.any(Object));
  expect(onExit).toHaveBeenCalledWith('tournament_created');
});
