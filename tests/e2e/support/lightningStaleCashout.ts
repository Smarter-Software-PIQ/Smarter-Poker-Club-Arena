import { expect, type Page } from '@playwright/test';

/** The tab confirmed a leave from A. The seat is reused by B after that read
 * but before the engine receives the request. An occupancy alone cannot
 * distinguish these two sessions. Every monetary request is intercepted. */
export async function verifyLightningStaleCashout(
  page: Page,
  expected: { tableId: string; seatNumber: number; occupancyId: string; poolSessionId: string }
) {
  const requests: { path: string; body: unknown }[] = [];
  const leaves = /\/leave(?:-lightning)?-occupancy(?:\?.*)?$/;
  const status = '**/rpc/fn_my_hit_run_status';
  await page.route(status, (route) =>
    route.fulfill({
      json: [
        {
          table_id: expected.tableId,
          hands_remaining: 3,
          hands_required: 10,
          hands_played: 7,
        },
      ],
    })
  );
  const preaction = 'https://engine.smarter.poker/preaction';
  await page.route(preaction, (route) => {
    const body = route.request().postDataJSON();
    if (body.tableId !== expected.poolSessionId || body.action !== 'auto_fold' || !body.handId)
      return route.fallback();
    return route.fulfill({ json: { success: true } });
  });
  await page.route(leaves, (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
    return route.fulfill({
      status: 409,
      json: {
        ...expected,
        protocol: 'seat-occupancy-v1',
        success: false,
        immediate: false,
        code: 'STALE_OCCUPANCY',
        error: 'Could not confirm this room and seat.',
      },
    });
  });
  try {
    await page.getByRole('button', { name: 'Table Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Leave Table', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Leave', exact: true });
    const generic = page.getByRole('button', { name: 'Leave Table', exact: true });
    await expect(confirm.or(generic)).toBeVisible();
    if (await generic.isVisible()) await generic.click();
    await confirm.click();
    await expect
      .poll(() => requests)
      .toEqual([
        {
          path: '/leave-lightning-occupancy',
          body: { ...expected, confirmHandCount: true },
        },
      ]);
    await expect(page.getByText(/Could not confirm this room and seat/i).first()).toBeVisible();
  } finally {
    await page.unroute(preaction);
    await page.unroute(leaves);
    await page.unroute(status);
  }
}
