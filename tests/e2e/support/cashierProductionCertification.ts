import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { inexactFigures } from './exact-figure';

// Chip wallets retain US grouping and exactly two decimals at every magnitude.
// Diamonds retain their separate whole-count and large-count contract.
const EXACT_WALLET = /^-?(?:0|[1-9]\d{0,2}(?:,\d{3})*)\.\d{2}$/;
const DIAMOND_WALLET = /^-?(?:0|[1-9]\d{0,2}(?:,\d{3})*)$/;
const LARGE_WALLET = /^-?([1-9]\d*(?:\.[1-9])?)([MB])$/;

function isCashierWalletFigure(
  value: string,
  kind: 'chips' | 'diamonds',
  options: { allowAbsentAgentFloat?: boolean } = {}
): boolean {
  // A successful read with no agents row is a documented empty wallet,
  // never an unavailable read. Only the Agent Wallet dialog uses this state.
  if (kind === 'chips' && options.allowAbsentAgentFloat && value === 'No Agent Float Yet')
    return true;
  if (kind === 'chips')
    return EXACT_WALLET.test(value) && Number.isFinite(Number(value.replace(/,/g, '')));
  const large = LARGE_WALLET.exec(value);
  if (large) {
    const magnitude = Number(large[1]);
    return Number.isFinite(magnitude) && (large[2] === 'B' || magnitude < 1_000);
  }
  if (!DIAMOND_WALLET.test(value)) return false;
  const magnitude = Math.abs(Number(value.replace(/,/g, '')));
  return magnitude < 1_000_000;
}

export async function attachCashierScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string
): Promise<void> {
  await testInfo.attach(`${name}-393px.png`, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  });
}

export async function expectCashierAxeClean(
  page: Page,
  testInfo: TestInfo,
  selector: string,
  name: string
): Promise<void> {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations
    .filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.flatMap((node) => node.target.map(String)),
    }));
  await testInfo.attach(`${name}-axe.json`, {
    body: JSON.stringify({ url: page.url(), violations }, null, 2),
    contentType: 'application/json',
  });
  expect(violations, `${name} has serious or critical Axe violations`).toEqual([]);
}

// Real figures are never rounded or abbreviated (owner ruling 2026-11-13,
// #10797). Every node that carries a figure must print an exact one: separators,
// cents kept, never K/M/B. The earlier rule here refused any decimal, which a
// correct exact figure now has. Only figure nodes are read, never the page text.
//
// `expected` is how many figure nodes there must be. Without it a change of
// markup would leave the locator empty and the check would pass on nothing
// (independent post-merge review of #10889, note 1).
export async function expectExactCashierFigures(
  figures: Locator,
  name: string,
  expected: number | readonly number[]
): Promise<void> {
  const texts = await figures.allInnerTexts();
  const allowed = typeof expected === 'number' ? [expected] : expected;
  expect(allowed, `${name}: ${texts.length} figure nodes found`).toContain(texts.length);
  expect(inexactFigures(texts), `${name} shows a figure that is not exact`).toEqual([]);
}

export function expectCashierWalletFigure(
  value: string,
  name: string,
  kind: 'chips' | 'diamonds' = 'chips',
  options: { allowAbsentAgentFloat?: boolean } = {}
): void {
  expect(
    isCashierWalletFigure(value.trim(), kind, options),
    `${name} is not a verified ${kind} wallet figure: ${JSON.stringify(value)}`
  ).toBe(true);
}

export async function expectCashierWalletBalance(
  value: Locator,
  name: string,
  kind: 'chips' | 'diamonds' = 'chips',
  options: { allowAbsentAgentFloat?: boolean } = {}
): Promise<void> {
  await expect(value, `${name} must identify one balance`).toHaveCount(1);
  await expect
    .poll(
      async () => {
        const figure = (await value.innerText()).trim();
        return { figure, valid: isCashierWalletFigure(figure, kind, options) };
      },
      { message: `${name} must print its verified ${kind} wallet balance` }
    )
    .toMatchObject({ valid: true });
}

export function expectCompactCashierFigure(value: string, name: string): void {
  expect(value.trim(), `${name} is not a no-cents compact chip figure`).toMatch(
    /^[-+]?(?:\d{1,3}(?:,\d{3})*|\d+(?:\.\d)?[KMB])$/
  );
}

export function cashierRosterWalletValue(label: Locator): Locator {
  return label.locator('..').locator('strong');
}

export function expectCashierAmountPresets(values: string[]): void {
  const labels = values.map((value) => value.trim());
  const isMax = (label: string) => /^max$/i.test(label);
  expect(labels.filter(isMax), 'Amount presets must include one MAX action').toHaveLength(1);
  const amounts = labels.filter((label) => !isMax(label));
  expect(amounts.length, 'Amount presets must include numeric choices').toBeGreaterThan(0);
  for (const amount of amounts) expectCompactCashierFigure(amount, 'Amount Preset');
}
