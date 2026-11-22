import { expect, test } from '@playwright/test';

const USER_UUID = '11111111-2222-4333-8444-555555555555';
const TABLE_UUID = '11111111-2222-4333-8444-555555555555';
const CLUSTER_UUID = '33333333-4444-4555-8666-777777777777';
const CLUB_UUID = '44444444-5555-4666-8777-888888888888';
const FIXTURE_URL = 'tests/browser/fixtures/table-invite-flows/index.html';

test.beforeEach(async ({ context }) => {
  await context.addInitScript((userId: string) => {
    const token = `e30.${btoa(
      JSON.stringify({ sub: userId, session_id: 'table-invite-e2e', exp: 4102444800 })
    )}.sig`;
    localStorage.setItem(
      'smarter-poker-auth',
      JSON.stringify({
        access_token: token,
        refresh_token: 'fixture',
        expires_at: 4102444800,
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: userId },
      })
    );
  }, USER_UUID);

  await context.route(/\/auth\/v1\//, (route) =>
    route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { user: { id: USER_UUID } },
    })
  );

  await context.route(/\/rest\/v1\//, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': '*' };
    if (pathname.endsWith('/rpc/fn_club_invite_resolve')) {
      return route.fulfill({
        headers,
        json: {
          found: true,
          join_path: `/hub/club-arena/invite/${CLUB_UUID}?i=ABC2345&ref=77`,
        },
      });
    }
    if (pathname.endsWith('/rpc/fn_club_invite_claim')) {
      return route.fulfill({
        headers,
        json: {
          success: true,
          join_path: `/hub/club-arena/invite/${CLUB_UUID}?i=ABC2345&ref=77`,
        },
      });
    }
    if (pathname.endsWith('/rpc/get_my_full_profile')) {
      return route.fulfill({
        headers,
        json: {
          id: USER_UUID,
          username: 'Player',
          display_name: 'Player',
          alias: 'Player',
          tier: 'Newcomer',
          is_vip: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      });
    }
    if (pathname.endsWith('/clubs')) {
      return route.fulfill({
        headers,
        json: [
          {
            id: CLUB_UUID,
            club_id: 77777,
            slug: 'kings-club',
            name: 'Kings Club',
            member_count: 120,
            is_public: true,
            asset: 'chips',
          },
        ],
      });
    }
    if (pathname.endsWith('/club_members')) {
      return route.fulfill({
        headers,
        json: [{ user_id: USER_UUID, status: 'active' }],
      });
    }
    return route.fulfill({ headers, json: [] });
  });
});

test('HeadsUpWaitingModal builds canonical invite URL and copies cleanly inside top-layer <dialog> even when Clipboard API is denied', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new DOMException('Write permission denied', 'NotAllowedError')),
      },
    });
    const origExec = document.execCommand.bind(document);
    (window as unknown as { __copiedText?: string; __copyInsideModal?: boolean }).__copiedText = '';
    document.execCommand = ((cmd: string) => {
      if (cmd === 'copy') {
        const active = document.activeElement as HTMLTextAreaElement | null;
        (window as unknown as { __copiedText?: string }).__copiedText = active?.value ?? '';
        (window as unknown as { __copyInsideModal?: boolean }).__copyInsideModal = Boolean(
          active?.closest('dialog:modal')
        );
        return true;
      }
      return origExec(cmd);
    }) as typeof document.execCommand;
  });

  await page.goto(`${FIXTURE_URL}#/hu-dialog`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Waiting For Opponent')).toBeVisible();
  await page.getByRole('button', { name: 'Specific Player' }).click();

  const expectedUrl = `https://smarter.poker/g/${TABLE_UUID}?i=ABC2345&invite=hu_hold_99`;
  await expect(page.getByText(expectedUrl)).toBeVisible();

  await page.getByRole('button', { name: 'Copy Link' }).click();
  await expect(page.getByTestId('hu-notice')).toHaveText('Game Invite Link Copied');

  const copied = await page.evaluate(() => ({
    text: (window as unknown as { __copiedText?: string }).__copiedText,
    insideModal: (window as unknown as { __copyInsideModal?: boolean }).__copyInsideModal,
  }));
  expect(copied.insideModal).toBe(true);
  expect(copied.text).toContain(expectedUrl);
});

