/**
 * MONEY FIGURES ARE PINNED BEFORE A FRAME MOVES (2026-11-27)
 *
 * The #SmarterDesign pass on the Financials and Diamond operations pages moves
 * frames around money. The owner's condition: no figure's text, format or test
 * hook may change. This reads every printed string that carries a digit (each
 * money figure, count and rate, in DOM order) and every data-* hook, so a test
 * can pin them as one list. Dates and clock times are replaced by a token: they
 * follow the day the test runs, and they are not what a frame could break.
 */
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

export function moneyFigures(root: HTMLElement): { figures: string[]; hooks: string[] } {
  const figures: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = normalize(walker.currentNode.textContent ?? '');
    if (/\d/.test(text)) figures.push(text);
  }
  const hooks: string[] = [];
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      if (attribute.name.startsWith('data-')) {
        hooks.push(`${attribute.name}=${normalize(attribute.value)}`);
      }
    }
  }
  return { figures, hooks };
}
