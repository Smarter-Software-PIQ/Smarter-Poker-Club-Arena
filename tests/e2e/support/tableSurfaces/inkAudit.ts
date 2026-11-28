/**
 * THE RENDERED INK AUDIT for the table's #SmarterDesign surfaces.
 *
 * Runs inside the browser, on COMPUTED styles, so it sees what a player sees:
 * a gold that lives only in a skin-scoped rule, an uppercase that arrives from
 * a shared console class, a near-invisible #4a5462 on navy. Source-text tests
 * missed all three in the week of 2026-11-24 because the offending rule was
 * never in the file they read.
 *
 * Pure functions (colour parsing, hue, contrast) are exported so the unit test
 * tests/unit/tableSurfaceInkAudit.test.ts can pin the arithmetic without a
 * browser; `auditSurface` is the browser half, bundled into the spec's page.
 */

export type Rgba = { r: number; g: number; b: number; a: number };

/**
 * The banned UI hue bands (Dan's #SmarterDesign palette: never yellow, gold,
 * amber, orange, purple, violet, lavender, pink or magenta in UI ink, borders
 * or fills). 20-70 degrees is orange through gold to yellow; 260-345 is violet
 * through magenta to pink. Red (345-20) and green stay legal for real wins,
 * losses, success and errors.
 */
export const BANNED_HUE_BANDS: ReadonlyArray<readonly [number, number, string]> = [
  [20, 70, 'orange/gold/yellow'],
  [260, 345, 'purple/violet/pink/magenta'],
];

/** Below this HSL saturation, or this chroma, a colour reads as grey/navy and
 *  its hue is noise (a #1a1814 near-black has a "gold" hue no eye can see). */
export const SATURATION_FLOOR = 0.18;
export const CHROMA_FLOOR = 0.1;
/** A colour this transparent paints nothing worth judging. */
export const ALPHA_FLOOR = 0.15;

/**
 * ARTWORK, NOT INK. Each entry is a subtree the audit does not judge, with the
 * reason. Keep this short: every line is a place a regression could hide.
 */
export const ARTWORK_EXEMPTIONS: ReadonlyArray<{ selector: string; reason: string }> = [
  {
    selector: 'img, svg image, picture, canvas, video',
    reason: 'raster and canvas artwork carries its own colours',
  },
  {
    selector:
      '.card-image, .playing-card, [class*="card-face"], [class*="mini-card"], .hh-card, .hdm-card',
    reason: 'playing cards: the four-colour deck paints suits in their own inks',
  },
  {
    selector: '[class*="chip-stack"], [class*="poker-chip"], .chip-icon',
    reason: 'chip artwork',
  },
  {
    selector: '[class*="avatar"]',
    reason: 'player portraits and their VIP frames',
  },
  {
    selector: '[class*="felt"], [class*="swatch"], [data-theme-swatch]',
    reason: 'felt previews and player-purchased controller theme swatches in Table Studio',
  },
  {
    selector: '[class*="bomb-pot"], [class*="bombpot"]',
    reason: 'Bomb Pot artwork',
  },
  {
    selector: '.studio-game-preview',
    reason:
      "Table Studio's live miniature of the felt and the player's own purchased controller theme",
  },
];

export function parseColor(value: string): Rgba | null {
  const m = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p: string, scale: number) =>
    p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p);
  const r = num(parts[0], 255);
  const g = num(parts[1], 255);
  const b = num(parts[2], 255);
  const a = parts[3] === undefined ? 1 : num(parts[3], 1);
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
  return { r, g, b, a };
}

/** Every rgb()/rgba() token in a computed value (gradients, shadows). */
export function colorsIn(value: string): Rgba[] {
  const out: Rgba[] = [];
  for (const m of value.matchAll(/rgba?\([^)]*\)/gi)) {
    const c = parseColor(m[0]);
    if (c) out.push(c);
  }
  return out;
}

export function hsl(c: Rgba): { h: number; s: number; l: number; chroma: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const l = (max + min) / 2;
  const s = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (chroma !== 0) {
    if (max === r) h = 60 * (((g - b) / chroma) % 6);
    else if (max === g) h = 60 * ((b - r) / chroma + 2);
    else h = 60 * ((r - g) / chroma + 4);
  }
  if (h < 0) h += 360;
  return { h, s, l, chroma };
}

