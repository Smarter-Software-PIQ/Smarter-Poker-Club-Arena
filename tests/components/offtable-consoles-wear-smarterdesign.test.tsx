import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleSkinProvider } from '../../src/components/console/SpadeConsole';
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
      /import \{ ConsoleSkinProvider \} from '\.\/components\/console\/SpadeConsole';/
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

  it('the provider adds no new module to first paint: the skin lives in SpadeConsole', () => {
    const baseline = read('scripts/ci/entry-chunk-baseline.json');
    expect(baseline).toContain('src/components/console/SpadeConsole.tsx');
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
