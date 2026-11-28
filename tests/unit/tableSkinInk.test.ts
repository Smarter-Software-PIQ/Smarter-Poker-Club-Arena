/**
 * The two halves of the table's #SmarterDesign ink guard, pinned without a
 * browser (2026-11-28):
 *
 *   scripts/ci/check-table-skin-ink.mjs     the stylesheet rules (source)
 *   tests/e2e/support/tableSurfaces/inkAudit.ts   the colour arithmetic the
 *     rendered spec (tests/e2e/css/table-surfaces-wear-smarterdesign.spec.ts)
 *     judges computed styles and painted pixels with.
 *
 * Each case is a regression that shipped in the week of 2026-11-24, or the
 * shape of one: gold in a skin-scoped rule, an uppercase from a shared console
 * class, and #4a5462 ink on navy.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  ARTWORK_FILES,
  BASELINE,
  bannedBand as lintBand,
  scanStylesheet,
} from '../../scripts/ci/check-table-skin-ink.mjs';
import {
  backdropAt,
  bannedBand,
  contrast,
  contrastFindings,
  parseColor,
  requiredContrast,
  type TextSample,
} from '../e2e/support/tableSurfaces/inkAudit';

const rgb = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
  a: 1,
});

describe('the stylesheet rules', () => {
  it('finds gold that lives only in a skin-scoped rule', () => {
    const f = scanStylesheet(`.sc.sc--sd.sc--sd .bi__balance { color: #d6ad52; }`);
    expect(f.map((x) => x.rule)).toEqual(['hue']);
  });

  it('finds an uppercase transform and a :hover selector', () => {
    const f = scanStylesheet(
      `.sc--sd .sc-sd__plate-text { text-transform: uppercase; }\n.x:hover { opacity: 1; }`
    );
    expect(f.map((x) => x.rule).sort()).toEqual(['hover', 'upper']);
  });

  it('reads every literal form: hex, rgb, hsl and a named colour', () => {
    for (const value of [
      '#ffb800',
      'rgba(255, 184, 0, 0.4)',
      'hsl(45deg 90% 55%)',
      'gold',
      'violet',
    ])
      expect(scanStylesheet(`.a { border: 1px solid ${value}; }`), value).toHaveLength(1);
  });

  it('passes the #SmarterDesign palette', () => {
    const css = `.a { color: #86daff; background: linear-gradient(#087cfa, #0044ac 55%, #002b68);
      border-color: #9fbacc; box-shadow: 0 0 6px rgb(53 217 90 / 65%); } .b { color: #ff8a93; }`;
    expect(scanStylesheet(css)).toEqual([]);
  });

  it('ignores comments, and an attribute selector that matches gold to replace it', () => {
    const css = `/* was #ffd700, now ice */ .t[style*='#ffd700'] { --accent-color: #86daff; }`;
    expect(scanStylesheet(css)).toEqual([]);
  });

  it('exempts artwork from the hue rule only', () => {
    const css = `.chip { background: #e0b43c; text-transform: uppercase; }`;
    expect(scanStylesheet(css, { artwork: true }).map((x) => x.rule)).toEqual(['upper']);
  });

  it('treats a near-black with a warm cast as grey, not gold', () => {
    expect(lintBand(0x1a, 0x18, 0x14)).toBeNull();
  });

  it('holds the real tree to its baseline', () => {
    const run = spawnSync(process.execPath, ['scripts/ci/check-table-skin-ink.mjs'], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
  });

  it('freezes nothing: the baseline was cleared to zero on 2026-11-28', () => {
    expect(BASELINE).toEqual({});
  });

  it('exempts the seat artwork sheet and no UI stylesheet', () => {
    expect(ARTWORK_FILES['src/components/table/SeatArtwork.css']).toMatch(/note colour/);
    for (const ui of [
      'src/components/table/SeatSlot.css',
      'src/components/table/PotDisplay.css',
      'src/components/table/TournamentAnnouncementOverlay.css',
    ])
      expect(ARTWORK_FILES, ui).not.toHaveProperty([ui]);
  });
});

describe('the rendered audit arithmetic', () => {
  it('names the banned bands and leaves ice, silver, cobalt, green and red alone', () => {
    expect(bannedBand(rgb('#e0b43c'))).toBe('orange/gold/yellow');
    expect(bannedBand(rgb('#9b59d0'))).toBe('purple/violet/pink/magenta');
    for (const ok of ['#86daff', '#74dfff', '#9fbacc', '#087cfa', '#4dc660', '#ff8a93', '#f4f8ff'])
      expect(bannedBand(rgb(ok)), ok).toBeNull();
  });

  it('parses computed colour strings in both syntaxes', () => {
    expect(parseColor('rgba(255, 255, 255, 0.4)')).toEqual({ r: 255, g: 255, b: 255, a: 0.4 });
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it('fails #4a5462 on navy and passes silver on the same navy', () => {
    const navy = rgb('#0b1a2b');
    expect(contrast(rgb('#4a5462'), navy)).toBeLessThan(4.5);
    expect(contrast(rgb('#9fbacc'), navy)).toBeGreaterThan(4.5);
  });

  it('uses the large-text threshold at 18px, or 14px bold', () => {
    expect(requiredContrast(13, 700)).toBe(4.5);
    expect(requiredContrast(14, 700)).toBe(3);
    expect(requiredContrast(18, 400)).toBe(3);
  });

  it('reads the backdrop as the median pixel, so a hairline beside the word does not move it', () => {
    // 10x1 strip: nine navy pixels and one white hairline.
    const raw = new Uint8Array(30);
    for (let i = 0; i < 10; i += 1) raw.set(i === 9 ? [255, 255, 255] : [11, 26, 43], i * 3);
    expect(backdropAt(raw, 10, 1, 3, { x: 0, y: 0, w: 10, h: 1 })).toEqual({
      r: 11,
      g: 26,
      b: 43,
      a: 1,
    });
  });

  it('reports low contrast and skips a disabled control', () => {
    const raw = new Uint8Array(12).fill(0);
    for (let i = 0; i < 4; i += 1) raw.set([11, 26, 43], i * 3);
    const sample = (disabled: boolean): TextSample => ({
      where: 'span',
      text: 'SN: 1',
      ink: rgb('#4a5462'),
      fontSizePx: 11,
      fontWeight: 400,
      disabled,
      rect: { x: 0, y: 0, w: 4, h: 1 },
    });
    const out = contrastFindings([sample(false), sample(true)], raw, 4, 1, 3);
    expect(out.checked).toBe(1);
    expect(out.skipped).toBe(1);
    expect(out.findings).toHaveLength(1);
  });
});
