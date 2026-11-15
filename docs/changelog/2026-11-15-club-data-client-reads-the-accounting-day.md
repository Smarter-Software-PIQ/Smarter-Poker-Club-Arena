# Club Data screens read the union invoice's 2 AM accounting day (stage 2, client)

Owner, 2026-11-14: Club Data must equal the Midway union weekly invoices to the
cent, on the invoices' 2:00 AM America/Chicago boundary, and the date pair
2026-11-02 / 2026-11-09 is exactly Mon Nov 2 2:00 AM to Mon Nov 9 2:00 AM.

The stage 2 readers (PR #10921) answer a union club, or the union itself, on
the accounting model and say so (`accounting_basis: 'union_invoice_accounting'`,
`day_basis: 'America/Chicago 02:00'`, `accounting_coverage`); every other club
keeps Chicago midnight days. This is the client half.

## What changed

- `src/lib/clubDataDay.ts`: the day basis is read from the reader's answer
  (`clubDataDayBasis`); "today", day starts and windows on either basis
  (`clubDataDayOn`, `clubDataDayStart`, `clubDataWindow`, `clubDataWindowLabel`),
  Chicago midnight found from the zone database like 02:00 already was;
  `isCalendarDate` refuses 2026-02-30 and 2026-13-01; coverage notices for
  missing, failed and not-invoice-exact days and for the provisional open week.
- Both screens (`ClubDataSimplePage`, `ClubDataPage`): the range chip prints
  the window by its boundaries (the reader's own `window_start` / `window_end`
  when stated); the end the owner picks is the boundary the window stops at,
  and the readers are sent that boundary minus one day; "today" follows the
  basis (a union club between midnight and 02:00 Chicago reads the accounting
  day still open); union-basis definitions of Fee, Total Winnings and MTT
  Winnings with what equals the invoice (Rake Generated, Player Win/Loss) and
  what does not (chips on the felt, shown and not added; running tournament
  entries, counted in the week they settle); incomplete and provisional
  banners.
- Total Winnings on the union basis is cash winnings plus every tournament
  result (MTT Winnings, Sit And Go results and unfinished MTT entries); MTT
  Winnings is finished MTTs only, and the Unfinished MTT Entries line says it
  is inside Total Winnings (review correction, 2026-11-15).
- Between midnight and 02:00 Chicago a union club's readers clamp the last day
  to the accounting day still open. The full report asks for the calendar day
  before it knows the basis; a clamped answer (snapshot or player reads) now
  sets the basis and re-reads the open day instead of failing as "Could Not
  Load Club Data" (review blocker, 2026-11-15).
- Simple screen URL: `dataStart` + `dataUntil` (the boundary). A legacy
  `dataEnd` link is still read as the last day.
- Agent (downline) fee tile: on the union basis it is the downline's
  accounting fees (`definition: 'downline_accounting_fees'`), labelled
  "Downline Fees", not "My Fees Earned".
- Player drilldown (`ClubDataTotalsBreakdown`): labels the same window from
  its own answer's basis and coverage; totals are exact decimal sums (BigInt),
  figures exact, never rounded to two places.
- Full report exports: every CSV row carries `window_start` / `window_end`
  (UTC instants of [start, end)), taken from the verified answer the export
  belongs to (the reader's own boundary instants on the union basis); file
  names carry the picked pair (`club_data_<start>_to_<end>.csv`).
- Full report, union clubs and the union: the Rake Snapshot panel is labelled
  "Agent Rake Production: Seat Club And Agent Downline, Chicago Midnight Days.
  Not The Union Invoice Basis." and its headline reads "Agent Rake
  Production", never "Fee" (RakeSnapshotPanel `headlineLabel`, default
  unchanged for every other caller).

## Changes every club sees

- The end-date pickers on both screens now mean the boundary the window stops
  at, for every club (12:00 AM for a club in no union, 2:00 AM for a union
  club). The windows read are the same; a legacy `dataEnd` link still means
  its last day.
- The CSV file names changed for every club, to `club_data_<start>_to_<end>.csv`
  and `club_players_<start>_to_<end>.csv`.
- Accepted edge: a `dataUntil` URL written before 02:00 for a union club can
  name the boundary one day past the open accounting day; it is refused as
  outside the window and the screen shows today.
- Full report: a note that the Rake Snapshot panel keeps its own periods on
  Chicago calendar days and is not the invoice basis.
- Money on the Simple screen prints through the exact formatter
  (`formatWalletChips`), never K/M and never rounded.

## Verified

Law `tests/club-data-shows-the-accounting-window.law.test.ts`: exactly-2-AM and
one millisecond either side of each boundary, adjacent windows, the 2026-11-01
(25 h) and 2027-03-14 (23 h, starts 03:00 CDT) days matching PostgreSQL 16, the
browser's UTC reading of a date-only string, notices and exact figures.
Component tests for both screens on the union basis. `npx tsc --noEmit` clean.
