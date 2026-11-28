import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleSkinProvider } from '../../src/components/console/consoleSkin';
import { ConfirmModal } from '../../src/components/common/ConfirmModal';
import PlayerBlockModal from '../../src/components/social/PlayerBlockModal';
import { PlayerNoticeModal } from '../../src/components/notices/PlayerNoticeModal';

/**
 * #SmarterDesign everywhere (Dan 2026-11-27): "THE SAME #SMARTERDESIGN UPGRADE
 * TO EVERY SINGLE PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE". The table got it
 * first (MultiTableSurface); every console off the table - lobby, club home,
 * profile, achievements, cashier, tournaments, settings and the root-mounted
 * modals - gets it from one provider at the app root.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('consoles off the table wear #SmarterDesign', () => {
  it('the app root provides the smarterdesign skin around every route and root modal', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(
      /import \{ ConsoleSkinProvider \} from '\.\/components\/console\/consoleSkin';/
    );
    expect(app).toMatch(
      /<ConsoleSkinProvider value="smarterdesign">\s*<ClubBrandRedirect \/>\s*<FullApp \/>\s*<\/ConsoleSkinProvider>/
    );
    // The table keeps its own provider too, so a table surface never depends on
    // where the layer is mounted.
    expect(read('src/pages/MultiTableSurface.tsx')).toMatch(
      /<ConsoleSkinProvider value="smarterdesign">/
    );
  });

  it('the skin module is a reviewed first-paint addition and SpadeConsole exports only components', () => {
    expect(read('scripts/ci/entry-chunk.d/feat-smarterdesign-offtable-consoles.json')).toContain(
      'src/components/console/consoleSkin.ts'
    );
    expect(read('src/components/console/SpadeConsole.tsx')).not.toMatch(/createContext/);
  });

  it('a confirm, a block and a notice dialog all render in the workspace dress', () => {
    const n = vi.fn();
    const { container } = render(
      <ConsoleSkinProvider value="smarterdesign">
        <ConfirmModal
          isOpen
          onConfirm={n}
          onCancel={n}
          title="Leave Club"
          message="Are You Sure?"
        />
        <PlayerBlockModal playerName="Twin2983" onConfirm={n} onCancel={n} />
        <PlayerNoticeModal
          notice={{
            id: 'n1',
            slug: 's',
            title: 'Notice',
            body: 'Tables Pause Tonight.',
            ok_label: 'Got It',
          }}
          onAcknowledge={n}
        />
      </ConsoleSkinProvider>
    );
    const consoles = [...document.body.querySelectorAll('.sc')] as HTMLElement[];
    expect(consoles.length).toBeGreaterThanOrEqual(3);
    for (const c of consoles) {
      expect(c.dataset.consoleSkin).toBe('smarterdesign');
      expect(c.classList.contains('sc--sd')).toBe(true);
    }
    expect(container.querySelector('.sc-zone')).toBeNull();
  });
});
