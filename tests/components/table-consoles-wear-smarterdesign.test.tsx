import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpadeConsole } from '../../src/components/console/SpadeConsole';
import { ConsoleSkinProvider } from '../../src/components/console/consoleSkin';

/**
 * #SmarterDesign on the table (Dan 2026-11-27): "NEEDS THE SAME #SMARTERDESIGN
 * UPGRADE TO EVERY SINGLE PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE". Every
 * table popup is a SpadeConsole, so the table layer provides the skin once and
 * the console renders the arena workspace dress: live lettering in flow, the X
 * as a chrome key, the plates as chrome keys with the primary lit.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('table consoles wear #SmarterDesign', () => {
  it('the table layer provides the smarterdesign skin around every table surface', () => {
    const layer = read('src/components/table/PersistentTableLayer.tsx');
    // The provider stays out of the entry chunk: the layer lazy-loads the surface.
    expect(layer).toMatch(/import\('\.\.\/\.\.\/pages\/MultiTableSurface'\)/);
    expect(layer).not.toMatch(/ConsoleSkinProvider/);
    const surface = read('src/pages/MultiTableSurface.tsx');
    expect(surface).toMatch(/<ConsoleSkinProvider value="smarterdesign">\s*<MultiTablePage \/>/);
  });

  it('inside the provider a console prints its head, body and plates in flow', () => {
    const onClose = vi.fn();
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const { container } = render(
      <ConsoleSkinProvider value="smarterdesign">
        <SpadeConsole
          eyebrow="Table"
          title="Leave Table"
          subtitle="Your Stack Returns To Your Wallet"
          pill="Cash"
          onClose={onClose}
          plates={{
            secondary: { label: 'Stay', onClick: onSecondary },
            primary: { label: 'Leave', onClick: onPrimary },
          }}
        >
          <p>Body</p>
        </SpadeConsole>
      </ConsoleSkinProvider>
    );
    const root = container.querySelector('.sc') as HTMLElement;
    expect(root.dataset.consoleSkin).toBe('smarterdesign');
    expect(root.classList.contains('sc--sd')).toBe(true);
    // No measured zones: nothing is absolutely placed from the painted master.
    expect(container.querySelector('.sc-zone')).toBeNull();
    expect(container.querySelector('[style*="left:"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Leave Table' })).toBeTruthy();
    expect(root.textContent).toContain('Table Leave Table');

    fireEvent.click(screen.getByTestId('sc-close'));
    expect(onClose).toHaveBeenCalledTimes(1);

    const primary = screen.getByRole('button', { name: 'Leave' });
    const secondary = screen.getByRole('button', { name: 'Stay' });
    expect(primary.className).toContain('sc-sd__plate--primary');
    expect(secondary.className).toContain('sc-sd__plate--secondary');
    fireEvent.click(primary);
    fireEvent.click(secondary);
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('outside the provider the painted master is unchanged', () => {
    const { container } = render(<SpadeConsole title="Lobby" onClose={() => undefined} />);
    const root = container.querySelector('.sc') as HTMLElement;
    expect(root.dataset.consoleSkin).toBeUndefined();
    expect(root.classList.contains('sc--sd')).toBe(false);
    expect(container.querySelector('.sc-zone')).not.toBeNull();
  });

  it('the skin keeps a 44px close key and a solid case', () => {
    const css = read('src/components/console/SpadeConsole.css');
    const close = css.slice(css.indexOf('.sc.sc--sd.sc--sd .sc__close {'));
    expect(close).toMatch(/width: 44px;\s*height: 44px;/);
    expect(css).toMatch(/\.sc\.sc--sd\.sc--sd \{[\s\S]*?background: var\(--sd-panel\), #030b14;/);
    expect(css).toMatch(/chrome-case\.webp/);
  });

  it('survives the dialog resets: keys and head keep their chrome inside role="dialog"', () => {
    const css = read('src/components/console/SpadeConsole.css');
    const plate = css.slice(css.indexOf('.sc.sc--sd.sc--sd .sc-sd__plate {'));
    expect(plate.slice(0, plate.indexOf('}'))).toMatch(
      /border-image: var\(--sd-stat\)[^;]*!important;/
    );
    const close = css.slice(css.indexOf('.sc.sc--sd.sc--sd .sc__close {'));
    expect(close.slice(0, close.indexOf('}'))).toMatch(/background:[^;]*!important;/);
    expect(css).toMatch(
      /\.sc\.sc--sd\.sc--sd > \.sc__head\.sc__head \{[\s\S]*?box-shadow: none !important;/
    );
    const buyIn = read('src/components/table/BuyInModal.css');
    expect(buyIn).toMatch(
      /\.buy-in-modal\.buy-in-modal \.buy-in-modal__deck > \.sc-plate \{[\s\S]*?border-image:[^;]*!important;/
    );
  });
});
