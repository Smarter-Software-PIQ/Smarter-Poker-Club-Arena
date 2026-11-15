/** One catalog and one validation contract for the felt, settings and Studio. */
export const ACTION_CONTROLLER_COLORS = [
  { id: 'blue', name: 'Arena Blue', filter: 'none' },
  { id: 'green', name: 'Emerald', filter: 'hue-rotate(265deg)' },
  { id: 'red', name: 'Ruby', filter: 'hue-rotate(130deg)' },
  { id: 'purple', name: 'Amethyst', filter: 'hue-rotate(55deg)' },
  { id: 'gold', name: 'Gold', filter: 'hue-rotate(190deg) brightness(1.6)' },
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
        Math.abs(n * 10 - Math.round(n * 10)) < 1e-7
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
