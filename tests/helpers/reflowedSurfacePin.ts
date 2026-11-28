/**
 * A SURFACE WHOSE SECTIONS MOVE IS PINNED BY WHAT IT SAYS, NOT WHERE (2026-11-28)
 *
 * surfacePin.ts reads a page's words in document order, which suits a pass
 * that only changes a frame around content that stays put. The #SmarterDesign
 * batch D1 pages (Earn Diamonds, Lightning entry, Flash Pool) move their
 * content: a painted console's pill becomes the note on a chrome section
 * title, a pool's figures move into readouts beside its stakes. The owner's
 * condition is unchanged: no diamond amount, price, figure, word, data hook,
 * live region or control (with its name and state) may change.
 *
 * So this reads every one of those as a SORTED list: a moved figure is still
 * the same figure, a dropped or changed one is not. What it leaves out, and
 * why:
 *
 * - The page head (the chrome mast, the "?" and the PageBar's hidden title):
 *   the one part each page deliberately replaces. Its words are held by the
 *   test that names the page title.
 * - Anything aria-hidden: a frame's decoration (the EmptyState beacon's "SP",
 *   a painted console's art), never a word a player reads.
 * - A piece with no letter or digit (a lone "▲" glyph): not a word or a figure.
 * - Frame hooks. Only the page's own data hooks are read (data-testid, the
 *   Flash Pool tutorial target and the lobby card's data-zone figures); the
 *   painted console's and the mast's data-* attributes are frame, not page.
 */
import { moneyFigures } from './moneyFigures';

const HEAD = '.arena-workspace-mast, .ca-page-help, .ca-page-bar__title, [aria-hidden="true"]';
const PAGE_HOOKS = /^data-(?:testid|flash-pools|zone)=/;

const MONTH =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:, \d{4})?/g;

function normalize(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g, '<date>')
    .replace(MONTH, '<date>')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '<date>')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?/gi, '<time>')
    .replace(/\s+/g, ' ')
    .trim();
}

function control(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const name = normalize(el.getAttribute('aria-label') || el.textContent || '');
  const flags: string[] = [];
  const input = el as HTMLInputElement;
  if (input.disabled) flags.push('disabled');
  for (const attr of ['aria-pressed', 'aria-selected', 'aria-current', 'aria-expanded']) {
    const value = el.getAttribute(attr);
    if (value !== null) flags.push(`${attr}=${value}`);
  }
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    flags.push(`value=${normalize(input.value)}`);
    for (const attr of ['type', 'min', 'max', 'placeholder', 'readonly']) {
      const value = el.getAttribute(attr);
      if (value !== null) flags.push(`${attr}=${value}`);
    }
  }
  const href = el.getAttribute('href');
  if (href !== null) flags.push(`href=${href}`);
  return `${tag}|${name}|${flags.join(',')}`;
}

export function reflowedSurfacePin(root: HTMLElement) {
  const body = root.cloneNode(true) as HTMLElement;
  for (const el of body.querySelectorAll(HEAD)) el.remove();
  const controls = [...body.querySelectorAll('button, a[href], input, select, textarea')]
    .map(control)
    .sort();
  const words = body.cloneNode(true) as HTMLElement;
  for (const el of words.querySelectorAll('button, a[href]')) el.remove();
  const money = moneyFigures(body);
  return {
    figures: [...money.figures].sort(),
    hooks: money.hooks.filter((hook) => PAGE_HOOKS.test(hook)).sort(),
    words: pieces(words).sort(),
    /* Each live region by its role and the sorted words inside it, its keys
       included, so a line that leaves its region or a region that loses its
       role shows. */
    live: [...body.querySelectorAll('[role="alert"], [role="status"]')]
      .map((el) => `${el.getAttribute('role')}|${pieces(el).sort().join(' | ')}`)
      .sort(),
    controls,
  };
}

function pieces(root: Element): string[] {
  const text: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const piece = normalize(walker.currentNode.textContent ?? '');
    if (/[\p{L}\p{N}]/u.test(piece)) text.push(piece);
  }
  return text;
}
