/**
 * ===========================================================================
 *  LAW - BOTH CLUB DATA SCREENS SHOW THE UNION INVOICE'S 2 AM WINDOW
 * ===========================================================================
 *
 * Owner, 2026-11-14: Club Data must equal the Midway union weekly invoices to
 * the cent, on the same 2:00 AM America/Chicago boundary, and "2026-11-02
 * through 2026-11-09" is exactly Mon Nov 2 2:00 AM to Mon Nov 9 2:00 AM: seven
 * days, [start, end), never eight calendar days.
 *
 * The stage 2 readers answer a union club (or the union itself) on that
 * accounting day and say so (accounting_basis 'union_invoice_accounting',
 * day_basis 'America/Chicago 02:00'); every other club keeps Chicago midnight
 * days. Both take the first and the last day, inclusive, so the screens send
 * the boundary the owner picked minus one day.
 *
 * Every pin below fails silently if it regresses: the page keeps rendering
 * and a week quietly becomes eight days, starts at midnight, double counts a
 * boundary hour, slips an hour across a clock change, or prints a rounded or
 * abbreviated figure.
 *
 * The SQL side of the same boundary (fn_ca_accounting_day_start) is pinned by
 * tests/club-data-reads-the-union-invoice-week.law.test.ts; the instants
 * below are what PostgreSQL 16 returns for it (measured 2026-11-15:
 * 2026-10-31 07:00Z, 2026-11-01 08:00Z, 2027-03-13 08:00Z, 2027-03-14 08:00Z,
 * 2027-03-15 07:00Z).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accountingDay,
  accountingDayStart,
  clubDataBoundaryClock,
  chicagoDay,
  chicagoDayStart,
  clubDataDayBasis,
  clubDataDayOn,
  clubDataWindow,
  clubDataWindowLabel,
  coverageNotices,
  coverageWindowLabel,
} from '../src/lib/clubDataDay';
import { clubDataWindowError, formatMoney } from '../src/pages/club/ClubDataSimplePage';
import { sumFigures } from '../src/pages/club/ClubDataTotalsBreakdown';

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const HOUR = 3_600_000;
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the invoice week is exactly [Nov 2 02:00, Nov 9 02:00) Chicago', () => {
  const week = clubDataWindow('2026-11-02', '2026-11-08', 'accounting');

  it('the date pair 2026-11-02 / 2026-11-09 is seven days, not eight', () => {
    expect(iso(week?.start)).toBe('2026-11-02T08:00:00.000Z');
    expect(iso(week?.end)).toBe('2026-11-09T08:00:00.000Z');
    expect((week!.end.getTime() - week!.start.getTime()) / HOUR).toBe(7 * 24);
    expect(clubDataWindowLabel('2026-11-02', '2026-11-08', 'accounting')).toBe(
      'Nov 2, 2026 2:00 AM To Nov 9, 2026 2:00 AM'
    );
  });

  it('includes the start instant and excludes the end instant', () => {
    expect(accountingDay('2026-11-02T08:00:00.000Z')).toBe('2026-11-02');
    expect(accountingDay('2026-11-02T07:59:59.999Z')).toBe('2026-11-01');
    expect(accountingDay('2026-11-09T07:59:59.999Z')).toBe('2026-11-08');
    expect(accountingDay('2026-11-09T08:00:00.000Z')).toBe('2026-11-09');
  });

  it('adjacent windows share one boundary: no gap and no double count', () => {
    const next = clubDataWindow('2026-11-09', '2026-11-15', 'accounting');
    const before = clubDataWindow('2026-10-26', '2026-11-01', 'accounting');
    expect(iso(next?.start)).toBe(iso(week?.end));
    expect(iso(before?.end)).toBe(iso(week?.start));
    // One-day windows tile the week exactly.
    let cursor = week!.start.getTime();
    for (let i = 0; i < 7; i++) {
      const day = accountingDay(cursor);
      const w = clubDataWindow(day, day, 'accounting')!;
      expect(w.start.getTime()).toBe(cursor);
      cursor = w.end.getTime();
    }
    expect(cursor).toBe(week!.end.getTime());
  });

  it('the screens send the boundary minus one day: the picker value is never the last day', () => {
    expect(clubDataWindowError('2026-11-02', '2026-11-09', '2026-11-15')).toBeNull();
    expect(clubDataWindowError('2026-11-09', '2026-11-09', '2026-11-15')).toBe(
      'The End Must Be After The Start.'
    );
    // Up to the boundary that closes today, never past it.
    expect(clubDataWindowError('2026-11-14', '2026-11-16', '2026-11-15')).toBeNull();
    expect(clubDataWindowError('2026-11-14', '2026-11-17', '2026-11-15')).toBe(
      'The Window Can End No Later Than When Today Closes.'
    );
    expect(clubDataWindowError('2026-11-02', '2026-02-30', '2026-11-15')).toBe(
      'Choose A Start And End Date.'
    );
    // Owner Nov17: only the past 90 calendar dates may be selected.
    expect(clubDataWindowError('2026-08-18', '2026-11-16', '2026-11-15')).toBeNull();
    expect(clubDataWindowError('2026-08-17', '2026-11-16', '2026-11-15')).toBe(
      'Choose Dates Within The Past 90 Days.'
    );
  });
});

describe('daylight saving comes from the zone database, never from +24 hours', () => {
  it('fall back: Pacific November 1 runs 25 hours and starts at 07:00Z', () => {
    expect(iso(accountingDayStart('2026-10-31'))).toBe('2026-10-31T07:00:00.000Z');
    expect(iso(accountingDayStart('2026-11-01'))).toBe('2026-11-01T07:00:00.000Z');
    expect(
      (clubDataWindow('2026-10-31', '2026-10-31', 'accounting')!.end.getTime() -
        clubDataWindow('2026-10-31', '2026-10-31', 'accounting')!.start.getTime()) /
        HOUR
    ).toBe(24);
    const day = clubDataWindow('2026-11-01', '2026-11-01', 'accounting')!;
    expect((day.end.getTime() - day.start.getTime()) / HOUR).toBe(25);
    expect(accountingDay('2026-11-01T06:59:59.999Z')).toBe('2026-10-31');
    expect(accountingDay('2026-11-01T07:00:00Z')).toBe('2026-11-01');
    expect(accountingDay('2026-11-01T07:30:00Z')).toBe('2026-11-01');
    expect(accountingDay('2026-11-01T08:30:00Z')).toBe('2026-11-01');
    expect(clubDataBoundaryClock('accounting', '2026-11-01')).toBe('1:00 AM');
    expect(clubDataBoundaryClock('accounting', '2026-11-02')).toBe('2:00 AM');
    const week = clubDataWindow('2026-10-26', '2026-11-01', 'accounting')!;
    expect((week.end.getTime() - week.start.getTime()) / HOUR).toBe(169);
  });

  it('spring forward, Sunday 2027-03-14: 02:00 does not exist, the day starts 03:00 CDT and runs 23 hours', () => {
    expect(iso(accountingDayStart('2027-03-13'))).toBe('2027-03-13T08:00:00.000Z');
    expect(iso(accountingDayStart('2027-03-14'))).toBe('2027-03-14T08:00:00.000Z');
    expect(iso(accountingDayStart('2027-03-15'))).toBe('2027-03-15T07:00:00.000Z');
    expect(accountingDay('2027-03-14T07:59:59.999Z')).toBe('2027-03-13');
    expect(accountingDay('2027-03-14T08:00:00Z')).toBe('2027-03-14');
    expect(accountingDay('2027-03-15T06:59:59.999Z')).toBe('2027-03-14');
    expect(accountingDay('2027-03-15T07:00:00Z')).toBe('2027-03-15');
    const w = clubDataWindow('2027-03-14', '2027-03-14', 'accounting')!;
    expect((w.end.getTime() - w.start.getTime()) / HOUR).toBe(23);
    expect(clubDataWindowLabel('2027-03-14', '2027-03-14', 'accounting')).toBe(
      'Mar 14, 2027 3:00 AM To Mar 15, 2027 2:00 AM'
    );
  });

  it('older Chicago answers retain their stated boundaries across both changes', () => {
    expect(iso(chicagoDayStart('2026-11-01'))).toBe('2026-11-01T05:00:00.000Z');
    expect(iso(chicagoDayStart('2026-11-02'))).toBe('2026-11-02T06:00:00.000Z');
    expect(iso(chicagoDayStart('2027-03-14'))).toBe('2027-03-14T06:00:00.000Z');
    expect(iso(chicagoDayStart('2027-03-15'))).toBe('2027-03-15T05:00:00.000Z');
    expect(clubDataWindowLabel('2026-11-02', '2026-11-08', 'calendar')).toBe(
      'Nov 2, 2026 12:00 AM To Nov 9, 2026 12:00 AM'
    );
  });
});

describe('the basis is the reader answer, and "today" follows it', () => {
  it('reads the basis from accounting_basis or day_basis; anything else is calendar', () => {
    expect(clubDataDayBasis({ accounting_basis: 'union_invoice_accounting' })).toBe('accounting');
    expect(clubDataDayBasis({ day_basis: 'America/Chicago 02:00' })).toBe('accounting');
    expect(clubDataDayBasis({ accounting_basis: 'chicago_net_money_flow' })).toBe('calendar');
    expect(clubDataDayBasis({})).toBe('calendar');
    expect(clubDataDayBasis(null)).toBe('calendar');
  });

  it('between midnight and 02:00 Chicago the two bases name different days', () => {
    const at = '2026-11-16T07:30:00Z'; // Mon 01:30 CST
    expect(clubDataDayOn('calendar', at)).toBe('2026-11-16');
    expect(clubDataDayOn('accounting', at)).toBe('2026-11-15');
    expect(clubDataDayOn('accounting', '2026-11-16T08:00:00Z')).toBe('2026-11-16');
  });
});

describe('a date-only parameter is a calendar label, never a UTC instant', () => {
  it('the browser reads "2026-11-02" as UTC midnight, the evening of Nov 1 in Chicago', () => {
    // Why the screens never build a boundary with new Date('YYYY-MM-DD').
    expect(chicagoDay(new Date('2026-11-02'))).toBe('2026-11-01');
    expect(accountingDay(new Date('2026-11-02'))).toBe('2026-11-01');
  });

  it('the screens turn the same string into 02:00 Chicago on that date, in any zone', () => {
    expect(iso(clubDataWindow('2026-11-02', '2026-11-02', 'accounting')?.start)).toBe(
      '2026-11-02T08:00:00.000Z'
    );
    expect(accountingDayStart('2026-02-30')).toBeNull();
    expect(chicagoDayStart('2026-13-01')).toBeNull();
    expect(clubDataWindowError('2026-11-02', '2026-13-01', '2026-11-15')).toBe(
      'Choose A Start And End Date.'
    );
  });

  it('neither screen builds a boundary from a bare date-only Date', () => {
    for (const page of [
      'src/pages/club/ClubDataSimplePage.tsx',
      'src/pages/club/ClubDataPage.tsx',
      'src/pages/club/ClubDataTotalsBreakdown.tsx',
    ]) {
      expect(src(page)).not.toMatch(/new Date\(\s*(startDate|endDate|start|end)\s*\)/);
    }
  });
});

describe('coverage is stated, never folded into a figure that looks final', () => {
  it('names missing, failed and not-invoice-exact days', () => {
    const n = coverageNotices({
      complete: false,
      missing_days: ['2026-11-03'],
      failed_days: ['2026-11-04'],
      not_invoice_exact_days: ['2026-11-02'],
      provisional: false,
      provisional_from: null,
    });
    expect(n.incomplete).toBe(
      'Incomplete: Not Yet Loaded: Nov 3, 2026. Load Failed: Nov 4, 2026. Week Boundary Not Invoice-Exact: Nov 2, 2026. These Totals Can Differ From The Union Invoice Until Those Days Are Whole.'
    );
    expect(n.provisional).toBeNull();
  });

  it('labels the open week provisional from its first uninvoiced 02:00', () => {
    const n = coverageNotices({
      complete: true,
      provisional: true,
      provisional_from: '2026-11-09',
    });
    expect(n.incomplete).toBeNull();
    expect(n.provisional).toBe(
      'Provisional From Nov 9, 2026 2:00 AM Chicago Time: No Weekly Invoice Has Been Issued For That Part Of The Window Yet, So These Figures Can Still Change.'
    );
  });

  it('a week boundary still awaiting its certificate is provisional, not incomplete (audit G4)', () => {
    const n = coverageNotices({
      complete: true,
      provisional: true,
      provisional_from: '2026-11-16',
      awaiting_boundary_days: ['2026-11-15', '2026-11-16'],
    });
    expect(n.incomplete).toBeNull();
    expect(n.provisional).toBe(
      'Provisional From Nov 16, 2026 2:00 AM Chicago Time: No Weekly Invoice Has Been Issued For That Part Of The Window Yet, So These Figures Can Still Change. Week Boundary Not Yet Certified: Nov 15, 2026, Nov 16, 2026. Tournament Entries Still Running At That Boundary Are Added When It Is Certified.'
    );
  });

  it('prints the reader window instants as the chip label', () => {
    expect(
      coverageWindowLabel({
        window_start: '2026-11-02T08:00:00+00:00',
        window_end: '2026-11-09T08:00:00+00:00',
      })
    ).toBe('Nov 2, 2026 2:00 AM To Nov 9, 2026 2:00 AM');
    expect(coverageWindowLabel(null)).toBeNull();
  });

  it('no copy carries an em dash', () => {
    for (const page of [
      'src/lib/clubDataDay.ts',
      'src/pages/club/ClubDataSimplePage.tsx',
      'src/pages/club/ClubDataPage.tsx',
      'src/pages/club/ClubDataTotalsBreakdown.tsx',
    ]) {
      expect(src(page)).not.toContain('—');
    }
  });
});

describe('figures are exact: never K/M, never rounded, never summed in floats', () => {
  it('prints the reader figure digit for digit', () => {
    expect(formatMoney(2052426.5)).toBe('2,052,426.50');
    expect(formatMoney(-195554.11)).toBe('-195,554.11');
    expect(formatMoney('123456789012345678.91')).toBe('123,456,789,012,345,678.91');
    expect(formatMoney(0.125)).toBe('0.12'); // two decimals, cut (Dan 2026-11-27)
    expect(formatMoney(undefined)).toBe('-');
    expect(formatMoney(3_544_599.22)).not.toMatch(/[KMB]$/);
  });

  it('a drilldown total is an exact decimal sum', () => {
    expect(sumFigures([0.1, 0.2])).toBe('0.3');
    expect(sumFigures([1951998.47, -2029901, 7218.35, -30942.59])).toBe('-101626.77');
    expect(sumFigures(['99999999999999999.99', 0.01])).toBe('100000000000000000.00');
    expect(sumFigures([])).toBe('0');
  });
});

describe('standalone and pre-union Data reports share Pacific boundaries', () => {
  it('keeps net-flow definitions distinct from union invoice accounting', () => {
    expect(
      clubDataDayBasis({
        accounting_basis: 'pacific_net_money_flow',
        day_basis: 'America/Los_Angeles 00:00',
      })
    ).toBe('pacific');
    expect(
      clubDataDayBasis({
        accounting_basis: 'union_invoice_accounting',
        day_basis: 'America/Los_Angeles 00:00',
      })
    ).toBe('accounting');
    expect(clubDataDayOn('pacific', '2026-11-16T07:59:59Z')).toBe('2026-11-15');
    expect(clubDataDayOn('pacific', '2026-11-16T08:00:00Z')).toBe('2026-11-16');
  });
  it('uses the same 25-hour and 23-hour days for every current report basis', () => {
    for (const day of ['2026-11-01', '2027-03-14']) {
      const standalone = clubDataWindow(day, day, 'pacific')!;
      const invoice = clubDataWindow(day, day, 'accounting')!;
      expect(standalone.start.toISOString()).toBe(invoice.start.toISOString());
      expect(standalone.end.toISOString()).toBe(invoice.end.toISOString());
    }
    expect(clubDataWindowLabel('2026-11-09', '2026-11-15', 'pacific')).toBe(
      'Nov 9, 2026 2:00 AM To Nov 16, 2026 2:00 AM'
    );
  });
});
