import './BBJBasicPanel.css';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getRakeConfig } from '../../config/RakeConfig';
import { resolveRakeOverride } from '../../lib/rakeOverride';
import { readCashRakePolicyVersion } from '../../services/cashRakePolicyVersion';
import { applyClubScope } from '../../utils/clubScope';
import { cutNumberFormat, cutFixed } from '../../utils/format';

interface Props {
  clubId?: string;
  unionId?: string | null;
  tableId?: string;
  asset: 'chips' | 'diamonds';
}

interface Row {
  sb: number | null;
  bb: number;
  rate: number;
  cap: number;
  seats?: number;
  dealt: string;
}

interface ChipBrackets {
  hu_percent: number;
  hu_factor: number;
  short_factor: number;
  short_seats: number;
  short_players: number;
}

export function chipPrices(rate: number, cap: number, seats: number | null, rules: ChipBrackets) {
  const scaled = (factor: number) => Math.round(Math.round(cap * 100) * factor) / 100;
  const shortCap = !seats || seats >= rules.short_seats ? scaled(rules.short_factor) : cap;
  return [
    {
      dealt: '2',
      minimum: 2,
      rate: Math.min(rate, rules.hu_percent),
      cap: scaled(rules.hu_factor),
    },
    { dealt: String(rules.short_players), minimum: rules.short_players, rate, cap: shortCap },
    { dealt: rules.short_players + 1 + '+', minimum: rules.short_players + 1, rate, cap },
  ].filter((row) => !seats || row.minimum <= seats);
}

async function loadRows({ clubId, unionId, tableId, asset }: Props): Promise<Row[]> {
  if (!clubId && tableId) {
    const { data, error } = await supabase
      .from('tables')
      .select('club_id, union_id')
      .eq('id', tableId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Cash table unavailable');
    clubId = data.club_id;
    unionId = data.union_id;
  }
  if (!clubId) throw new Error('Missing club');
  const query = supabase
    .from('tables')
    .select(
      'small_blind,big_blind,max_players,game_variant,union_id,rake_percent,rake_cap_bb,club:clubs!fk_tables_club_id(asset,union_id,default_rake_percent,rake_cap)'
    )
    .eq('is_deleted', false)
    .is('tournament_id', null)
    .not('status', 'in', '("closed","deleted")')
    .order('big_blind')
    .order('small_blind')
    .order('id');
  const { data, error } = await applyClubScope(query, { clubId, unionId: unionId ?? null });
  if (error) throw error;
  const rows: Row[] = [];
  const version = asset === 'chips' ? await readCashRakePolicyVersion() : null;
  if (asset === 'chips' && version === null) throw new Error('Unknown cash rake policy');
  const diamond =
    asset === 'diamonds' ? await supabase.rpc('fn_bbj_diamond_cash_rake_schedule') : null;
  if (diamond?.error) throw diamond.error;
  const chip =
    asset === 'chips'
      ? await supabase.rpc('fn_bbj_chip_rake_brackets').maybeSingle<ChipBrackets>()
      : null;
  if (chip?.error) throw chip.error;
  for (const table of data ?? []) {
    const club = Array.isArray(table.club) ? table.club[0] : table.club;
    if (!club) throw new Error('Unknown club pricing');
    if ((club.asset === 'diamonds') !== (asset === 'diamonds')) continue;
    const sb = Number(table.small_blind),
      bb = Number(table.big_blind);
    if (!(bb > 0) || table.small_blind == null) throw new Error('Unknown cash stakes');
    const base = { sb, bb, seats: table.max_players };
    if (diamond) {
      const prices = diamond.data.filter((p: { big_blind: number }) => p.big_blind === bb);
      if (!prices.length) throw new Error('Missing Diamond stake');
      for (const p of prices) rows.push({ ...base, dealt: p.players, rate: p.percent, cap: p.cap });
    } else {
      const override = resolveRakeOverride(table, club);
      if (override?.scope === 'midway' && sb === 5 && bb === 10) continue;
      const config = getRakeConfig(
        bb,
        table.game_variant,
        sb,
        version !== null && version !== 0
          ? { ...override, policyVersion: version }
          : { ...override, scope: undefined }
      );
      if (!chip?.data) throw new Error('Missing chip rake rules');
      for (const price of chipPrices(
        config.rakePercent,
        config.rakeCap,
        table.max_players,
        chip.data
      )) {
        rows.push({ ...base, ...price });
      }
    }
  }
  if (diamond && !rows.length) {
    for (const p of diamond.data)
      rows.push({
        sb: null,
        bb: p.big_blind,
        dealt: p.players,
        rate: p.percent,
        cap: p.cap,
      });
  }
  return rows;
}

type Prices = Map<string, Set<number>>;
interface Stake {
  sb: number | null;
  bb: number;
  prices: Map<string, Prices>;
}

const chips = cutNumberFormat('en-US', { maximumFractionDigits: 2 });
const blind = (value: number) =>
  value > 0 && value < 1 ? cutFixed(value, 2) : chips.format(value);

export function groupByStakes(rows: Row[]) {
  const stakes = new Map<string, Stake>();
  const brackets = new Set<string>();
  for (const { sb, bb, dealt, rate, cap, seats } of rows) {
    const key = sb + '/' + bb;
    const stake = stakes.get(key) ?? { sb, bb, prices: new Map<string, Prices>() };
    const prices = stake.prices.get(dealt) ?? new Map<string, Set<number>>();
    const label = rate + '% / ' + chips.format(cap);
    const sizes = prices.get(label) ?? new Set<number>();
    if (seats) sizes.add(seats);
    prices.set(label, sizes);
    stake.prices.set(dealt, prices);
    stakes.set(key, stake);
    brackets.add(dealt);
  }
  return {
    stakes: Array.from(stakes.values()).sort((a, b) => a.bb - b.bb || (a.sb ?? 0) - (b.sb ?? 0)),
    brackets: Array.from(brackets).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)),
  };
}

