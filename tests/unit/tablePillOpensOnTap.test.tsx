/**
 * Dan 2026-11-13: "YOU SHOULDN'T HAVE TO HOLD DOWN THE ACTION PILL ON MOBILE
 * TO OPEN IT, CHANGE IT TO 'TAP TO OPEN' FUNCTIONALITY." A tap on the pill of
 * the table you are at opens its menu, a second tap closes it, and a tap on
 * another table's pill still switches tables.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bar = readFileSync(resolve(__dirname, '../../src/components/table/TableTabBar.tsx'), 'utf8');

describe('the table pill opens on a tap', () => {
  it('a tap on the active pill toggles its menu; another pill still switches tables', () => {
    const fn = bar.slice(bar.indexOf('const handleTabClick = useCallback('));
    const body = fn.slice(0, fn.indexOf('[onTabSelect, activeTabId, quickMenu, openQuickMenu]'));
    expect(body).toMatch(/if \(tabId === activeTabId && anchor\) \{/);
    expect(body).toMatch(/if \(quickMenu\?\.tabId === tabId\) setQuickMenu\(null\);/);
    expect(body).toMatch(/else openQuickMenu\(tabId, anchor\.getBoundingClientRect\(\)\);/);
    expect(body.indexOf('openQuickMenu(tabId')).toBeLessThan(body.indexOf('onTabSelect(tabId)'));
  });
  it('the pill passes itself as the anchor, and long-press and right-click remain', () => {
    expect(bar).toContain(
      'onClick={(e) => handleTabClick(tab.id, e.currentTarget as HTMLElement)}'
    );
    expect(bar).toMatch(/longPressTimer = setTimeout\(\(\) => \{/);
    expect(bar).toMatch(/onContextMenu=\{\(e\) => \{[\s\S]{0,500}openQuickMenu\(tab\.id/);
  });
});