/** The banned band a colour falls in, or null when it is legal. */
export function bannedBand(c: Rgba): string | null {
  if (c.a < ALPHA_FLOOR) return null;
  const { h, s, chroma } = hsl(c);
  if (s < SATURATION_FLOOR || chroma < CHROMA_FLOOR) return null;
  for (const [lo, hi, name] of BANNED_HUE_BANDS) if (h >= lo && h <= hi) return name;
  return null;
}

/** Source-over composite of `top` onto an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

export function luminance(c: Rgba): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG large text: 18px and up, or 14px (about 18.66 CSS px is 14pt; the
 *  brief says bold 14px) and up at weight 700. */
export function requiredContrast(fontSizePx: number, fontWeight: number): number {
  return fontSizePx >= 18 || (fontSizePx >= 14 && fontWeight >= 700) ? 3 : 4.5;
}

export type InkFinding = {
  kind: 'banned-hue' | 'uppercase' | 'contrast';
  where: string;
  text: string;
  detail: string;
};

/** One run of visible text, with the box its glyphs occupy (viewport px). */
export type TextSample = {
  where: string;
  text: string;
  ink: Rgba;
  fontSizePx: number;
  fontWeight: number;
  disabled: boolean;
  rect: { x: number; y: number; w: number; h: number };
};

export type SurfaceScan = {
  textElements: number;
  /** Text runs not judged for contrast because something covers them. */
  occluded: number;
  findings: InkFinding[];
  samples: TextSample[];
};

/* ───────────────────────── browser half ───────────────────────── */

function describe(el: Element): string {
  const cls =
    typeof (el as HTMLElement).className === 'string'
      ? (el as HTMLElement).className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
  return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
}

function ownTextNodes(el: Element): Text[] {
  return [...el.childNodes].filter(
    (n): n is Text => n.nodeType === 3 && (n.textContent ?? '').trim() !== ''
  );
}

function isVisible(el: Element): boolean {
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (parseFloat(getComputedStyle(n).opacity) < 0.05) return false;
  }
  return true;
}

function isExempt(el: Element): boolean {
  return ARTWORK_EXEMPTIONS.some(({ selector }) => el.closest(selector) !== null);
}

function paintColors(cs: CSSStyleDeclaration): Array<[string, Rgba]> {
  const out: Array<[string, Rgba]> = [];
  const bg = parseColor(cs.backgroundColor);
  if (bg) out.push(['background-color', bg]);
  for (const c of colorsIn(cs.backgroundImage)) out.push(['background-image', c]);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const width = parseFloat(cs.getPropertyValue(`border-${side}-width`));
    const style = cs.getPropertyValue(`border-${side}-style`);
    if (width > 0 && style !== 'none' && style !== 'hidden') {
      const c = parseColor(cs.getPropertyValue(`border-${side}-color`));
      if (c) out.push([`border-${side}-color`, c]);
    }
  }
  for (const c of colorsIn(cs.boxShadow)) out.push(['box-shadow', c]);
  for (const c of colorsIn(cs.textShadow)) out.push(['text-shadow', c]);
  const outlineWidth = parseFloat(cs.outlineWidth);
  if (outlineWidth > 0 && cs.outlineStyle !== 'none') {
    const c = parseColor(cs.outlineColor);
    if (c) out.push(['outline-color', c]);
  }
  return out;
}

const rgbText = (c: Rgba) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

/**
 * Reads every visible element under `roots`: banned hues in its ink, fills,
 * borders, outlines and shadows (its ::before/::after too), a computed
 * uppercase transform on any text, and a TextSample per text run for the
 * contrast pass, which needs the painted pixels behind the glyphs.
 */
