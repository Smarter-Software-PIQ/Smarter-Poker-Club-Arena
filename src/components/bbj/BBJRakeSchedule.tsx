import './BBJBasicPanel.css';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getRakeConfig } from '../../config/RakeConfig';
import { resolveRakeOverride } from '../../lib/rakeOverride';
import { readCashRakePolicyVersion } from '../../services/cashRakePolicyVersion';
import { applyClubScope } from '../../utils/clubScope';
import { gameTypeLabel } from '../../utils/handFormat';

interface Props {
  clubId?: string;
  unionId?: string | null;
  tableId?: string;
  asset: 'chips' | 'diamonds';
}

interface Row {
  game: string;
  sb: number | null;
  bb: number;
  rate: number;
  cap: number;
  name: string;
  dealt?: string;
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
      'id,name,small_blind,big_blind,max_players,game_variant,union_id,rake_percent,rake_cap_bb,club:clubs!fk_tables_club_id(asset,union_id,default_rake_percent,rake_cap)'
    )
    .eq('is_deleted', false)
    .is('tournament_id', null)
    .not('status', 'in', '("closed","deleted")')
    .order('big_blind')
    .order('small_blind')
    .order('game_variant')
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
    const game = gameTypeLabel(table.game_variant) || table.game_variant;
    const base = { game, sb, bb, name: table.name };
    if (diamond) {
      const prices = diamond.data.filter((p: { big_blind: number }) => p.big_blind === bb);
      if (!prices.length) throw new Error('Missing Diamond stake');
      for (const p of prices) rows.push({ ...base, dealt: p.players, rate: p.percent, cap: p.cap });
    } else {
      const override = resolveRakeOverride(table, club);
      const config = getRakeConfig(
        bb,
        table.game_variant,
        sb,
        version === 1 ? override : { ...override, scope: undefined }
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
        game: 'All Cash Games',
        name: '',
        sb: null,
        bb: p.big_blind,
        dealt: p.players,
        rate: p.percent,
        cap: p.cap,
      });
  }
  return rows;
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
  return (
    <div className="bbj-basic__scroll">
      <table className="bbj-basic__table" aria-label="Cash Game Rake By Stakes">
        <thead>
          <tr>
            <th>Cash Game</th>
            <th>Stakes</th>
            <th>Rake</th>
            <th>
              Cap{' '}
              <span className="bbj-basic__subhead">{asset === 'chips' ? 'Chips' : 'Diamonds'}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                {r.game}
                <small className="bbj-basic__subhead">{r.name}</small>
                {r.dealt && <small className="bbj-basic__subhead">{r.dealt} Dealt</small>}
              </td>
              <td>{r.sb === null ? 'BB ' + r.bb : r.sb + '/' + r.bb}</td>
              <td>{r.rate}%</td>
              <td>{r.cap}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
