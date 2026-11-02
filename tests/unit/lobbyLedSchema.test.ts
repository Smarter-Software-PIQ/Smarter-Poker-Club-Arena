import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lobbyLedAttributes } from '../../src/components/lobby/lobbyLedSchema';

const row = (kind = 'cash', gameLabel = 'NLH', keys: string[] = []) => ({
  kind,
  gameLabel,
  featured: false,
  rules: keys.map((key) => ({ key })),
  game: { template: 'classic', noLightning: false },
});
const color = (entry: ReturnType<typeof row>) => lobbyLedAttributes(entry)['data-led-color'];

describe('native lobby exterior lights', () => {
  it('keeps legacy freezeout paint from overriding recorded Spin and Sit & Go lights', () => {
    const css = readFileSync('src/components/lobby/PremiumMttRows.css', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    );
    const legacy = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => match[1].includes('.is-freezeout') && /filter\s*:/.test(match[2]))
      .flatMap((match) =>
        match[1].split(',').map((selector) =>
          selector
            .replace(/::after\s*$/, '')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
            .trim()
        )
      );
    expect(legacy.length).toBeGreaterThan(0);
    const table = document.createElement('table');
    table.className = 'has-premium-chassis';
    table.innerHTML = '<tbody><tr class="is-freezeout"></tr></tbody>';
    const event = table.querySelector('tr')!;
    expect(legacy.some((selector) => event.matches(selector))).toBe(true);
    for (const color of ['red', 'green']) {
      event.dataset.ledColor = color;
      expect(legacy.some((selector) => event.matches(selector))).toBe(false);
    }
  });

  it('distinguishes every Omaha variant and the requested cash families', () => {
    expect(['NLH', 'PNPL', '6+'].map((variant) => color(row('cash', variant)))).toEqual([
      'blue',
      'yellow',
      'green',
    ]);
    expect(['PLO', 'PLO5', 'PLO6', 'PLO8'].map((variant) => color(row('cash', variant)))).toEqual([
      'blue',
      'red',
      'green',
      'yellow',
    ]);
  });
  it('gives Lightning white precedence but retains recorded variant exclusions', () => {
    expect(color(row('cash', 'FLH'))).toBe('blue');
    expect(color(row('cash', 'PLO4'))).toBe('blue');
    expect(color(row('cash', 'FLO8'))).toBe('yellow');
    for (const variant of ['NLH', 'PLO', 'PLO5', 'PLO6']) {
      expect(
        color({ ...row('cash', variant), game: { template: 'lightning', noLightning: false } })
      ).toBe('white');
    }
    expect(
      color({ ...row('cash', 'PLO8'), game: { template: 'madness', noLightning: true } })
    ).toBe('yellow');
  });
  it('uses distinct format rails and preserves event-type left rails and pinned frames', () => {
    expect(lobbyLedAttributes({ ...row('mtt', 'NLH', ['freezeout']), buyInValue: 0 })).toEqual({
      'data-led-color': 'blue',
      'data-led-sides': 'both',
    });
    expect(
      [row('mtt'), row('spin'), row('sng'), row('sng', 'NLH', ['satellite'])].map(color)
    ).toEqual(['blue', 'red', 'green', 'yellow']);
    expect(lobbyLedAttributes(row('mtt', 'NLH', ['bounty']))).toEqual({
      'data-led-color': 'green',
      'data-led-sides': 'left',
    });
    expect(lobbyLedAttributes(row('mtt', 'NLH', ['freezeout']))).toEqual({
      'data-led-color': 'white',
      'data-led-sides': 'left',
    });
    expect(
      lobbyLedAttributes({ ...row('mtt', 'NLH', ['satellite', 'bounty']), featured: true })
    ).toEqual({ 'data-led-color': 'red', 'data-led-sides': 'none' });
    expect(lobbyLedAttributes(row('mtt', 'NLH', ['satellite', 'bounty']))).toEqual({
      'data-led-color': 'yellow',
      'data-led-sides': 'both',
    });
  });
});
