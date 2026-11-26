import { expect, type Locator } from '@playwright/test';

/** Check the printed text itself: a grid cell can fit while its contents overlap. */
export async function expectStatsPanelLayout(panel: Locator) {
  await expect(panel).toBeVisible();
  await expect(panel.locator(':scope > .stats-section-loading')).toHaveCount(0);
  const collisions = await panel.evaluate((root) => {
    const issues: string[] = [];
    const frame = root.getBoundingClientRect();
    if (frame.left < -1 || frame.right > document.documentElement.clientWidth + 1) {
      issues.push('Panel extends past the viewport');
    }
    const groups = [
      ['.stats-overview-grid .stat-row', '.stat-label-text, .hero-stat-sub, .row-value'],
      ['.cash-intel__decision', '.cash-intel__decision-name > *, .cash-intel__reading > *, button'],
    ];
    for (const [cardSelector, textSelector] of groups) {
      for (const card of root.querySelectorAll(cardSelector)) {
        const bounds = card.getBoundingClientRect();
        if (bounds.width === 0) continue;
        const pieces = Array.from(card.querySelectorAll(textSelector)).flatMap((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return Array.from(range.getClientRects())
            .filter((box) => box.width > 0 && box.height > 0)
            .map((box) => ({ box, element }));
        });
        for (const [index, { box, element }] of pieces.entries()) {
          if (box.left < bounds.left - 1 || box.right > bounds.right + 1) {
            issues.push('Outside card: ' + element.textContent);
          }
          for (const next of pieces.slice(index + 1)) {
            if (next.element === element) continue;
            const overlapX =
              Math.min(box.right, next.box.right) - Math.max(box.left, next.box.left);
            const overlapY =
              Math.min(box.bottom, next.box.bottom) - Math.max(box.top, next.box.top);
            if (overlapX > 1 && overlapY > 2) {
              issues.push(element.textContent + ' overlaps ' + next.element.textContent);
            }
          }
        }
      }
    }
    return issues;
  });
  expect(collisions, 'Every visible Stats figure, label and evidence action fits its card').toEqual(
    []
  );
}
