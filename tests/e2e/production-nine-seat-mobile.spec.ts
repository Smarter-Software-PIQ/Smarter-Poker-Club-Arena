/** Published-client geometry proof. Real tournament roster; browser-only hero
 * identity mapping, never an authoritative seat or financial/gameplay receipt. */
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type WebSocketRoute } from '@playwright/test';
import {
  isReadOnlySpectatorSocketType,
  requestObserverForegroundProbe,
} from './support/spectatorSocketRead';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ENGINE_HOST = 'engine.smarter.poker';
const CLUB_ID = process.env.E2E_CLUB_ID || '';
const TABLE_ID = process.env.E2E_MOBILE_TABLE_ID || '';
type RefusedWrite = { transport: 'http' | 'websocket'; operation: string; path: string };
/** Refuse participation before a request can reach a real seat or chip pool. */
function forbiddenParticipation(method: string, url: URL, body: string | null): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const path = url.pathname.toLowerCase().replace(/\/+$/, '');
  if (url.hostname === ENGINE_HOST) return !path.endsWith('/heartbeat');
  if (
    /\/(?:action|buyin|buy-in|cashout|cash-out|addchips|add-chips|rebuy|leave|seat-move|seat-change|request-cashout|approve-cashout|transfer-chips|mint-chips|distribute-chips|clawback-chips|settle-period|agent-credit)$/.test(
      path
    )
  )
    return true;
  if (
    /\/rest\/v1\/(?:table_seats|tournament_players|wallets|wallet_transactions|chip_ledger|chip_transactions)$/.test(
      path
    )
  )
    return true;
  if (
    path.endsWith('/rest/v1/club_members') &&
    /"(?:chip_balance|promo_balance|held_chips|locked_chips|credit_used)"\s*:/.test(body || '')
  )
    return true;
  const rpc = path.match(/\/rpc\/([^/]+)$/)?.[1];
  // This is the existing read-only price calculation, not a purchase.
  if (
    !rpc ||
    rpc === 'fn_cash_effective_buyin' ||
    /^(?:fn_|ca_)?(?:get|read|list|fetch|can|has|is)_/.test(rpc)
  )
    return false;
  return /take_seat|leave_seat|seat_move|move_seat|seat_change|swap_seat|buy_?in|rebuy|add_?chips|cash_?out|cashout|transfer_chips|mint_chips|clawback|distribute_chips|tournament_payout|register_for_tournament|unregister_from_tournament|join_waitlist|leave_waitlist|(?:^|_)(?:credit|debit|transfer|mint|payout|refund|settle)(?:_|$)|claim_(?:daily|bonus|reward)/.test(
    rpc
  );
}

