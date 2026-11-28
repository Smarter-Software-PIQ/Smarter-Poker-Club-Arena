import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #SmarterDesign on the table overlays that are not consoles (Dan 2026-11-27):
 * tournament announcements, the maintenance break, spectators, the emoji
 * picker, Share As Video, the bomb pot lettering and the Lightning notices.
 * Each carries a #SMARTERDESIGN block in its own stylesheet; no block may set
 * `animation` (animation law) and none may print gold or yellow text.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const block = (file: string) => {
  const css = read(file);
  const at = css.indexOf('#SMARTERDESIGN (Dan 2026-11-27)');
  expect(at, `${file} has a #SMARTERDESIGN block`).toBeGreaterThan(-1);
  return css.slice(at);
};

const FILES = [
  'src/components/table/TournamentAnnouncementOverlay.css',
  'src/components/table/MaintenanceBreakScreen.css',
  'src/components/table/SpectatorOverlay.css',
  'src/components/table/EmojiPicker.css',
  'src/components/table/ShareHand.css',
  'src/components/table/BombPotOverlay.css',
  'src/components/table/LightningFoldBar.css',
];

describe('table overlays wear #SmarterDesign', () => {
  it.each(FILES)('%s uses the chrome art and never touches an animation', (file) => {
    const css = block(file);
    expect(css).toMatch(
      /\/assets\/club-buttons\/console\/smarterdesign-v1\/chrome-(case|row|stat|readout|active)\.webp/
    );
    expect(css).not.toMatch(/(^|[;{\s])animation(-[a-z]+)?\s*:/m);
    expect(css).not.toMatch(/:hover/);
    // The announcement re-inks the warm accents by matching them in a
    // `[style*='...']` selector; only a colour that would be painted counts.
    const painted = css.replace(/\[style\*='[^']*'\]/g, '');
    expect(painted).not.toMatch(/#ffd700|#d6ad52|#ffb020|#fff2b8|#fbbf24/i);
  });

  it('every close key in these overlays is a 44px chrome key that survives the dialog resets', () => {
    const maint = block('src/components/table/MaintenanceBreakScreen.css');
    expect(maint).toMatch(
      /\.maintenance-break__close\.maintenance-break__close \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?border-image:[^;]*!important;/
    );
    const spect = block('src/components/table/SpectatorOverlay.css');
    expect(spect).toMatch(
      /\.so-panel__close\.so-panel__close \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?border-image:[^;]*!important;/
    );
    const join = block('src/components/table/LightningFoldBar.css');
    expect(join).toMatch(
      /\.lightning-joining__cancel\.lightning-joining__cancel \{[\s\S]*?min-height: 44px;/
    );
  });

  it('the announcement accents are ice blue at their source, with no override left', () => {
    // 2026-11-28: the accents used to be brass and gold in the component and
    // re-inked by a `[style*='#ffd700']` override; the component now carries
    // the tokens itself, so neither the gold nor the override may come back.
    const tsx = read('src/components/table/TournamentAnnouncementOverlay.tsx');
    const accents = [...tsx.matchAll(/^\s*color: '([^']+)',$/gm)].map((m) => m[1]);
    expect(accents.length).toBeGreaterThanOrEqual(7);
    for (const a of accents) expect(a).not.toMatch(/#ffd700|#d6ad52|#ffb020|#fbbf24/i);
    expect(accents).toContain('var(--sd-ice)');
    expect(accents).toContain('var(--sd-ice-strong)');
    const css = read('src/components/table/TournamentAnnouncementOverlay.css');
    expect(css).not.toMatch(/\[style\*=/);
    expect(css).not.toMatch(/#ffd700|#d6ad52|214 173 82/i);
  });
});
