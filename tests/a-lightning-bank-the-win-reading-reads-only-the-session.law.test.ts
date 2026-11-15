/**
 * A Lightning bank-the-win reading reads only the Horse's session (2026-11-15).
 *
 * fn_lightning_bank_the_win_reading found the size of a Horse's last hand by
 * joining every lightning_hand_player row the Horse ever had (tens of
 * thousands) to lightning_hand and sorting them: 8.6 s on production, past the
 * statement timeout, so the RPC failed 20 to 330 times an hour and a Horse at
 * its bank-the-win line could not leave. The newest definition must look only
 * inside the open pool session (cluster, epoch, formed since entry) so the
 * read walks lightning_hand_by_cluster_epoch and probes
 * lightning_hand_player_pkey. Behaviour is proved on real PostgreSQL by
 * tests/unit/lightningBankTheWinReadingSession.pg.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

function newestBody(name: string): string {
  const defines = new RegExp(
    `create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,
    'i'
  );
  const last = migrationCorpus()
    .filter(({ sql }) => defines.test(sql))
    .pop();
  expect(last).toBeDefined();
  const sql = last!.sql;
  const start = sql.search(defines);
  const open = sql.indexOf('$function$', start);
  return sql.slice(start, sql.indexOf('$function$', open + 1));
}

describe('a Lightning bank-the-win reading reads only the session', () => {
  const body = newestBody('fn_lightning_bank_the_win_reading');
  const dealt = body.slice(body.search(/INTO\s+v_dealt/i));

  it('bounds the last-hand read by the open pool session', () => {
    expect(dealt).toMatch(/lh\.cluster_id\s*=\s*p_cluster_id/);
    expect(dealt).toMatch(/lh\.cluster_epoch\s*=\s*v_ps\.cluster_epoch/);
    expect(dealt).toMatch(/lh\.formed_at\s*>=\s*v_ps\.entered_at/);
    expect(dealt).toMatch(/ORDER\s+BY\s+lh\.formed_at\s+DESC/i);
  });

  it("never starts from the Horse's whole Lightning history", () => {
    expect(dealt).not.toMatch(/WHERE\s+lp\.player_id\s*=\s*p_player_id/i);
    expect(dealt).not.toMatch(/ORDER\s+BY\s+lh\.settled_at/i);
  });
});
