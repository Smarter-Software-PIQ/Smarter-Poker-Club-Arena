import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { mountDiamondWheel } from '../helpers/diamond-wheel-fixture.mjs';
import { WHEEL_SPIN_MS } from '../../../src/utils/diamondWheelMotion';

type WheelProof = {
  finished: number;
  events: { event: string; title?: string; time: number }[];
  upgradeStates: {
    phase: string;
    expanded: string;
    selectors: number;
    titles: number;
    cards: number;
    slots: number;
    visible: boolean;
    scale: string;
    finished: number;
    destination: string;
  }[];
};
declare global {
  interface Window {
    wheelProof: WheelProof;
  }
}

test.use({ storageState: { cookies: [], origins: [] } });

async function insideViewport(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) =>
    elements.every((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= -1 && box.right <= innerWidth + 1;
    })
  );
}

for (const width of [320, 390, 1280]) {
  for (const kind of ['prize', 'bonus', 'upgrade', 'upgradechips'] as const) {
    test(`Diamond wheel ${kind} completes its reveal at ${width}px`, async ({ page }, testInfo) => {
      // The flow has player steps now (Play Game, Open Upgrade Wheel, the swipe
      // on the ring), each waited for at full length: give it a full minute.
      test.setTimeout(60_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const receipt = await mountDiamondWheel(page, kind, width);
      const wheel = page.getByRole('img', { name: 'Diamond Wheel', exact: true });
      const secondary = page.getByRole('img', { name: 'Upgrade Wheel', exact: true });
      // Sixty-four painted bands each decode an atlas texture on a canvas
      // before they mount as <image>. On a software-rendered CI runner that
      // takes longer than the 5s an assertion gets by default (measured
      // 2026-09-24: 64 -> 50 -> 46 -> 27 -> 4 still loading at the 5s mark),
      // and the test was failing on decode speed, not on the reveal it pins.
      // The decode wait carries its own budget, well inside the test's minute.
      await expect(page.locator('[data-painted-band="loading"]')).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(page.locator('[data-painted-band="cached"]')).toHaveCount(64);
      await expect(secondary.locator('[data-slot]')).toHaveCount(8);
      await expect(secondary).toBeVisible();
      await expect(secondary.locator('[data-wheel-selector]')).toHaveCount(0);
      await expect(secondary.locator('[data-card-design="title"]')).toHaveCount(8);
      await expect(secondary.locator('[data-card-design="full"]')).toHaveCount(0);
      await expect(page.locator('[data-wheel-assembly]')).toHaveAttribute(
        'data-upgrade-reveal',
        'peek'
      );
      await expect(wheel.locator('[data-wheel-face]')).toHaveCSS(
        'transform',
        'matrix(0.91, 0, 0, 0.91, 0, 0)'
      );
      await expect(wheel.locator('[data-wheel-selector]')).toHaveCount(1);
      await expect
        .poll(async () => (await wheel.boundingBox())?.width ?? 0)
        .toBeGreaterThanOrEqual(width - 24);
      const upperBox = await secondary.boundingBox();
      const lowerBox = await wheel.boundingBox();
      const controlsBox = await page
        .getByRole('complementary', { name: 'Diamond Spins Controls' })
        .boundingBox();
      expect(controlsBox!.y).toBeGreaterThanOrEqual(lowerBox!.y + lowerBox!.height);
      // Both independent rotors share one centre and one uninterrupted aperture.
      expect(upperBox).toEqual(lowerBox);
      await expect(page.locator('[data-wheel-assembly="concentric"]')).toHaveCount(1);
      await expect(secondary).toHaveAttribute('data-presentation', 'assembly');
      await expect(wheel).toHaveAttribute('data-presentation', 'assembly');
      await expect(secondary).toHaveAttribute('data-idle-direction', '-1');
      await expect(wheel).toHaveAttribute('data-idle-direction', '1');
      await expect(wheel.locator('[data-slot]')).toHaveCount(12);
      await expect(
        page.getByRole('region', { name: 'Wheel Prizes' }).getByRole('listitem')
      ).toHaveCount(12);
      expect(
        await insideViewport(page, '[aria-label="Diamond Wheel"], [aria-label="Wheel Prizes"] li')
      ).toBe(true);
      await expect(page.getByLabel('Diamonds To Spin')).toHaveValue(
        String(receipt.entry_value_diamonds)
      );
      for (const amount of ['25', '100', '500', '1,000', '2,500']) {
        const target = await page.getByRole('button', { name: amount, exact: true }).boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44);
        expect(target!.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: testInfo.outputPath(`wheel-idle-${width}.png`),
        fullPage: true,
      });
      // The rotor is a compositor layer: its idle drift is a Web Animation on
      // the transform, with no frame callback and no attribute behind it.
      const rotorRotation = () =>
        wheel.locator('[data-wheel-rotor]').evaluate((rotor) => getComputedStyle(rotor).transform);
      const idleRotation = await rotorRotation();
      expect(idleRotation).toMatch(/^matrix\(/);
      await expect.poll(rotorRotation).not.toBe(idleRotation);
      expect(
        await wheel.locator('[data-wheel-rotor]').evaluate((rotor) => rotor.getAnimations().length)
      ).toBe(1);
      await expect(wheel.locator('[data-wheel-rotor] svg [data-slot]')).toHaveCount(12);
      const plate = page.getByRole('button', { name: '100', exact: true });
      const spin = page.getByRole('button', { name: 'Preview Spin', exact: true });
      const geometry = async () => [await plate.boundingBox(), await spin.boundingBox()];
      const selected = page.getByRole('button', { name: '2,500', exact: true });
      await selected.click();
      const selectedAppearance = () =>
        selected.evaluate((button) => {
          const style = getComputedStyle(button);
          return [style.color, style.opacity, style.filter, style.backgroundImage];
        });
      const readyAppearance = await selectedAppearance();
      const resting = await geometry();
      await spin.hover();
      await page.mouse.down();
      expect(await geometry()).toEqual(resting);
      await page.mouse.up();
      await expect(spin).toBeDisabled();
      await expect(selected).toBeDisabled();
      expect(await selectedAppearance()).toEqual(readyAppearance);
      expect(await geometry()).toEqual(resting);

      await expect(page.getByRole('button', { name: 'Preview Spin', exact: true })).toBeDisabled();
      await expect(page.getByLabel('Diamonds To Spin')).toBeDisabled();
      await expect(page.getByTestId('destination')).toHaveText('/clubs/fixture/wheel');

      if (kind.startsWith('upgrade')) {
        // Owner ruling 2026-09-21 (R1, R19): the upgrade reveal waits for its
        // plate, and the ring then waits under a flashing instruction for the
        // player's own tap or swipe. Neither the reveal's animation end nor any
        // clock starts the second spin; the pins below tap and swipe it.
        const upgradeReveal = page.getByRole('dialog', { name: 'Bonus Upgrade' });
        await expect(upgradeReveal).toBeVisible({ timeout: WHEEL_SPIN_MS + 1400 + 650 });
        const openRing = upgradeReveal.getByRole('button', { name: 'Open Upgrade Wheel' });
        await expect(openRing).toBeEnabled({ timeout: WHEEL_SPIN_MS + 1400 + 650 });
        await page.evaluate(async () => {
          const opening = document.querySelector('[role="dialog"] [data-motion="keep"]')!;
          const duration = parseFloat(getComputedStyle(opening).animationDuration) * 1000;
          await new Promise((resolve) => setTimeout(resolve, duration));
        });
        await expect(upgradeReveal).toBeVisible();
        await openRing.click();
        await expect(upgradeReveal).toHaveCount(0);
        const ring = page.getByRole('button', { name: 'Swipe Or Tap The Wheel To Spin' });
        await expect(ring).toBeVisible();
        await expect(ring).toBeFocused();
        await expect(page.locator('[data-awaiting-upgrade] [role="status"]')).toHaveText(
          'Swipe Or Tap The Wheel To Spin'
        );
        // The ring has not turned by itself: no spinning upgrade state was
        // recorded, now or after a further wait. Read from the fixture's own
        // record, which follows the wheel wherever it carries its data-phase.
        const ringTurned = () =>
          page.evaluate(() => window.wheelProof.upgradeStates.some((s) => s.phase === 'spinning'));
        expect(await ringTurned()).toBe(false);
        await page.waitForTimeout(600);
        expect(await ringTurned()).toBe(false);
        await page.screenshot({ path: testInfo.outputPath(`wheel-awaiting-${width}.png`) });
        const box = (await ring.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
        await page.mouse.up();
        await expect(ring).toHaveCount(0);
        // The fixture runs at the player's 0.25 animation-speed setting. On a
        // software-rendered runner, sequential round trips can span the entire
        // secondary spin. Require all the same properties in ONE observed
        // rendered state, retained before the real game navigation removes it.
        await expect
          .poll(() => page.evaluate(() => window.wheelProof.upgradeStates), {
            timeout: WHEEL_SPIN_MS + 1400 + 650,
          })
          .toContainEqual({
            phase: 'spinning',
            expanded: 'open',
            selectors: 1,
            titles: 0,
            cards: 8,
            slots: 8,
            visible: true,
            scale: 'matrix(0.56, 0, 0, 0.56, 0, 0)',
            finished: 0,
            destination: '/clubs/fixture/wheel',
          });
      }
      if (kind === 'prize' || kind === 'upgradechips') {
        const dialog = page.getByRole('dialog');
        await expect(dialog).toHaveAttribute('aria-label', /Chips?$/);
        await expect(dialog).toBeVisible();
        const proceed = dialog.getByRole('button', { name: 'Continue', exact: true });
        await expect(proceed).toBeEnabled();
        expect(await insideViewport(page, '[role="dialog"], [role="dialog"] button')).toBe(true);
        await expect(proceed).toBeInViewport();
        const shell = await dialog.evaluate((el) => {
          const css = getComputedStyle(el);
          return [css.borderTopWidth, css.boxShadow, css.backgroundColor];
        });
        expect(shell).toEqual(['0px', 'none', 'rgba(0, 0, 0, 0)']);
        await expect(dialog).toBeVisible();
        expect(await page.evaluate(() => window.wheelProof.finished)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath(`wheel-prize-${width}.png`) });
        await proceed.click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByTestId('destination')).toHaveText('/clubs/fixture/wheel');
      } else {
        await expect(page.getByRole('heading', { name: 'Earned Game Entry' })).toBeVisible();
        await expect(page.getByTestId('destination')).toHaveText(
          `/clubs/fixture/${receipt.bonus.game}?wheelAward=${receipt.bonus.id}`
        );
      }
      if (!receipt.bonus) expect(await geometry()).toEqual(resting);
      const proof = await page.evaluate(() => window.wheelProof);
      expect(proof.finished).toBe(1);
      const starts = proof.events.filter((event) => event.event === 'animationstart');
      const ends = proof.events.filter((event) => event.event === 'animationend');
      expect(starts).toHaveLength(kind.startsWith('upgrade') ? 2 : 1);
      // Manual Continue can legitimately interrupt the entrance. An automatically
      // opened earned game must first show its landed prize.
      if (receipt.bonus) expect(ends).toHaveLength(starts.length);
      expect(proof.events.at(-1)?.event).toBe('finished');
      if (kind.startsWith('upgrade')) {
        expect(starts[0].title).toBe('Bonus Upgrade');
        expect(starts[1].time).toBeGreaterThan(ends[0].time);
        expect(starts[1].title).not.toBe('Bonus Upgrade');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(errors).toEqual([]);
      const proofPath = testInfo.outputPath('wheel-animation-proof.json');
      await writeFile(proofPath, JSON.stringify(proof, null, 2));
      await testInfo.attach('wheel-animation-proof', {
        path: proofPath,
        contentType: 'application/json',
      });
    });
  }
}

// Pin the actual page, including free entry choices, real global styles and
// the control panel. The old width-only wheel put Spin below the first screen.
for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 784, height: 1236 },
  { width: 390, height: 844 },
  { width: 393, height: 844 },
  { width: 1280, height: 720 },
  { width: 844, height: 390 },
  { width: 844, height: 390, fallbackFonts: true },
]) {
  test(`Diamond Spins controls share one screen at ${viewport.width}x${viewport.height}${'fallbackFonts' in viewport ? ' with fallback fonts' : ''}`, async ({
    page,
  }, testInfo) => {
    const { diamondWheelPageFixture } = await import('../helpers/diamond-wheel-page-fixture.mjs');
    const bundle = await diamondWheelPageFixture();
    await page.setViewportSize(viewport);
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'diamond-wheel.test') return route.abort();
      const publicPath = url.pathname.replace(/^\/hub\/club-arena\//, '/');
      if (
        publicPath.startsWith('/assets/') ||
        publicPath.startsWith('/fonts/') ||
        publicPath.startsWith('/images/') ||
        publicPath === '/default-avatar.png'
      ) {
        const { resolve, sep } = await import('node:path');
        const root = resolve('public');
        const path = resolve(root, '.' + decodeURIComponent(publicPath));
        return path.startsWith(root + sep) ? route.fulfill({ path }) : route.abort();
      }
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><div id="root"></div>',
      });
    });
    await page.goto('https://diamond-wheel.test/');
    await page.addStyleTag({ content: bundle.css });
    if ('fallbackFonts' in viewport) {
      await page.addStyleTag({
        content:
          '[aria-label="Diamond Spins Controls"] button {font-family: Arial, sans-serif !important}',
      });
    }
    await page.addScriptTag({ content: bundle.javascript });
    const controls = page.getByRole('complementary', { name: 'Diamond Spins Controls' });
    await expect(controls).toBeVisible();
    await controls.getByRole('button', { name: 'Use Diamonds', exact: true }).click();
    // Owner ruling 2026-09-21 (R1): there is no countdown plate to hold any more.
    await expect(
      controls.getByRole('button', { name: /Hold Automatic Spin|Auto Held/ })
    ).toHaveCount(0);
    await expect(page.locator('#global-header')).toBeVisible();
    const titleBadge = page
      .getByRole('heading', { name: 'Diamond Spins', exact: true })
      .getByRole('img');
    await expect(titleBadge).toBeVisible();
    await expect
      .poll(() => titleBadge.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(controls.getByText('Club Chips', { exact: true })).toBeVisible();
    await expect(controls.getByText('12,345.00', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spin 100', exact: true })).toBeEnabled();
    // Wait for the physical console art to decode through its published asset path.
    const deckLoaded = await controls.evaluate(async (el) => {
      const elements = [el, ...el.querySelectorAll('*')];
      for (const node of elements) {
        for (const pseudo of [null, '::before', '::after']) {
          const image = getComputedStyle(node, pseudo).backgroundImage;
          const url = image.match(/url\(["']?([^)"']*sapphire-spin-deck\.webp)["']?\)/)?.[1];
          if (url) {
            const art = new Image();
            art.src = url;
            await art.decode();
            return art.naturalWidth > 0;
          }
        }
      }
      return false;
    });
    expect(deckLoaded).toBe(true);
    const spinBounds = await controls
      .getByRole('button', { name: 'Spin 100', exact: true })
      .boundingBox();
    const walletBounds = await controls.locator('dl > div').first().boundingBox();
    const chipBounds = await controls.locator('dl > div').nth(1).boundingBox();
    const selector = controls.getByRole('button', { name: 'Choose Spin Amount' });
    const toggle = await selector.boundingBox();
    if (!spinBounds || !walletBounds || !chipBounds || !toggle)
      throw new Error('Missing wheel controls');
    await expect(controls.getByRole('button', { name: 'Max' })).toHaveCount(0);
    const headerAction = page.locator('header').getByRole('button', { name: 'Prizes & More' });
    const header = await titleBadge.locator('xpath=ancestor::header').boundingBox();
    const detailsButton = await headerAction.boundingBox();
    const badge = await titleBadge.boundingBox();
    const deck = await controls.locator('dl').locator('..').boundingBox();
    if (!header || !detailsButton || !badge || !deck)
      throw new Error('Wheel layout is unavailable');
    expect(detailsButton.x).toBeGreaterThanOrEqual(badge.x + badge.width);
    expect(detailsButton.y).toBeGreaterThanOrEqual(header.y);
    expect(detailsButton.y + detailsButton.height).toBeLessThanOrEqual(
      header.y + header.height + 1
    );
    expect(detailsButton.x + detailsButton.width).toBeGreaterThanOrEqual(
      header.x + header.width - 10
    );
    expect(walletBounds.x + walletBounds.width).toBeLessThanOrEqual(spinBounds.x);
    expect(chipBounds.x).toBeGreaterThanOrEqual(spinBounds.x + spinBounds.width);
    expect(Math.abs(chipBounds.y - walletBounds.y)).toBeLessThan(1);
    expect(toggle.x).toBeGreaterThanOrEqual(walletBounds.x);
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(walletBounds.x + walletBounds.width + 1);
    expect(toggle.y).toBeGreaterThanOrEqual(deck.y);
    expect(toggle.y + toggle.height).toBeLessThanOrEqual(deck.y + deck.height + 1);
    let lastCenter = 0;
    for (const name of ['25', '100', '500', '1,000', '2,500']) {
      const preset = await controls.getByRole('button', { name, exact: true }).boundingBox();
      if (!preset) throw new Error('Missing wheel preset ' + name);
      expect(preset.x + preset.width / 2).toBeGreaterThan(lastCenter);
      expect(preset.y + preset.height / 2).toBeLessThan(spinBounds.y + spinBounds.height / 2);
      lastCenter = preset.x + preset.width / 2;
    }
    const assertFits = async () => {
      const measured = await controls.evaluate((el) => {
        const wheel = document.querySelector('[data-wheel-assembly]')!.getBoundingClientRect();
        const controls = el.getBoundingClientRect();
        return {
          wheelHeight: wheel.height,
          wheelBottom: wheel.bottom,
          controlsTop: controls.top,
          bottom: controls.bottom,
          scrollHeight: document.documentElement.scrollHeight,
          scrollWidth: document.documentElement.scrollWidth,
          targets: [...el.querySelectorAll('button,input')]
            .filter((e) => e.getClientRects().length > 0)
            .map((e) => {
              const b = e.getBoundingClientRect();
              return (
                b.top >= 0 &&
                b.bottom <= innerHeight + 1 &&
                b.left >= 0 &&
                b.right <= innerWidth + 1 &&
                b.height >= 32
              );
            }),
        };
      });
      expect(measured.wheelHeight).toBeGreaterThan(100);
      expect(measured.controlsTop).toBeGreaterThanOrEqual(measured.wheelBottom - 1);
      expect(measured.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(measured.scrollHeight).toBeLessThanOrEqual(viewport.height + 1);
      expect(measured.scrollWidth).toBeLessThanOrEqual(viewport.width);
      expect(measured.targets.every(Boolean)).toBe(true);
      expect(
        await controls.locator('button').evaluateAll((elements) =>
          elements.flatMap((el) => {
            const button = el.getBoundingClientRect();
            if (!button.width) return [];
            const nodes = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const clipped = [];
            while (nodes.nextNode()) {
              const node = nodes.currentNode;
              if (!node.textContent?.trim()) continue;
              let parent = node.parentElement;
              while (parent && parent !== el) {
                const style = getComputedStyle(parent);
                if (style.clip !== 'auto' || style.clipPath === 'inset(50%)') break;
                parent = parent.parentElement;
              }
              // Screen-reader-only stake descriptions may extend outside the painted label.
              if (parent !== el) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              const text = range.getBoundingClientRect();
              if (
                text.left < button.left ||
                text.right > button.right ||
                text.top < button.top ||
                text.bottom > button.bottom
              ) {
                clipped.push({
                  label: node.textContent,
                  text: text.toJSON(),
                  button: button.toJSON(),
                });
              }
            }
            return clipped;
          })
        )
      ).toEqual([]);
    };
    await assertFits();
    await controls.getByRole('button', { name: '2,500', exact: true }).click();
    await expect(page.getByLabel('Diamonds To Spin')).toHaveValue('2500');
    await expect(page.getByRole('button', { name: 'Spin 2,500', exact: true })).toBeEnabled();
    await expect(
      controls.getByRole('button', { name: /Auto Spin|Run Off|Run (5|10|25)/ })
    ).toHaveCount(0);
    await expect(controls.getByText('Today', { exact: true })).toHaveCount(0);
    await assertFits();
    await controls.getByRole('button', { name: '500', exact: true }).click();
    await expect(page.getByLabel('Diamonds To Spin')).toHaveValue('500');
    await page.screenshot({ path: testInfo.outputPath('paid-controls.png') });
    await controls.getByRole('button', { name: 'Bonus Spins (2)', exact: true }).click();
    await expect(page.getByLabel('Diamonds To Spin')).toBeDisabled();
    await expect(controls.getByRole('button', { name: 'Bonus Spin', exact: true })).toBeEnabled();
    await assertFits();
    await headerAction.click();
    const details = page.getByRole('dialog', { name: 'Diamond Spins Details' });
    await expect(details).toBeVisible();
    await expect(
      details.getByRole('region', { name: 'Wheel Prizes' }).getByRole('listitem')
    ).toHaveCount(12);
    await expect(details.getByRole('heading', { name: 'Check Any Spin' })).toBeAttached();
    await expect(details.getByRole('heading', { name: 'History', exact: true })).toBeAttached();
    await details.getByRole('button', { name: 'Close Dialog' }).click();
    await expect(details).toHaveCount(0);
    await assertFits();
    await page.screenshot({ path: testInfo.outputPath('one-screen.png') });
    if (viewport.width === 320) {
      await page.goto('https://diamond-wheel.test/?paused');
      await page.addStyleTag({ content: bundle.css });
      await page.addScriptTag({ content: bundle.javascript });
      await expect(controls.getByText('Local Connection Is Paused', { exact: true })).toBeVisible();
      await expect(
        controls.getByRole('button', { name: 'Refresh Wheel', exact: true })
      ).toHaveCount(0);
      await expect(
        controls.getByRole('button', { name: 'Bonus Spin', exact: true })
      ).toBeDisabled();
      await assertFits();
      await page.screenshot({ path: testInfo.outputPath('one-screen-paused.png') });
    }
    if (viewport.width === 320) {
      await page.goto('https://diamond-wheel.test/');
      await page.addStyleTag({ content: bundle.css });
      await page.addScriptTag({ content: bundle.javascript });
    }
    await controls.getByRole('button', { name: 'Use Diamonds', exact: true }).click();
    await selector.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Diamonds To Spin')).toBeFocused();
    await controls.getByRole('button', { name: 'Max', exact: true }).click();
    await expect(page.getByLabel('Diamonds To Spin')).toHaveValue('2600000');
    const amountFits = await page
      .getByLabel('Diamonds To Spin')
      .evaluate((el: HTMLInputElement) => {
        const style = getComputedStyle(el);
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = style.font;
        const contentWidth =
          el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return context.measureText(el.value).width <= contentWidth;
      });
    expect(amountFits).toBe(true);
    await page.keyboard.press('Escape');
    await expect(selector).toBeFocused();
    await expect(
      controls.getByRole('button', { name: 'Spin 2,600,000', exact: true })
    ).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('full-wallet.png') });
    await selector.click();
    await page.getByLabel('Diamonds To Spin').fill('2600001');
    await page.keyboard.press('Escape');
    await expect(
      controls.getByText('Not Enough Diamonds For A Spin', { exact: true })
    ).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Spin 2,600,001', exact: true })).toHaveCount(
      0
    );
    await expect(controls.getByRole('button', { name: 'Get Diamonds', exact: true })).toBeVisible();
    await assertFits();
    await page.screenshot({ path: testInfo.outputPath('insufficient-wallet.png') });
  });
}
