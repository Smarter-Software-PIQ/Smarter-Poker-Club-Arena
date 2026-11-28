/**
 * A SURFACE IS PINNED BEFORE ITS FRAME MOVES (2026-11-28)
 *
 * The #SmarterDesign pass that finishes the partial operator pages adds the
 * chrome mast to four pages and moves three panels off the painted console.
 * The condition: no printed figure, word, data hook, named region or control
 * state may change. This reads all five from a rendered surface so a test can
 * record them against the old code and hold them unchanged after.
 *
 * The page head is the one deliberate change. The old head was a PageBar whose
 * only print was its hidden title and the "?" (`.ca-page-bar__title`,
 * `.ca-page-help`); the new head is the chrome mast (`.arena-workspace-mast`),
 * which carries the same title and the same "?". Those three are left out of
 * the reading; everything else on the page is in it. Controls are read as a
 * sorted list, so a Back key that moves above the mast is still held to its
 * name and state.
 */
import { moneyFigures } from './moneyFigures';

const HEAD = '.arena-workspace-mast, .ca-page-help, .ca-page-bar__title';

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
  if (tag === 'input' && (input.type === 'checkbox' || input.type === 'radio'))
    flags.push(input.checked ? 'checked' : 'unchecked');
  if (tag === 'input' || tag === 'select' || tag === 'textarea')
    flags.push(`value=${normalize(input.value)}`);
  const type = el.getAttribute('type') ?? '';
  return `${tag}|${type}|${name}|${flags.join(',')}`;
}

export function surfacePin(root: HTMLElement) {
  const body = root.cloneNode(true) as HTMLElement;
  for (const el of body.querySelectorAll(HEAD)) el.remove();
  const controls = [
    ...body.querySelectorAll('button, a[href], input, select, textarea, [role="switch"]'),
  ]
    .map(control)
    .sort();
  /* The text, read without the control names, so a key that moves keeps the
     words around it in order; the controls list holds the keys themselves. */
  const words = body.cloneNode(true) as HTMLElement;
  for (const el of words.querySelectorAll('button, a[href]')) el.remove();
  const text: string[] = [];
  const walker = words.ownerDocument.createTreeWalker(words, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const piece = normalize(walker.currentNode.textContent ?? '');
    if (piece) text.push(piece);
  }
  return {
    money: moneyFigures(body),
    text: text.join(' | '),
    regions: [...body.querySelectorAll('[aria-label], [role]')].map(
      (el) =>
        `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}`
    ),
    controls,
  };
}
