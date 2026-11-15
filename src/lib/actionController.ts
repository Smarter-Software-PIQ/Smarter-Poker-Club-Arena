/** One catalog and one validation contract for the felt, settings and Studio. */
export const ACTION_CONTROLLER_COLORS = [
  { id: 'blue', name: 'Arena Blue', filter: 'none' },
  {
    id: 'green',
    name: 'Casino Emerald',
    filter: 'hue-rotate(280deg) saturate(0.65) brightness(0.85)',
  },
  { id: 'navy', name: 'Midnight Navy', filter: 'saturate(0.55) brightness(0.7)' },
  { id: 'platinum', name: 'Black Platinum', filter: 'grayscale(1) brightness(1.05)' },
  {
    id: 'gold',
    name: 'Champagne Gold',
    filter: 'hue-rotate(190deg) saturate(0.45) brightness(1.3)',
  },
  { id: 'teal', name: 'Deep Teal', filter: 'hue-rotate(300deg) saturate(0.6) brightness(0.85)' },
] as const;
export type ActionControllerColor = (typeof ACTION_CONTROLLER_COLORS)[number]['id'];
export interface ActionControllerSettings {
  color: ActionControllerColor;
  preflop: number[];
  postflop: number[];
}
export const DEFAULT_ACTION_CONTROLLER: ActionControllerSettings = {
  color: 'blue',
  preflop: [2.5, 3, 3.5, 4],
  postflop: [33, 50, 75, 100],
};
export function validBetPresets(value: unknown, max: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (n) =>
        typeof n === 'number' &&
        Number.isFinite(n) &&
        n >= 1 &&
        n <= max &&
        Math.abs(n * 100 - Math.round(n * 100)) < 1e-7
    )
  );
}
export function normalizeActionController(value: unknown): ActionControllerSettings {
  const raw =
    value && typeof value === 'object' ? (value as Partial<ActionControllerSettings>) : {};
  return {
    color: ACTION_CONTROLLER_COLORS.some((c) => c.id === raw.color) ? raw.color! : 'blue',
    preflop: validBetPresets(raw.preflop, 100)
      ? [...raw.preflop]
      : [...DEFAULT_ACTION_CONTROLLER.preflop],
    postflop: validBetPresets(raw.postflop, 1000)
      ? [...raw.postflop]
      : [...DEFAULT_ACTION_CONTROLLER.postflop],
  };
}
