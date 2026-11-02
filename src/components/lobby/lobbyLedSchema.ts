import { cashTemplateKey } from '../../config/cashGames';

type LedColor = 'blue' | 'red' | 'green' | 'yellow' | 'white';
interface LedFacts {
  kind: string;
  gameLabel: string;
  featured: boolean;
  buyInValue?: number;
  game?: { template?: string | null; noLightning?: boolean } | null;
  rules: readonly { key: string }[];
}

/** Exterior light identity only; names, prices and admission remain untouched. */
export function lobbyLedAttributes(entry: LedFacts): {
  'data-led-color': LedColor;
  'data-led-sides': 'both' | 'left' | 'none';
} {
  const lights = (color: LedColor, sides: 'both' | 'left' | 'none' = 'both') => ({
    'data-led-color': color,
    'data-led-sides': sides,
  });
  if (entry.kind === 'cash') {
    if (!entry.game?.noLightning && cashTemplateKey(entry.game?.template ?? '') === 'madness')
      return lights('white');
    const variants: Record<string, LedColor> = {
      NLH: 'blue',
      PNPL: 'yellow',
      '6+': 'green',
      PLO: 'blue',
      PLO4: 'blue',
      PLO5: 'red',
      PLO6: 'green',
      PLO8: 'yellow',
      FLO8: 'yellow',
      FLH: 'blue',
    };
    return lights(variants[entry.gameLabel.toUpperCase()] ?? 'blue');
  }
  if (entry.featured) return lights('red', 'none'); // Existing full red pinned frame.
  const keys = new Set(entry.rules.map((rule) => rule.key));
  if (keys.has('satellite')) return lights('yellow');
  if (entry.kind === 'spin') return lights('red');
  if (entry.kind === 'sng') return lights('green');
  if (keys.has('freeroll') || (entry.kind === 'mtt' && (entry.buyInValue ?? NaN) <= 0))
    return lights('blue');
  if (keys.has('bounty') || keys.has('pko') || keys.has('mystery')) return lights('green', 'left');
  if (keys.has('freezeout')) return lights('white', 'left');
  return lights('blue');
}
