import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the member ledger visit local and initializes its query and both dates from one Chicago day', () => {
  const page = readFileSync('src/pages/MemberManagementPage.tsx', 'utf8');
  expect(page).not.toContain('usePlayerPreference');
  expect(page).toContain('useState(() => lastDaysRange(1))');
  expect(page).toContain("useState<RangeMode>('custom')");
  expect(page).toContain('useState(initialRange.from)');
  expect(page).toContain('useState(initialRange.to)');
  expect(page).toContain('useState<MemberRange>(initialRange)');
  const door = readFileSync('src/pages/ClubMemberDoor.tsx', 'utf8');
  expect(door).toContain('<MemberManagementPage key={`${clubId}:${userId}`} />');
});

it('never lets the published-page spec expect Overall on a visit that opens on today', () => {
  // #10579 moved the default from Overall to today and left two stale
  // "Recorded Activity" expectations in the production spec; Post-Deploy E2E
  // then failed every run (operational alert 371597). An Overall caption may
  // be expected only after the spec has pressed the Overall control itself.
  const spec = readFileSync('tests/e2e/production-club-members.spec.ts', 'utf8');
  const assertion =
    /name: 'Displayed Activity Scope' \}\)\)\.toContainText\(\s*([`'"])([\s\S]*?)\1\s*\)/g;
  const overallPress = /getByRole\('button', \{ name: 'Overall'/g;
  const presses = [...spec.matchAll(overallPress)].map((m) => m.index ?? 0);
  const found = [...spec.matchAll(assertion)];
  expect(found.length).toBeGreaterThan(0);
  for (const m of found) {
    if (!/Recorded Activity/.test(m[2])) continue;
    const at = m.index ?? 0;
    expect(
      presses.some((p) => p < at),
      `Overall caption expected at offset ${at} without pressing Overall first`
    ).toBe(true);
  }
});
