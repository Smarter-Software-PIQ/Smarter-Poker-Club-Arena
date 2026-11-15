/**
 * A JACKPOT SHARE FOLLOWS THE HAND'S CLUB
 *
 * Owner rule, 2026-11-15: a player can play in several clubs; each club's
 * numbers reflect ONLY the hands played through that club, and nothing is
 * excluded because a player belongs to several clubs.
 *
 * WHY. bbj_credit_one_recipient paid a departed recipient's Bad Beat Jackpot
 * share to the latest seat's club only while that membership was active, else
 * to tables.club_id (the union house on a union table), else to
 * fn_player_home_club (the club holding the player's largest balance). None of
 * those is where the hand was played. 28 Midway shares (8,663.26) landed in
 * the wrong club between 2026-10-19 and 2026-11-08, and the weekly award
 * reader then put each on the statement of the wallet's club.
 *
 * WHAT THIS PINS. The credit resolves the club from the hand (its rake
 * attribution, else the buy-in receipt that funded the seat), credits that
 * club's retained member record whatever its status, parks when there is none,
 * and never consults the table's club or a home club. The award reader
 * attributes a wallet share to the hand's earning club. No later migration may
 * bring either fallback back into the jackpot credit.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const FILE = '20261115150131_a_jackpot_share_follows_the_hand_club.sql';
const sql = readFileSync(join(DIR, FILE), 'utf8');

describe('a jackpot share follows the hand club', () => {
  it('the credit resolves the club from the hand, then the funding receipt', () => {
    const body = sql.slice(sql.indexOf('DO $credit$'), sql.indexOf('$credit$;'));
    expect(body).toMatch(/JOIN public\.rake_attributions ra ON ra\.hand_id = hand_payout\.hand_id/);
    expect(body).toMatch(/ra\.player_id = p_user_id/);
    expect(body).toMatch(/FROM public\.cash_participant_funding_receipts x/);
    expect(body).toMatch(/x\.seat_joined_at <= seat_payout\.created_at/);
    // the retained member record, whatever its status: no status filter
    const retained = body.slice(body.indexOf('IF v_club IS NOT NULL AND NOT EXISTS'));
    expect(retained.slice(0, 400)).not.toMatch(/status/);
  });

  it('the table club and the home club are removed and refused by the post-image', () => {
    expect(sql).toMatch(/c_from constant text := '\/\* THE SEAT''S CLUB FIRST/);
    expect(sql).toMatch(/c_to constant text := E'v_club := public\.fn_player_home_club\(p_user_id, NULL\);/);
    expect(sql).toMatch(/OR position\('fn_player_home_club' IN d\) > 0/);
    expect(sql).toMatch(/OR position\('FROM public\.tables t' IN d\) > 0/);
  });

  it('the weekly award reader attributes a wallet share to the hand earning club', () => {
    const reader = sql.slice(sql.indexOf('DO $reader$'), sql.indexOf('$reader$;'));
    expect(reader).toMatch(/COALESCE\(\(SELECT ra\.club_id FROM public\.rake_attributions ra/);
    expect(reader).toMatch(/ra\.hand_id=b\.hand_id AND ra\.player_id=r\.user_id/);
  });

  it('the proof source list follows the reader and no stale pin remains', () => {
    expect(sql).toMatch(/DO \$sources_pin\$/);
    expect(sql).toMatch(/JACKPOT_HAND_CLUB_LEFT_A_STALE_PIN/);
  });

  it('no later migration brings a table or home club back into the jackpot credit', () => {
    const later = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f > FILE)
      .filter((f) => readFileSync(join(DIR, f), 'utf8').includes('bbj_credit_one_recipient'));
    for (const f of later) {
      const text = readFileSync(join(DIR, f), 'utf8');
      expect(text, f).not.toMatch(/fn_player_home_club\(/);
      expect(text, f).not.toMatch(/SELECT t\.club_id INTO v_club FROM public\.tables t/);
    }
  });
});
