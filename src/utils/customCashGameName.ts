/** Preserve the host name while omitting only generated game/stakes/style labels. */
export function customCashGameName(name: string | null | undefined): string | null {
  if (!name?.trim() || name === 'Loading...') return null;
  /* Owner ruling, November 14, 2026: limit games are named "Fixed Limit 1/2"
     and "Omaha 4 Card Fixed Limit" ... "Omaha 8o Fixed Limit", so those names
     are generated captions too, as are the older FLH / FLO8 spellings. */
  const variant =
    /^\s*(nlhe?|no[\s-]?limit[\s-]?hold(?:'|’)?em|omaha\s*(?:[4568]\s*card|8o)\s*fixed[\s-]?limit|fixed[\s-]?limit(?:[\s-]?hold(?:'|’)?em)?|plo[4568]?|pot[\s-]?limit[\s-]?omaha|flh|flo[4568]?|limit[_\s-]?(?:holdem|omaha)|pineapple|short[\s_-]?deck|6\+)(?!\w)/i;
  /* A generated name may lead with its style ("Classic FLH 0.50/1.00", the
     welcome package's spelling). Only a style word followed by a game name is
     stripped, so a host's "Classic Night Game" keeps its first word. */
  const leadingStyle = new RegExp(
    `^\\s*(?:Classic|Action|Madness)\\s+(?=${variant.source.replace(/^\^\\s\*/, '')})`,
    'i'
  );
  const stakes = /^\s*\$?(?:\d+(?:\.\d+)?|\.\d+)\s*\/\s*\$?(?:\d+(?:\.\d+)?|\.\d+)/;
  const residual = name
    .trim()
    .replace(leadingStyle, '')
    .replace(variant, '')
    .replace(stakes, '')
    .replace(variant, '')
    .replace(stakes, '')
    .replace(/^[\s\-\u2013\u2014:|,]+/, '')
    .trim();
  if (
    !residual ||
    /^(?:(?:Classic|Action|Madness|Lightning(?: Games)?)(?:\s*[-:|,]\s*|\s+))?(?:Main(?:\s+\d+)?|Feeder(?:\s+\d+)?)$/i.test(
      residual
    ) ||
    /^(?:Classic|Action|Madness|Lightning(?: Games)?)$/i.test(residual)
  )
    return null;
  return residual;
}
