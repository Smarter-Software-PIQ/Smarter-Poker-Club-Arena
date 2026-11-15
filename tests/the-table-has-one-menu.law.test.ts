/**
 * THE TABLE HAS ONE MENU, AND EVERY ROW IN IT IS ANSWERED (2026-11-14).
 *
 * TablePage carried its own TableMenu behind `embeddedTableId ? null :`. Every
 * table is drawn by MultiTablePage with `embeddedTableId`, so that menu was
 * never on screen, and it kept collecting work: Straddle was "restored" into
 * it on 2026-09-15 and stayed unreachable, Club Marketplace and the
 * tournament Add-On row lived only there, and five tests pinned its rows as
 * though players could press them.
 *
 * The menu is the tab bar's. These keep it the only one, and keep every row it
 * can emit wired to something that answers.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sliceCall, sliceStatement } from './helpers/sourceWindow';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const TABLE_PAGE = code('src/pages/TablePage.tsx');
const BAR = code('src/components/table/TableTabBar.tsx');
const MENU = code('src/components/table/TableMenu.tsx');
const MULTI = code('src/pages/MultiTablePage.tsx');

function allTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allTsx(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('one menu', () => {
  it('the table page renders no TableMenu of its own', () => {
    expect(TABLE_PAGE).not.toMatch(/<TableMenu\b/);
    expect(TABLE_PAGE).not.toMatch(/from '\.\.\/components\/table\/TableMenu'/);
  });

  it('every table is mounted embedded, by the multi-table page and nothing else', () => {
    const mounts = allTsx(resolve(ROOT, 'src'))
      .filter((f) => !f.endsWith('src/pages/TablePage.tsx'))
      .flatMap((f) => {
        const src = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        return (src.match(/<TablePage\b[^>]*?embeddedTableId=|<TablePage\b/g) ?? []).map(
          (m) =>
            `${f.slice(ROOT.length + 1)} ${m.includes('embeddedTableId=') ? 'embedded' : 'BARE'}`
        );
      });
    expect(mounts.length).toBeGreaterThan(0);
    expect(mounts.filter((m) => !m.startsWith('src/pages/MultiTablePage.tsx'))).toEqual([]);
    expect(mounts.filter((m) => m.endsWith('BARE'))).toEqual([]);
  });
});

describe('every row is answered', () => {
  const emitted = Array.from(
    new Set(Array.from(BAR.matchAll(/action: '([A-Z_]+)'/g)).map((m) => m[1]))
  );

  it('the tab bar emits a known set of actions', () => {
    expect(emitted.length).toBeGreaterThan(10);
    expect(emitted).toContain('TOGGLE_STRADDLE');
    expect(emitted).toContain('CLUB_MARKETPLACE');
  });

  it.each(emitted)('%s has a handler in the table page or the multi-table page', (action) => {
    const answered =
      new RegExp(`case '${action}':|event\\.action === '${action}'`).test(TABLE_PAGE) ||
      new RegExp(`'${action}'`).test(MULTI);
    expect(answered, `${action} is emitted by the menu and answered by nothing`).toBe(true);
  });

  it('every handler the tab bar passes is placed on a row', () => {
    const call = sliceCall(BAR, 'createDefaultMenuSections(');
    const passed = Array.from(
      new Set(Array.from(call.matchAll(/\b(on[A-Z]\w+)\b\s*[:,]/g)).map((m) => m[1]))
    );
    expect(passed.length).toBeGreaterThan(10);
    const builder = sliceStatement(MENU, 'export function createDefaultMenuSections(');
    const rows = builder.slice(builder.indexOf('return ['));
    for (const handler of passed) {
      expect(rows, `${handler} is passed to the menu and used by no row`).toMatch(
        new RegExp(`handlers\\.${handler}\\b`)
      );
    }
  });
});

describe('what the rows show is reported by the table page', () => {
  it.each([
    ['standUpNextBB', /onTableInfoUpdate\?\.\(\{ standUpNextBB \}\)/],
    ['straddleAvailable', /straddleAvailable: isStraddleAvailable/],
    ['straddleEnabled', /straddleEnabled: isStraddleEnabled/],
    ['leaveNextHandQueued', /onTableInfoUpdate\?\.\(\{ leaveNextHandQueued \}\)/],
    ['isAutoRebuyEnabled', /onTableInfoUpdate\?\.\(\{ isAutoRebuyEnabled \}\)/],
  ])('%s travels page -> tab -> menu', (field, report) => {
    expect(TABLE_PAGE).toMatch(report);
    expect(MULTI).toMatch(new RegExp(`${field}: t\\.${field}`));
    expect(BAR).toMatch(new RegExp(`\\?\\.${field}\\b`));
  });
});
