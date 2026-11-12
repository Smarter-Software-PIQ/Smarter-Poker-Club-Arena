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
