/**
 * THE TABLE ROOM IS BLURRED - LAW (Dan 2026-11-13, binding)
 *
 * Verbatim: "MAKE THE BACK GROUND BLURY LIKE THEY WERE BEFORE, I DON'T LIKE THE
 * CURRENT FULL FEATURE SIDE EFFECTS."
 *
 * The blur came from data-table glass leaking onto the gameplay
 * `.table-container`; #10763 removed the leak (it drew a seam above the
 * tournament dock) and the room went to full detail. The blur now lives on
 * its own full-page layer, so it is continuous behind the dock and never
 * touches the felt, cards or controls.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import postcss from 'postcss';

const read = (p: string) => readFileSync(resolve(__dirname, '../', p), 'utf8');

function declarations(css: string, selector: string) {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (rule.selector === selector) rule.walkDecls((d) => (out[d.prop] = d.value));
  });
  return out;
}

describe('the table room is blurred', () => {
  const css = read('src/pages/TablePage.css');
  const page = read('src/pages/TablePage.tsx');

  it('one full-page layer blurs the room exactly as before', () => {
    expect(declarations(css, '.table-room-blur')).toEqual({
      position: 'absolute',
      inset: '0',
      'z-index': '0',
      'pointer-events': 'none',
      background: 'rgba(255, 255, 255, 0.02)',
      '-webkit-backdrop-filter': 'blur(12px) saturate(1.3)',
      'backdrop-filter': 'blur(12px) saturate(1.3)',
    });
  });

  it('the layer sits under the felt, which stays unfiltered', () => {
    const container = declarations(css, '.table-container');
    expect(container['z-index']).toBe('1');
    expect(container['backdrop-filter']).toBeUndefined();
    expect(page).toContain('<div className="table-room-blur" aria-hidden="true" />');
  });
});