test.use({ trace: 'off', video: 'off' });
for (const viewport of [
  { width: 467, height: 994 },
  { width: 652, height: 996 },
]) {
  test.describe(`${viewport.width}x${viewport.height} published tournament`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    test('full nine-seat mobile table and action-bar Lobby', async ({
      page,
      context,
      request,
    }, info) => {
      test.setTimeout(150_000);
      if (!UUID.test(CLUB_ID) || !UUID.test(TABLE_ID))
        throw new Error(
          'Validated E2E_CLUB_ID and E2E_MOBILE_TABLE_ID are required for this targeted real-table proof.'
        );
      const record = process.env.E2E_TEST_ACCOUNT_FILE;
      if (!record) throw new Error('Maintained isolated post-deploy account record is required.');
      const { id: fixtureUserId, email } = JSON.parse(await readFile(record, 'utf8'));
      if (
        !UUID.test(String(fixtureUserId)) ||
        !/^ca-customization-cert-postdeploy-.*@example\.invalid$/.test(String(email))
      )
        throw new Error('Mobile table proof refuses a non-reserved account.');
      const refusedParticipation: RefusedWrite[] = [];
      const clients: WebSocketRoute[] = [];
      let snapshot: Record<string, any> | null = null;
      let snapshotClient: WebSocketRoute | null = null;
      let latestSequence = 0;
      let realIncomingFrames = 0;
      let observedViewerId: string | null = null;
      let syntheticPhase = false;
      let forwardedSyntheticUpstream = 0;
      const refusedSynthetic = { http: 0, websocket: 0 };
      const evidence: Record<string, unknown> = {
        source: 'published-real-tournament-browser-only-hero-mapping',
        clubId: CLUB_ID,
        tableId: TABLE_ID,
        requestedViewport: viewport,
        authoritativeSeatReceipt: false,
        naturalSeatedGameplay: false,
        financialReceipt: false,
      };
      await context.route('**/*', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method()) &&
          (syntheticPhase || url.pathname.endsWith('/rpc/fn_report_client_errors'))
        ) {
          if (syntheticPhase) refusedSynthetic.http++;
          await route.abort('blockedbyclient');
          return;
        }
        if (forbiddenParticipation(req.method(), url, req.postData())) {
          refusedParticipation.push({
            transport: 'http',
            operation: req.method(),
            path: url.pathname,
          });
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });
      await context.route('**/rest/v1/table_seats?**', async (route) => {
        const url = new URL(route.request().url());
        if (
          (url.searchParams.get('select') || '').startsWith('table_id') &&
          (url.searchParams.get('user_id') || '').startsWith('eq.')
        )
          observedViewerId = url.searchParams.get('user_id')!.slice(3);
        await route.fallback();
      });
      await context.routeWebSocket(
        () => true,
        (client) => {
          const engine = new URL(client.url()).hostname === ENGINE_HOST;
          if (engine) clients.push(client);
          const server = client.connectToServer();
          server.onMessage((message) => {
            if (syntheticPhase) return;
            if (engine) {
              realIncomingFrames++;
              try {
                const frame = JSON.parse(String(message));
                if (frame.tableId === TABLE_ID) {
                  if (typeof frame.seq === 'number')
                    latestSequence = Math.max(latestSequence, frame.seq);
                  if (frame.type === 'SNAPSHOT' && frame.state?.players?.length === 9) {
                    snapshot = frame;
                    snapshotClient = client;
                  }
                }
              } catch {
                /* Forward genuine non-JSON bytes unchanged. */
              }
            }
            client.send(message);
          });
          client.onMessage((message) => {
            if (syntheticPhase) {
              refusedSynthetic.websocket++;
              return;
            }
            if (engine) {
              let type = '';
              try {
                type = String(JSON.parse(String(message)).type || '');
              } catch {
                /* Refused below. */
              }
              if (!isReadOnlySpectatorSocketType(type)) {
                refusedParticipation.push({
                  transport: 'websocket',
                  operation: type || 'unreadable-frame',
                  path: '/ws/multi',
                });
                return;
              }
            }
            if (syntheticPhase) forwardedSyntheticUpstream++;
            server.send(message);
          });
        }
      );
      const readBuild = async () => {
        const responses = await Promise.all([
          request.get(`https://ca-static.smarter.poker/build-info.json?mobile=${Date.now()}`),
          request.get(`https://smarter.poker/hub/club-arena/build-info.json?mobile=${Date.now()}`),
        ]);
        for (const response of responses) expect(response.ok()).toBe(true);
        const [origin, rewrite] = await Promise.all(responses.map((response) => response.json()));
        expect(origin.ca_sha).toMatch(/^[0-9a-f]{40}$/);
        expect(rewrite.ca_sha).toBe(origin.ca_sha);
        expect(rewrite.run_id).toBe(origin.run_id);
        expect(origin.built_by).toBe('publish-club-arena.yml');
        return { ca_sha: origin.ca_sha, run_id: String(origin.run_id) };
      };
      try {
        evidence.before = await readBuild();
        await page.goto(`table/${TABLE_ID}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.table-surface')).toBeVisible({ timeout: 35_000 });
        await expect(page.locator('.table-page')).toHaveClass(/table-page--tournament/);
        await expect(page.locator('.table-page')).toHaveAttribute('data-hero', 'false');
        await expect(page.locator('.seat:not(.seat--empty)')).toHaveCount(9, { timeout: 30_000 });
        await expect.poll(() => snapshot !== null, { timeout: 25_000 }).toBe(true);
        expect(realIncomingFrames).toBeGreaterThan(0);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: info.outputPath('published-nine-seat-observer.png') });
        evidence.realObserverOccupiedSeats = 9;
        await expect.poll(() => observedViewerId, { timeout: 20_000 }).toBe(fixtureUserId);
        evidence.reservedViewerConfirmed = true;
        const input = structuredClone(snapshot!) as Record<string, any>;
        expect(input.tableId).toBe(TABLE_ID);
        expect(input.state.lightning_observer).not.toBe(true);
        // Retain every real player/stack/card/action. Only the current actor's
        // identity is mapped to our reserved QA viewer in this browser.
        const index = Math.max(
          0,
          input.state.players.findIndex(
            (player: any) => player.user_id === input.state.current_player
          )
        );
        const actorId = input.state.players[index].user_id;
        expect(actorId).not.toBe(fixtureUserId);
        input.state.players[index].user_id = fixtureUserId;
        if (input.state.current_player === actorId) input.state.current_player = fixtureUserId;
        input.seq = latestSequence + 1;
        syntheticPhase = true;
        snapshotClient!.send(JSON.stringify(input));
        await expect(page.locator(`.seat--hero[data-player-id="${fixtureUserId}"]`)).toHaveCount(1);
        await expect(page.locator('.seat:not(.seat--empty)')).toHaveCount(9);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        );
        await page.locator('.table-page .seat__avatar-img').evaluateAll(async (images) => {
          await Promise.all(images.map((image) => (image as HTMLImageElement).decode()));
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          await Promise.all(
            images
              .flatMap((image) => image.getAnimations())
              .filter((animation) => {
                const timing = animation.effect?.getComputedTiming();
                return timing && Number.isFinite(timing.endTime) && Number(timing.endTime) <= 1000;
              })
              .map((animation) => animation.finished.catch(() => undefined))
          );
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        });
        const geometry = await page.locator('.table-page').evaluate((table) => {
          const rect = (element: Element) => {
            const r = element.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              right: r.right,
              bottom: r.bottom,
            };
          };
          const visible = (element: Element) => {
            const r = element.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== 'hidden';
          };
          const seats = [...table.querySelectorAll<HTMLElement>('.seat:not(.seat--empty)')];
          return {
            viewport: { width: innerWidth, height: innerHeight },
            canvas: rect(table.querySelector('.table-scaler')!),
            seats: seats.map((seat) => ({
              hero: seat.classList.contains('seat--hero'),
              name: seat.querySelector('.seat__name')?.textContent,
              avatar: {
                width: seat.querySelector<HTMLElement>('.seat__avatar')!.offsetWidth,
                height: seat.querySelector<HTMLElement>('.seat__avatar')!.offsetHeight,
              },
              panel: {
                width: seat.querySelector<HTMLElement>('.seat__info')!.offsetWidth,
                height: seat.querySelector<HTMLElement>('.seat__info')!.offsetHeight,
              },
              action: seat.querySelector<HTMLElement>('.seat__action')
                ? {
                    width: seat.querySelector<HTMLElement>('.seat__action')!.offsetWidth,
                    height: seat.querySelector<HTMLElement>('.seat__action')!.offsetHeight,
                  }
                : null,
              parts: [...seat.querySelectorAll('.seat__avatar-img,.seat__info,.seat__action')]
                .filter(visible)
                .map((element) => ({
                  ...rect(element),
                  avatar: element.matches('.seat__avatar-img'),
                })),
            })),
            caps: [...table.querySelectorAll('.seat-wrapper--cap')].map((pod) =>
              Math.max(
                ...[
                  ...pod.querySelectorAll(
                    '.seat__avatar-img,.seat__info,.seat__action,.seat__bounty,.seat__position-badge'
                  ),
                ]
                  .filter(visible)
                  .map((element) => rect(element).bottom)
              )
            ),
            board: [...table.querySelectorAll('.community-area .community-cards__card')]
              .filter(visible)
              .map(rect),
            privateCards: [
              ...table.querySelectorAll(
                '.seat--hero .seat__cards--hero:not(.seat__cards--revealed) .seat__card'
              ),
            ]
              .filter(visible)
              .map(rect),
          };
        });
        const visibleSubjects = await page
          .locator('.table-page .seat:not(.seat--empty)')
          .evaluateAll(async (seats) => {
            return await Promise.all(
              seats.map(async (seat) => {
                const img = seat.querySelector<HTMLImageElement>('.seat__avatar-img')!;
                await img.decode();
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
                const readable = new Image();
                readable.crossOrigin = 'anonymous';
                readable.src = img.currentSrc || img.src;
                await readable.decode();
                ctx.drawImage(readable, 0, 0, canvas.width, canvas.height);
                const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                let top = canvas.height,
                  bottom = -1,
                  left = canvas.width,
                  right = -1;
                for (let y = 0; y < canvas.height; y++)
                  for (let x = 0; x < canvas.width; x++)
                    if (pixels[(y * canvas.width + x) * 4 + 3] > 0) {
                      top = Math.min(top, y);
                      bottom = Math.max(bottom, y);
                      left = Math.min(left, x);
                      right = Math.max(right, x);
                    }
                const box = img.getBoundingClientRect();
                const bust = Boolean(img.closest('.seat__avatar--bust'));
                const pixelScale = Math.min(
                  box.width / img.naturalWidth,
                  box.height / img.naturalHeight
                );
                const painted = bust
                  ? {
                      x:
                        box.x + (box.width - img.naturalWidth * pixelScale) / 2 + left * pixelScale,
                      y: box.bottom - img.naturalHeight * pixelScale + top * pixelScale,
                      width: (right - left + 1) * pixelScale,
                      height: (bottom - top + 1) * pixelScale,
                      right:
                        box.x +
                        (box.width - img.naturalWidth * pixelScale) / 2 +
                        (right + 1) * pixelScale,
                      bottom:
                        box.bottom - img.naturalHeight * pixelScale + (bottom + 1) * pixelScale,
                    }
                  : {
                      x: box.x,
                      y: box.y,
                      width: box.width,
                      height: box.height,
                      right: box.right,
                      bottom: box.bottom,
                    };
                return {
                  painted,
                  hero: seat.classList.contains('seat--hero'),
                  name: seat.querySelector('.seat__name')?.textContent,
                  alphaHeight: bottom - top + 1,
                  naturalWidth: img.naturalWidth,
                  naturalHeight: img.naturalHeight,
                  visibleHeight: img.closest('.seat__avatar--bust')
                    ? Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight) *
                      (bottom - top + 1)
                    : box.height,
                };
              })
            );
          });
        geometry.seats.forEach((seat, i) => {
          seat.parts = seat.parts.map((part) =>
            part.avatar ? { ...part, ...visibleSubjects[i].painted } : part
          );
        });
        const hero = geometry.seats.find((seat) => seat.hero)!;
        expect(geometry.seats).toHaveLength(9);
        for (const seat of geometry.seats)
          for (const part of ['avatar', 'panel'] as const) {
            expect(Math.abs(seat[part].width - hero[part].width)).toBeLessThan(1.5);
            expect(Math.abs(seat[part].height - hero[part].height)).toBeLessThan(1.5);
          }
        const actions = geometry.seats.flatMap((seat) => (seat.action ? [seat.action] : []));
        for (const action of actions) {
          expect(Math.abs(action.width - actions[0].width)).toBeLessThan(1.5);
          expect(Math.abs(action.height - actions[0].height)).toBeLessThan(1.5);
        }
        expect(geometry.caps).toHaveLength(2);
        for (const bottom of geometry.caps)
          expect(geometry.canvas.y - bottom, 'complete top pod above rail').toBeGreaterThanOrEqual(
            3
          );
        const overlaps = (a: typeof geometry.canvas, b: typeof geometry.canvas) =>
          Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
        for (const seat of geometry.seats)
          for (const part of seat.parts) {
            for (const board of geometry.board)
              expect(overlaps(part, board), `${seat.name} covers board`).toBe(false);
            if (!seat.hero)
              for (const card of geometry.privateCards)
                expect(overlaps(part, card), `${seat.name} covers private hero cards`).toBe(false);
          }
        for (let i = 0; i < geometry.seats.length; i++)
          for (let j = i + 1; j < geometry.seats.length; j++)
            for (const a of geometry.seats[i].parts)
              for (const b of geometry.seats[j].parts)
                expect(
                  overlaps(a, b),
                  `${geometry.seats[i].name} overlaps ${geometry.seats[j].name}`
                ).toBe(false);
        evidence.geometry = geometry;
        evidence.privateCardsObserved = geometry.privateCards.length;
        evidence.boardCardsObserved = geometry.board.length;
        const heroSubject = visibleSubjects.find((seat) => seat.hero)!;
        for (const subject of visibleSubjects) {
          expect(subject.alphaHeight).toBeGreaterThan(0);
          expect(
            Math.abs(subject.visibleHeight / heroSubject.visibleHeight - 1),
            `${subject.name}: painted avatar height versus hero (fold pose permits 3%)`
          ).toBeLessThan(0.05);
        }
        evidence.visibleAvatarSubjects = visibleSubjects;
        const wagerPositions = () =>
          page.locator('.seat-wrapper .seat__bet-chips').evaluateAll((markers) =>
            markers.map((marker) => ({
              seat: marker
                .closest('.seat-wrapper')
                ?.querySelector('.seat')
                ?.getAttribute('data-seat-num'),
              x: (marker as HTMLElement).style.getPropertyValue('--bet-offset-x'),
              y: (marker as HTMLElement).style.getPropertyValue('--bet-offset-y'),
            }))
          );
        const settledWagers = await wagerPositions();
        expect(settledWagers.length, 'live proof must include placed chips').toBeGreaterThan(0);
        await page.evaluate(() =>
          document
            .querySelector('.table-scaler')!
            .dispatchEvent(new Event('transitionend', { bubbles: true }))
        );
        await page.evaluate(requestObserverForegroundProbe);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        );
        expect(
          await wagerPositions(),
          'resting chip offsets remain fixed through foreground revision'
        ).toEqual(settledWagers);
        evidence.restingWagers = { observed: settledWagers.length, foregroundRevisionStable: true };

        const lobby = page.getByRole('button', { name: 'Open Tournament Lobby', exact: true });
        await expect(lobby).toBeVisible();
        expect(
          await lobby.evaluate((button) => Boolean(button.closest('.action-panel-wrapper')))
        ).toBe(true);
        await expect(page.locator('.tournament-lobby-corner-btn')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('published-nine-seat-hero.png') });
        await lobby.click();
        await expect(
          page.getByRole('dialog', { name: 'Tournament Lobby', exact: true })
        ).toBeVisible();
        evidence.lobbyOpenedFromActionBar = true;
        await page.screenshot({ path: info.outputPath('published-action-bar-lobby-open.png') });
        await page.evaluate(requestObserverForegroundProbe);
        await page.evaluate(async () => {
          await fetch('/hub/club-arena/__mobile_ui_only_refusal_probe__', {
            method: 'POST',
            body: 'ui-only',
          }).catch(() => undefined);
        });
        await expect.poll(() => refusedSynthetic.websocket).toBeGreaterThan(0);
        expect(refusedSynthetic.http).toBeGreaterThan(0);
        expect(forwardedSyntheticUpstream).toBe(0);
        expect(refusedParticipation).toEqual([]);
        evidence.after = await readBuild();
        expect(evidence.after).toEqual(evidence.before);
      } finally {
        if (syntheticPhase) await context.close();
        const receipt = info.outputPath('published-nine-seat-mobile.json');
        await writeFile(
          receipt,
          JSON.stringify(
            {
              ...evidence,
              realIncomingFrames,
              refusedParticipation,
              refusedSynthetic,
              forwardedSyntheticUpstream,
            },
            null,
            2
          )
        );
        await info.attach('published-nine-seat-mobile', {
          path: receipt,
          contentType: 'application/json',
        });
      }
    });
  });
}
