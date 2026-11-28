/**
 * TWO AXE FAILURES ON CONVERTED PAGES (2026-11-28)
 *
 * An axe WCAG 2 A/AA audit of every #SmarterDesign page in the render harness
 * found two defects:
 *
 * 1. Player Management, critical aria-required-children: the directory is
 *    role="list" named "Club Member Directory", and its error states put a
 *    role="alert" straight inside it. A list may only own list items. Every
 *    state shown in place of the rows now sits in one role="listitem", so the
 *    list keeps its role and name (which many specs select it by) in every
 *    state.
 * 2. Club Settings (Audit Log), serious color-contrast: the action filters
 *    used --text-muted (#6b7280) on #111827, 3.66:1, under the 4.5:1 AA needs
 *    for a 16px label. They use --text-secondary (7.5:1).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/ClubMembersPage.tsx', 'utf8');
const auditCss = readFileSync('src/components/admin/AuditLog.css', 'utf8');

function directoryBody(): string {
  const start = page.indexOf('className="members-list"');
  expect(start).toBeGreaterThan(0);
  const end = page.indexOf('ref={virtual.containerRef}', start);
  expect(end).toBeGreaterThan(start);
  return page.slice(start, end);
}

describe('the player directory owns only list items', () => {
  it('is still the named list', () => {
    const body = directoryBody();
    expect(body).toMatch(/role="list"/);
    expect(body).toMatch(/aria-label="Club Member Directory"/);
  });

  it('wraps every state shown in place of the rows in a list item', () => {
    const body = directoryBody();
    const alerts = body.match(/role="alert"/g) ?? [];
    expect(alerts.length).toBe(3);
    const items = body.match(/<div role="listitem">/g) ?? [];
    // loading, not found, access denied, load error, empty
    expect(items.length).toBe(5);
    for (const state of [
      '<PageSkeleton variant="list" />',
      'We Could Not Find That Club.',
      'This Roster Is Available Only To Approved Club Members.',
      'Could Not Load The Roster.',
      '<EmptyRoster',
    ]) {
      const at = body.indexOf(state);
      expect(at, state).toBeGreaterThan(0);
      const opened = body.lastIndexOf('<div role="listitem">', at);
      const closedBetween = body.slice(opened, at).match(/\) : /);
      expect(opened, `${state} is inside a list item`).toBeGreaterThan(0);
      expect(closedBetween, `${state} shares a branch with its list item`).toBeNull();
    }
  });
});

describe('the empty-state lines read at AA contrast', () => {
  it.each(['src/components/admin/AuditLog.css', 'src/components/admin/PlayerSearch.css'])(
    '%s',
    (file) => {
      const rule = readFileSync(file, 'utf8').match(/\.empty-state p \{[^}]*\}/)?.[0] ?? '';
      const colors = [...rule.matchAll(/^\s*color:\s*([^;]+);/gm)].map((m) => m[1].trim());
      expect(colors).toEqual(['var(--text-secondary)']);
    }
  );
});

describe('the audit log filters read at AA contrast', () => {
  it('labels inactive filters with --text-secondary, not --text-muted', () => {
    const rule = auditCss.match(/\.action-filters button \{[^}]*\}/)?.[0] ?? '';
    const colors = [...rule.matchAll(/^\s*color:\s*([^;]+);/gm)].map((m) => m[1].trim());
    expect(colors).toEqual(['var(--text-secondary)']);
  });
});
