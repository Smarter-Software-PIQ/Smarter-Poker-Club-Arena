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

test('All lobby cards (Spin, SNG, Satellite, MTT, Cash) keep Invite placement and all ink/buttons strictly inside painted glass bays at 375px, 390px, 430px, 768px, and 1000px', async ({
  page,
}) => {
  await page.goto(`${FIXTURE_URL}#/lobby-cards`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await document.fonts.load('600 12px "Roboto Condensed"');
    await document.fonts.ready;
  });

  for (const width of [375, 390, 430, 768, 1000]) {
    await page.setViewportSize({ width, height: 1400 });
    const tableSel = width <= 900 ? '.compact-lobby' : '.lobby-table';
    await expect(
      page.locator(`[data-testid="fixture-section-spin"] ${tableSel} tr[data-id]`).first()
    ).toBeVisible();

    const audit = await page.evaluate((sel: string) => {
      const violations: unknown[] = [];
      const tables = [...document.querySelectorAll<HTMLTableElement>(sel)];

      for (const table of tables) {
        const headingRows = [
          ...table.querySelectorAll<HTMLTableRowElement>('tr[data-game-heading]'),
        ];
        const bodyRows = [...table.querySelectorAll<HTMLTableRowElement>('tr[data-id]')];

        // 1. SNG top-right plaque check: clickable Invite inside plaque, no "N Seats", no duplicate in status bay.
        for (const heading of headingRows) {
          const kind = heading.getAttribute('data-kind');
          const id = heading.getAttribute('data-game-heading')!;
          const plaque = heading.querySelector(
            '.lt-tournament-heading__guarantee'
          ) as HTMLElement | null;
          if (!plaque) {
            violations.push({ id, issue: 'missing-plaque' });
            continue;
          }
          const headBox = heading.getBoundingClientRect();
          const plaqueBox = plaque.getBoundingClientRect();

          if (kind === 'sng') {
            if (/\d+\s+Seats/.test(plaque.textContent || '')) {
              violations.push({
                id,
                issue: 'sng-plaque-still-shows-seats',
                text: plaque.textContent,
              });
            }
            const btn = plaque.querySelector(
              '[data-testid="lobby-invite-btn"]'
            ) as HTMLElement | null;
            if (!btn) {
              violations.push({ id, issue: 'sng-plaque-missing-invite-btn' });
            } else {
              const b = btn.getBoundingClientRect();
              if (
                b.width < 32 ||
                b.height < 16 ||
                b.left < plaqueBox.left - 1 ||
                b.right > plaqueBox.right + 1 ||
                b.top < plaqueBox.top - 1 ||
                b.bottom > plaqueBox.bottom + 1
              ) {
                violations.push({
                  id,
                  issue: 'sng-plaque-invite-outside-frame',
                  btn: {
                    left: b.left - headBox.left,
                    right: b.right - headBox.left,
                    top: b.top - headBox.top,
                    bottom: b.bottom - headBox.top,
                  },
                  plaque: {
                    left: plaqueBox.left - headBox.left,
                    right: plaqueBox.right - headBox.left,
                    top: plaqueBox.top - headBox.top,
                    bottom: plaqueBox.bottom - headBox.top,
                  },
                });
              }
            }
          }

          if (kind === 'spin') {
            if (!(plaque.textContent || '').includes('Win Up To 100x')) {
              violations.push({
                id,
                issue: 'spin-plaque-missing-top-prize',
                text: plaque.textContent,
              });
            }
          }
        }

        // 2. Body glass bay checks across ALL card types (Spin, SNG, Satellite, MTT, Cash).
        for (const row of bodyRows) {
          const id = row.getAttribute('data-id')!;
          const kind = row.getAttribute('data-kind')!;
          const status = row.getAttribute('data-status') || '';
          const frame = row.getBoundingClientRect();
          if (!frame.width || !frame.height) continue;

          // Painted glass vertical bounds: 0.3cqw .. 10.2cqw from row top.
          const minY = frame.top + frame.width * 0.003 - 1;
          const maxY = frame.top + frame.width * 0.102 + 1;
          // Painted glass horizontal bounds:
          // Col 1: left inner border 6.26%, Divider 1 at 29.15%
          const col1MinX = frame.left + frame.width * 0.0626 - 1;
          const col1MaxX = frame.left + frame.width * 0.2915 + 1;
          // Col 5: Divider 4 at 69.23%, right inner border at 93.69%
          const col5MinX = frame.left + frame.width * 0.6923 - 1;
          const col5MaxX = frame.left + frame.width * 0.9369 + 1;

          const col1 = (row.querySelector('td.lt-col-name') ||
            row.querySelector('td:first-child')) as HTMLElement | null;
          const col5 = (row.querySelector('td.lt-col-status') ||
            row.querySelector('td[data-label="Status"]')) as HTMLElement | null;

          if (col1) {
            const walker = document.createTreeWalker(col1, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              const parent = node.parentElement;
              if (
                !node.textContent?.trim() ||
                !parent ||
                parent.closest('.lt-fav,[aria-hidden="true"]') ||
                getComputedStyle(parent).display === 'none' ||
                getComputedStyle(parent).visibility === 'hidden' ||
                !parent.getBoundingClientRect().width
              ) {
                continue;
              }
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const rect of range.getClientRects()) {
                if (rect.width <= 0 || rect.height <= 0) continue;
                if (
                  rect.top < minY ||
                  rect.bottom > maxY ||
                  rect.left < col1MinX ||
                  rect.right > col1MaxX
                ) {
                  violations.push({
                    id,
                    kind,
                    bay: 'col1',
                    text: node.textContent.trim(),
                    rect: {
                      top: +(rect.top - frame.top).toFixed(1),
                      bottom: +(rect.bottom - frame.top).toFixed(1),
                      left: +(rect.left - frame.left).toFixed(1),
                      right: +(rect.right - frame.left).toFixed(1),
                    },
                    bounds: {
                      minY: +(minY - frame.top).toFixed(1),
                      maxY: +(maxY - frame.top).toFixed(1),
                      minX: +(col1MinX - frame.left).toFixed(1),
                      maxX: +(col1MaxX - frame.left).toFixed(1),
                    },
                  });
                }
              }
            }
          }

          if (col5) {
            const statusEl = col5.querySelector('.lt-status') as HTMLElement | null;
            const inviteBtn = col5.querySelector(
              '[data-testid="lobby-invite-btn"]'
            ) as HTMLElement | null;
            const beforeContent = getComputedStyle(col5, '::before').content;

            if (kind === 'sng') {
              if (inviteBtn) {
                violations.push({ id, issue: 'sng-duplicate-invite-in-col5' });
              }
              if (!statusEl) {
                violations.push({ id, issue: 'sng-missing-status-in-col5' });
              }
            }

            if (kind === 'spin' && (status === 'registering' || status === 'open')) {
              if (statusEl) {
                violations.push({
                  id,
                  issue: 'spin-open-should-not-render-status',
                  text: statusEl.textContent,
                });
              }
              if (beforeContent && beforeContent !== 'none') {
                violations.push({
                  id,
                  issue: 'spin-open-should-not-render-status-heading',
                  beforeContent,
                });
              }
              if (!inviteBtn) {
                violations.push({ id, issue: 'spin-open-missing-invite-btn' });
              }
            }

            // Check visible text ink in Col 5 (including status label & button label).
            const walker = document.createTreeWalker(col5, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              const parent = node.parentElement;
              if (
                !node.textContent?.trim() ||
                !parent ||
                getComputedStyle(parent).display === 'none' ||
                getComputedStyle(parent).visibility === 'hidden' ||
                !parent.getBoundingClientRect().width
              ) {
                continue;
              }
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const rect of range.getClientRects()) {
                if (rect.width <= 0 || rect.height <= 0) continue;
                if (
                  rect.top < minY ||
                  rect.bottom > maxY ||
                  rect.left < col5MinX ||
                  rect.right > col5MaxX
                ) {
                  violations.push({
                    id,
                    kind,
                    bay: 'col5-ink',
                    text: node.textContent.trim(),
                    rect: {
                      top: +(rect.top - frame.top).toFixed(1),
                      bottom: +(rect.bottom - frame.top).toFixed(1),
                      left: +(rect.left - frame.left).toFixed(1),
                      right: +(rect.right - frame.left).toFixed(1),
                    },
                    bounds: {
                      minY: +(minY - frame.top).toFixed(1),
                      maxY: +(maxY - frame.top).toFixed(1),
                      minX: +(col5MinX - frame.left).toFixed(1),
                      maxX: +(col5MaxX - frame.left).toFixed(1),
                    },
                  });
                }
              }
            }

            // Check Invite button box itself fits inside Col 5 glass bay.
            if (inviteBtn && getComputedStyle(inviteBtn).display !== 'none') {
              const b = inviteBtn.getBoundingClientRect();
              if (b.top < minY || b.bottom > maxY || b.left < col5MinX || b.right > col5MaxX) {
                violations.push({
                  id,
                  kind,
                  bay: 'col5-btn',
                  rect: {
                    top: +(b.top - frame.top).toFixed(1),
                    bottom: +(b.bottom - frame.top).toFixed(1),
                    left: +(b.left - frame.left).toFixed(1),
                    right: +(b.right - frame.left).toFixed(1),
                  },
                  bounds: {
                    minY: +(minY - frame.top).toFixed(1),
                    maxY: +(maxY - frame.top).toFixed(1),
                    minX: +(col5MinX - frame.left).toFixed(1),
                    maxX: +(col5MaxX - frame.left).toFixed(1),
                  },
                });
              }
              // Check zero overlap between statusEl and inviteBtn when both are visible.
              if (statusEl && getComputedStyle(statusEl).display !== 'none') {
                const s = statusEl.getBoundingClientRect();
                if (s.bottom > b.top + 0.5) {
                  violations.push({
                    id,
                    kind,
                    bay: 'col5-overlap',
                    statusBottom: +(s.bottom - frame.top).toFixed(1),
                    btnTop: +(b.top - frame.top).toFixed(1),
                  });
                }
              }
            }
          }
        }
      }

      return violations;
    }, tableSel);

    expect(audit, `Layout violations at viewport width ${width}px`).toEqual([]);
  }
});
