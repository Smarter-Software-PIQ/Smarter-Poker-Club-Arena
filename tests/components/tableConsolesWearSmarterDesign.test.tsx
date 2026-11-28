/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE TABLE'S CONSOLES WEAR #SMARTERDESIGN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-27, on the Club Arena table: it "NEEDS THE SAME #SMARTERDESIGN
 * UPGRADE TO EVERY SINGLE PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE", and on
 * the painted console chassis: "NO DO NOT USE THOSE BULKY FRAMES, THATS THE
 * OLD STYLE... USE THE #SMARTERDESIGN STYLE."
 *
 * Every table popup (settings, buy-in, rules, hand history, leave, time
 * banks, results, the multi-table sheets) is a SpadeConsole. TablePage
 * provides the `smarter` material once, and React context follows a portal,
 * so a popup that renders into document.body still gets it. These tests pin
 * the three halves: the provider is in TablePage, a console under it carries
 * the material class (also through a portal), and a console outside it keeps
 * the painted chassis, so no surface off the table changed by accident.
 */
import { render } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConsoleMaterialProvider, SpadeConsole } from '../../src/components/console/SpadeConsole';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the table consoles wear #SmarterDesign', () => {
  it('TablePage provides the smarter material around every live table', () => {
    const src = read('src/pages/TablePage.tsx');
    expect(src).toContain('<ConsoleMaterialProvider value="smarter">');
    expect(src).toContain("import '../components/table/TableSmarterDesign.css';");
  });

  it('a console under the provider prints on the smarter material, through a portal too', () => {
    const { container } = render(
      <ConsoleMaterialProvider value="smarter">
        <SpadeConsole title="Table Settings" onClose={() => {}} />
        {createPortal(<SpadeConsole title="Buy-In" data-testid="portaled" />, document.body)}
      </ConsoleMaterialProvider>
    );
    expect(container.querySelector('.sc')?.className).toContain('sc--smarter');
    expect(document.querySelector('[data-testid="portaled"]')?.className).toContain('sc--smarter');
    // The X is still a labelled control.
    expect(container.querySelector('.sc__close')?.getAttribute('aria-label')).toBe('Close');
  });

  it('plates say which one is primary so the material can light it', () => {
    const { container } = render(
      <ConsoleMaterialProvider value="smarter">
        <SpadeConsole
          title="Leave Table?"
          plates={{
            secondary: { label: 'Leave', onClick: () => {} },
            primary: { label: 'Stay And Play', onClick: () => {} },
          }}
        />
      </ConsoleMaterialProvider>
    );
    const plates = [...container.querySelectorAll('.sc-plate')];
    expect(plates.map((p) => p.getAttribute('data-plate'))).toEqual(['secondary', 'primary']);
  });

  it('a console off the table keeps the painted chassis', () => {
    const { container } = render(<SpadeConsole title="Cashier" />);
    expect(container.querySelector('.sc')?.className).not.toContain('sc--smarter');
  });

  it('the material uses the arena workspace chrome, not a painted master', () => {
    const css = read('src/components/console/SpadeConsole.css');
    const smarter = css.slice(css.indexOf('#SMARTERDESIGN MATERIAL'));
    expect(smarter).toContain("url('../lobby/console-art/chrome-case.webp')");
    expect(smarter).toContain("url('../lobby/console-art/chrome-active.webp')");
    expect(smarter).not.toMatch(/club-buttons\/console/);
    // No gold, amber or yellow ink on the material (Dan 2026-10-17).
    expect(smarter).not.toMatch(/#ffd700|#fbbf24|#facc15|#f59e0b|#d29922/i);
  });
});