export function BBJRakeSchedule(props: Props) {
  const { clubId, unionId, tableId, asset } = props;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setRows(null);
    setFailed(false);
    loadRows({ clubId, unionId, tableId, asset }).then(
      (result) => {
        if (active) setRows(result);
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, [clubId, unionId, tableId, asset]);
  if (!rows?.length)
    return (
      <p className="bbj-basic__rules" role="status">
        {failed
          ? 'Rake Schedule Unavailable.'
          : rows
            ? 'No Cash Games Are Listed.'
            : 'Loading Rake Schedule…'}
      </p>
    );
  const { stakes, brackets } = groupByStakes(rows);
  return (
    <div className="bbj-basic bbj-rake">
      <p className="bbj-basic__rules">Rake % / Cap In {asset === 'chips' ? 'Chips' : 'Diamonds'}</p>
      <div className="bbj-basic__scroll">
        <table className="bbj-basic__table" aria-label="Rake Schedule By Stakes">
          <thead>
            <tr>
              <th scope="col">Stakes</th>
              {brackets.map((dealt) => (
                <th key={dealt} scope="col">
                  {dealt} Dealt
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stakes.map(({ sb, bb, prices }) => (
              <tr key={sb + '/' + bb}>
                <th scope="row">{sb === null ? 'BB ' + bb : blind(sb) + '/' + blind(bb)}</th>
                {brackets.map((dealt) => {
                  const terms = prices.get(dealt);
                  return (
                    <td key={dealt}>
                      {terms
                        ? Array.from(terms, ([price, sizes]) => (
                            <div key={price}>
                              {price}
                              {terms.size > 1 && sizes.size > 0 && (
                                <small className="bbj-basic__subhead">
                                  {[...sizes].sort((a, b) => a - b).join('/')} Seats
                                </small>
                              )}
                            </div>
                          ))
                        : '-'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