export function scanSurface(roots: Element[]): SurfaceScan {
  const scan: SurfaceScan = { textElements: 0, occluded: 0, findings: [], samples: [] };
  const seen = new Set<Element>();
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (!isVisible(el) || isExempt(el)) continue;
      const cs = getComputedStyle(el);
      const nodes = ownTextNodes(el);
      const text = nodes
        .map((n) => n.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const where = describe(el);
      const layers: Array<[string, CSSStyleDeclaration]> = [['', cs]];
      for (const pseudo of ['::before', '::after']) {
        const p = getComputedStyle(el, pseudo);
        if (p.content && p.content !== 'none' && p.content !== 'normal') layers.push([pseudo, p]);
      }
      for (const [pseudo, layer] of layers) {
        for (const [prop, c] of paintColors(layer)) {
          const band = bannedBand(c);
          if (band)
            scan.findings.push({
              kind: 'banned-hue',
              where: where + pseudo,
              text: text.slice(0, 40),
              detail: `${prop} ${rgbText(c)} is ${band}`,
            });
        }
        if (pseudo && /^["'].*\S.*["']$/.test(layer.content)) {
          const ink = parseColor(layer.color);
          const band = ink && bannedBand(ink);
          if (band)
            scan.findings.push({
              kind: 'banned-hue',
              where: where + pseudo,
              text: layer.content.slice(0, 40),
              detail: `color ${layer.color} is ${band}`,
            });
        }
      }
      if (!text) continue;
      scan.textElements += 1;
      const ink = parseColor(cs.color);
      if (ink) {
        const band = bannedBand(ink);
        if (band)
          scan.findings.push({
            kind: 'banned-hue',
            where,
            text: text.slice(0, 40),
            detail: `color ${cs.color} is ${band}`,
          });
      }
      if (cs.textTransform === 'uppercase') {
        scan.findings.push({
          kind: 'uppercase',
          where,
          text: text.slice(0, 40),
          detail: 'text-transform: uppercase',
        });
      }
      if (!ink) continue;
      // The glyph box: the union of the text runs' own client rects.
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const n of nodes) {
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.width < 1 || r.height < 1) continue;
          x0 = Math.min(x0, r.left);
          y0 = Math.min(y0, r.top);
          x1 = Math.max(x1, r.right);
          y1 = Math.max(y1, r.bottom);
        }
      }
      if (!Number.isFinite(x0)) continue;
      // Inside the viewport only: the pixels come from a viewport capture.
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(window.innerWidth, x1);
      y1 = Math.min(window.innerHeight, y1);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      // Read only text the player can see: a run scrolled under a sticky
      // footer or clipped by its scroller has someone else's pixels in its
      // box. The topmost element at its centre must be the run's own.
      const hit = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
      if (!hit || (hit !== el && !el.contains(hit))) {
        scan.occluded += 1;
        continue;
      }
      scan.samples.push({
        where,
        text: text.slice(0, 40),
        ink,
        fontSizePx: parseFloat(cs.fontSize),
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        disabled:
          (el as HTMLButtonElement).disabled === true ||
          el.closest('[aria-disabled="true"], :disabled') !== null,
        rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      });
    }
  }
  return scan;
}

/* ───────────────────────── node half ───────────────────────── */

/**
 * The colour a run of text sits on, read from a capture taken with every
 * glyph made transparent: the median pixel (by luminance) inside its glyph
 * box. A median, not a mean, so a chrome hairline or an icon beside the word
 * does not drag the backdrop toward itself; not the extreme stop of a
 * gradient, because text is read where it sits, not at the gradient's edge.
 */
export function backdropAt(
  raw: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number,
  rect: TextSample['rect'],
  scale = 1
): Rgba | null {
  const xs = Math.max(0, Math.floor(rect.x * scale));
  const ys = Math.max(0, Math.floor(rect.y * scale));
  const xe = Math.min(width, Math.ceil((rect.x + rect.w) * scale));
  const ye = Math.min(height, Math.ceil((rect.y + rect.h) * scale));
  const px: Array<[number, Rgba]> = [];
  for (let y = ys; y < ye; y += 1) {
    for (let x = xs; x < xe; x += 1) {
      const i = (y * width + x) * channels;
      const c = { r: raw[i], g: raw[i + 1], b: raw[i + 2], a: 1 };
      px.push([luminance(c), c]);
    }
  }
  if (!px.length) return null;
  px.sort((a, b) => a[0] - b[0]);
  return px[Math.floor(px.length / 2)][1];
}

export function contrastFindings(
  samples: TextSample[],
  raw: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number,
  scale = 1
): { checked: number; skipped: number; findings: InkFinding[] } {
  let checked = 0;
  let skipped = 0;
  const findings: InkFinding[] = [];
  for (const s of samples) {
    if (s.disabled) {
      skipped += 1;
      continue;
    }
    const bg = backdropAt(raw, width, height, channels, s.rect, scale);
    if (!bg) {
      skipped += 1;
      continue;
    }
    checked += 1;
    const fg = s.ink.a >= 0.99 ? s.ink : over(s.ink, bg);
    const ratio = contrast(fg, bg);
    const need = requiredContrast(s.fontSizePx, s.fontWeight);
    if (ratio + 1e-6 < need) {
      findings.push({
        kind: 'contrast',
        where: s.where,
        text: s.text,
        detail: `${rgbText(fg)} on ${rgbText(bg)} reaches ${ratio.toFixed(2)}:1, needs ${need}:1 at ${s.fontSizePx}px/${s.fontWeight}`,
      });
    }
  }
  return { checked, skipped, findings };
}