test('Mobile 390px MTT lobby card keeps .lt-invite-btn visible and tappable while hiding .lt-status', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FIXTURE_URL}#/mobile-mtt`, { waitUntil: 'domcontentloaded' });

  // Compact mobile MTT row Invite button is visible and tappable.
  const compactInviteBtn = page.locator(
    ".compact-lobby tr[data-kind='mtt'] [data-testid='lobby-invite-btn']"
  );
  await expect(compactInviteBtn).toBeVisible();

  // Exercise the non-compact .lobby-table mobile MTT card CSS by hiding the
  // compact sibling so .lobby-table-wrap renders directly at 390px.
  await page.evaluate(() => {
    document.querySelector('.arena-lobby-card-list')?.remove();
  });

  const nonCompactInviteBtn = page.locator(
    ".lobby-table tr[data-kind='mtt'] [data-testid='lobby-invite-btn']"
  );
  await expect(nonCompactInviteBtn).toBeVisible();

  const layout = await page.evaluate(() => {
    const statusCell = document.querySelector(
      ".lobby-table tr[data-kind='mtt'] td.lt-col-status"
    ) as HTMLElement | null;
    const row = statusCell?.closest("tr[data-kind='mtt']") as HTMLElement | null;
    const table = row?.closest('table.lobby-table') as HTMLElement | null;
    const statusPill = statusCell?.querySelector('.lt-status') as HTMLElement | null;
    const btn = statusCell?.querySelector('.lt-invite-btn') as HTMLElement | null;
    const nameCell = row?.querySelector('td.lt-col-name') as HTMLElement | null;
    const btnRect = btn ? btn.getBoundingClientRect().toJSON() : null;
    const nameRect = nameCell ? nameCell.getBoundingClientRect().toJSON() : null;

    // Also measure standard (non-premium-chassis) mobile MTT card padding-right.
    const hadPremium = Boolean(table?.classList.contains('has-premium-chassis'));
    if (hadPremium && table) table.classList.remove('has-premium-chassis');
    const standardPaddingRight = nameCell ? parseFloat(getComputedStyle(nameCell).paddingRight) : 0;
    const standardStatusPillDisplay = statusPill ? getComputedStyle(statusPill).display : null;
    const standardStatusCellDisplay = statusCell ? getComputedStyle(statusCell).display : null;
    if (hadPremium && table) table.classList.add('has-premium-chassis');

    return {
      statusCellDisplay: statusCell ? getComputedStyle(statusCell).display : null,
      statusPillDisplay: statusPill ? getComputedStyle(statusPill).display : null,
      standardStatusCellDisplay,
      standardStatusPillDisplay,
      standardPaddingRight,
      btnRect,
      nameRect,
    };
  });

  expect(layout.statusCellDisplay).not.toBe('none');
  expect(layout.statusPillDisplay).toBe('none');
  expect(layout.standardStatusCellDisplay).not.toBe('none');
  expect(layout.standardStatusPillDisplay).toBe('none');
  expect(layout.standardPaddingRight).toBeGreaterThanOrEqual(42);
  expect(layout.btnRect).not.toBeNull();
  expect((layout.btnRect as { width: number }).width).toBeGreaterThan(40);
  expect((layout.btnRect as { height: number }).height).toBeGreaterThanOrEqual(24);
  if (layout.nameRect && layout.btnRect) {
    expect((layout.nameRect as { right: number }).right).toBeLessThanOrEqual(
      (layout.btnRect as { left: number }).left + 1
    );
  }
});

test('/i/:code?next=/table/:id preserves ?next= through InviteCodePage and InvitePage directly to the table', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('fixture-joined-club', '1');
  });
  const nextPath = `/table/${TABLE_UUID}?cluster=${CLUSTER_UUID}`;
  await page.goto(`${FIXTURE_URL}#/i/ABC2345?next=${encodeURIComponent(nextPath)}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('table-opened')).toHaveText(`Table Opened:${nextPath}`);
});

test('Signed-in /table/:id?i=CODE unavailable overlay shows Join Club & Open Table and routes back to table after invite join', async ({
  page,
}) => {
  const tableUrl = `/table/${TABLE_UUID}?i=ABC2345&cluster=${CLUSTER_UUID}`;
  await page.goto(`${FIXTURE_URL}#${tableUrl}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Table Unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back To Lobby' })).toBeVisible();
  const joinBtn = page.getByRole('button', { name: 'Join Club & Open Table' });
  await expect(joinBtn).toBeVisible();

  await page.evaluate(() => {
    window.sessionStorage.setItem('fixture-joined-club', '1');
  });
  await joinBtn.click();

  await expect(page.getByTestId('table-opened')).toHaveText(
    `Table Opened:/table/${TABLE_UUID}?cluster=${CLUSTER_UUID}`
  );
});
