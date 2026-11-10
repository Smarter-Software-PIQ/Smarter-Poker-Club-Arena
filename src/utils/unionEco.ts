export interface UnionEcoComponent {
  activity: 'cash' | 'tournament';
  enabled: boolean;
  base_mode: 'club_profit';
  base: number;
  rate: number;
  amount: number;
  terms_id: string;
  record_id: string | null;
  status: 'preview' | 'recorded';
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  Number.isSafeInteger(Math.round(v * 100)) &&
  Math.abs(v * 100 - Math.round(v * 100)) < 0.00001;

/** Missing historical lanes stay unknown; the combined invoice remains intact. */
export function unionEcoComponents(value: unknown, recorded = true): UnionEcoComponent[] | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    v.eco_version !== 2 ||
    !Array.isArray(v.eco_components) ||
    v.eco_components.length !== 2 ||
    !money(v.eco_amount)
  )
    return null;
  const activities = new Set<string>();
  const result: UnionEcoComponent[] = [];
  for (const raw of v.eco_components) {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    if (
      (c.activity !== 'cash' && c.activity !== 'tournament') ||
      activities.has(c.activity) ||
      typeof c.enabled !== 'boolean' ||
      c.base_mode !== 'club_profit' ||
      !money(c.base) ||
      !money(c.amount) ||
      typeof c.rate !== 'number' ||
      !Number.isFinite(c.rate) ||
      c.rate < 0 ||
      c.rate > 1 ||
      typeof c.terms_id !== 'string' ||
      !uuid.test(c.terms_id) ||
      (c.status !== 'preview' && c.status !== 'recorded') ||
      (recorded && c.status !== 'recorded') ||
      (c.status === 'recorded'
        ? typeof c.record_id !== 'string' || !uuid.test(c.record_id)
        : c.record_id !== null)
    )
      return null;
    const expected = c.enabled ? -c.base * c.rate : 0;
    if (
      Math.round(c.amount * 100) !==
      Math.sign(expected) * Math.round(Math.abs(expected) * 100 + 1e-8)
    )
      return null;
    activities.add(c.activity);
    result.push(c as unknown as UnionEcoComponent);
  }
  if (result.every((c) => c.status === 'recorded') && result[0].record_id === result[1].record_id)
    return null;
  if (result[0].status !== result[1].status) return null;
  if (
    Math.round(v.eco_amount * 100) !==
    result.reduce((sum, c) => sum + Math.round(c.amount * 100), 0)
  )
    return null;
  return ['cash', 'tournament'].map((activity) => result.find((c) => c.activity === activity)!);
}

export function unionEcoRows(value: unknown): Array<[string, number | null]> {
  const components = unionEcoComponents(value);
  return ['Cash ECO', 'Tournament ECO'].map((label, i) => [label, components?.[i].amount ?? null]);
}

export function unionEcoSummary(value: Record<string, unknown>): {
  eco_components_complete: boolean;
  cash_eco_amount: number | null;
  tournament_eco_amount: number | null;
} {
  if (value.eco_components_complete !== true)
    return { eco_components_complete: false, cash_eco_amount: null, tournament_eco_amount: null };
  if (
    !money(value.cash_eco_amount) ||
    !money(value.tournament_eco_amount) ||
    !money(value.eco_amount) ||
    Math.round(value.eco_amount * 100) !==
      Math.round(value.cash_eco_amount * 100) + Math.round(value.tournament_eco_amount * 100)
  ) {
    throw new Error('Separate ECO totals do not reconcile');
  }
  return {
    eco_components_complete: true,
    cash_eco_amount: value.cash_eco_amount,
    tournament_eco_amount: value.tournament_eco_amount,
  };
}
