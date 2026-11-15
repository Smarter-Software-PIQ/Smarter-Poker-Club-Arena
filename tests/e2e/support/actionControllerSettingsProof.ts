import { expect, type Locator } from '@playwright/test';

const SAVED_CONTROLLER = {
  color: 'green',
  preflop: [2.25, 2.8, 3.3, 4.5],
  postflop: [25, 33.33, 66.67, 125],
};

/** Reserved-account production proof. No action, buy-in or chip movement occurs. */
export async function verifyPublishedControllerSettings(
  settings: Locator,
  readSaved: () => Promise<unknown>
) {
  const controller = settings.getByRole('region', { name: 'Action Controller', exact: true });
  await expect(controller).toBeVisible();
  await expect(controller.locator('.action-controller-colors button')).toHaveCount(6);
  expect(
    await controller
      .locator('.action-controller-mini')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-controller-color')))
  ).toEqual(['blue', 'green', 'navy', 'platinum', 'gold', 'teal']);
  await controller.getByRole('button', { name: 'Casino Emerald', exact: true }).click();
  for (const [group, values] of [
    ['Preflop Multipliers', SAVED_CONTROLLER.preflop],
    ['Postflop Pot Percentages', SAVED_CONTROLLER.postflop],
  ] as const) {
    for (let index = 0; index < 4; index++) {
      await controller
        .getByLabel(`${group} Option ${index + 1}`, { exact: true })
        .fill(String(values[index]));
    }
    await controller.getByRole('button', { name: `Apply ${group}`, exact: true }).click();
  }
  await expect.poll(readSaved, { timeout: 60_000 }).toEqual(SAVED_CONTROLLER);
  await expectPublishedControllerSettings(settings);
}

export async function expectPublishedControllerSettings(settings: Locator) {
  const controller = settings.getByRole('region', { name: 'Action Controller', exact: true });
  await expect(
    controller.getByRole('button', { name: 'Casino Emerald', exact: true })
  ).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  for (const [group, values] of [
    ['Preflop Multipliers', SAVED_CONTROLLER.preflop],
    ['Postflop Pot Percentages', SAVED_CONTROLLER.postflop],
  ] as const) {
    for (let index = 0; index < 4; index++) {
      await expect(
        controller.getByLabel(`${group} Option ${index + 1}`, { exact: true })
      ).toHaveValue(String(values[index]));
    }
  }
}
