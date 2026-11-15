import { expect, type Page, type TestInfo } from '@playwright/test';

type FoldFrame = {
  at: number;
  hand: string;
  faces: string[];
  flight: number;
  canAct: boolean;
  panelTop: number | null;
  heroX: number | null;
  rowX: number | null;
  rowY: number | null;
  heroY: number | null;
  feltTop: number | null;
  feltHeight: number | null;
};

declare global {
  interface Window {
    lightningFoldProof?: { frames: FoldFrame[]; running: boolean };
  }
}

/** Capture the touch itself and each following painted opportunity, including blank and dealing frames. */
export async function tapLightningFold(page: Page, room: string, handId: string) {
  const fold = page.locator('.pre-action-btn.fold');
  await expect(fold).toBeVisible();
  await expect(page.locator('.table-art-cover')).toBeHidden({ timeout: 15_000 });
  await fold.evaluate((button) => {
    button.addEventListener(
      'pointerdown',
      () => {
        const proof = { frames: [] as FoldFrame[], running: true };
        window.lightningFoldProof = proof;
        const sample = () => {
          if (!proof.running) return;
          const hero = document.querySelector('.seat--hero');
          const row = hero?.querySelector('.seat__cards--hero');
          const faces = Array.from(row?.querySelectorAll('.seat__card--face') ?? []).filter(
            (face) =>
              getComputedStyle(face).opacity === '1' && face.getBoundingClientRect().width > 0
          );
          const action = document.querySelector<HTMLButtonElement>(
            '.action-panel--active .action-btn:not(:disabled)'
          );
          const box = action?.getBoundingClientRect();
          const hit =
            box && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          const felt = document.querySelector('.table-scaler')?.getBoundingClientRect();
          proof.frames.push({
            at: Date.now(),
            hand: document.querySelector('.table-brand__hand')?.textContent?.trim() ?? '',
            faces: faces.map((face) => face.querySelector('img')?.alt ?? ''),
            flight: document.querySelectorAll('.deal-animation__card').length,
            canAct: Boolean(action && hit && action.contains(hit)),
            panelTop: box?.top ?? null,
            heroX: hero?.getBoundingClientRect().left ?? null,
            rowX: row?.getBoundingClientRect().left ?? null,
            rowY: row?.getBoundingClientRect().top ?? null,
            heroY: hero?.getBoundingClientRect().top ?? null,
            feltTop: felt?.top ?? null,
            feltHeight: felt?.height ?? null,
          });
          requestAnimationFrame(sample);
        };
        sample();
      },
      { once: true, capture: true }
    );
  });
  // WebKit's low-level mobile tap uses visual-viewport coordinates when the
  // table changes the viewport meta to its 600px logical felt. Its locator
  // tap passes the unscaled layout point (below the physical screen).
  const webkit = page.context().browser()?.browserType().name() === 'webkit';
  const point = await fold.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const x = box.left + box.width / 2,
      y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    const viewport = window.visualViewport;
    return {
      hitsFold: button.contains(hit),
      x: (x - (viewport?.offsetLeft ?? 0)) * (viewport?.scale ?? 1),
      y: (y - (viewport?.offsetTop ?? 0)) * (viewport?.scale ?? 1),
      scale: viewport?.scale ?? 1,
    };
  });
  expect(point.hitsFold).toBe(true);
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/action'),
    webkit && point.scale !== 1 ? page.touchscreen.tap(point.x, point.y) : fold.tap(),
  ]);
  expect(request.postDataJSON()).toMatchObject({
    tableId: room,
    action: 'fast_fold',
    actionContext: 'lightning-hand:' + handId,
  });
}

export async function verifyLightningFoldFrames(
  page: Page,
  hand: number,
  decisionAt: number,
  durationMs: number,
  expectedCards: string[],
  testInfo?: TestInfo
) {
  const frames = await page.evaluate(() => {
    const proof = window.lightningFoldProof;
    if (!proof) throw new Error('Missing fold pointerdown');
    proof.running = false;
    return proof.frames;
  });
  const handLabel = 'Hand #' + hand;
  const first = frames.findIndex(
    (frame) => frame.hand === handLabel && frame.faces.length === 5 && frame.canAct
  );
  const decision = frames[first];
  const remaining = decision ? decisionAt + durationMs - decision.at : null;
  // Preserve the timing and first failing geometry when an assertion ends the live run.
  if (testInfo) {
    await testInfo.attach('lightning-fold-frames.json', {
      body: JSON.stringify({ decisionAt, observedRemainingMs: remaining, frames }),
      contentType: 'application/json',
    });
  }
  expect(first, 'a complete private hand and hit-testable decision appeared').toBeGreaterThan(0);
  // Presentation may consume at most one second after the authoritative actor arrives.
  expect(remaining).toBeGreaterThanOrEqual(durationMs - 1000);
  expect([...decision.faces].sort()).toEqual([...expectedCards].sort());
  expect(decision.faces).not.toEqual(frames[0].faces);
  for (const frame of frames) {
    expect(Math.abs(frame.feltTop! - frames[0].feltTop!)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.feltHeight! - frames[0].feltHeight!)).toBeLessThanOrEqual(1);
  }
  expect(
    frames.filter((frame) => frame.flight > 0).every((frame) => frame.hand === handLabel)
  ).toBe(true);
  const successor = frames.slice(frames.findIndex((frame) => frame.hand === handLabel));
  expect(successor.every((frame) => frame.hand === handLabel)).toBe(true);
  expect(
    successor.some((frame) => frame.flight === 30),
    'five rounds for six seats'
  ).toBe(true);
  expect(successor.every((frame) => !frame.flight || (!frame.faces.length && !frame.canAct))).toBe(
    true
  );
  const ready = frames.slice(first);
  for (const frame of ready) {
    expect(frame.faces).toEqual(decision.faces);
    expect(frame.canAct).toBe(true);
    expect(Math.abs(frame.panelTop! - decision.panelTop!)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.heroX! - decision.heroX!)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.rowX! - decision.rowX!)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.rowY! - decision.rowY!), 'hero card row top').toBeLessThanOrEqual(1);
    expect(Math.abs(frame.heroY! - decision.heroY!), 'hero seat top').toBeLessThanOrEqual(1);
  }
  return { decisionAt, observedRemainingMs: remaining, frames };
}
