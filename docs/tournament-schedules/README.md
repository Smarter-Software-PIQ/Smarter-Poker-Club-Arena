# Reviewing Midway's weekly schedule

The seven day tabs are the editing surface. The maintained weekly JSON is the
reviewed publication source. An edit in Google Sheets does not publish or cancel
a tournament. Use the existing protected-main migration route after reviewing
the complete proposal; this workflow has no second publisher or background job.

## Validate and preview before applying

1. Export the Google Sheet as XLSX, preserving the hidden **Schedule ID** column U.
   The ID preserves identity through renames and start-time edits. Day rows for
   one ID must agree on settings. Deleting every row for an ID proposes removal.
2. Execute `scripts/tournament-schedules/midway-live-snapshot.sql` through the
   configured privileged database reader and save its single `snapshot` object
   as `live.json` in the task's owned external evidence directory. This is one
   read-only statement, with a consistent timestamp and no player mutations.
3. Run the maintained review tool, using paths in that owned directory:

   ```sh
   python3 -B scripts/tournament-schedules/review-midway-weekly.py \
     --candidate docs/tournament-schedules/midway-weekly-2026-11-07.json \
     --workbook "$REVIEW_DIR/proposal.xlsx" \
     --live "$REVIEW_DIR/live.json" \
     --output "$REVIEW_DIR/review.json"
   ```

   Omit `--workbook` to review an explicitly authored JSON proposal. Invalid input
   exits 2 and reports the cell/field. A live snapshot older than 15 minutes is
   refused by default. Reports identify the exact candidate and snapshot hashes.
   Capture a fresh snapshot before applying changes; a preview is not a lock on
   registrations or a promise of a final refund total.

4. Inspect every addition, removal and changed field, including resolved blind
   ladders and affected booked occurrences. The preview distinguishes eligible
   unstarted events, preserved started/finalized contracts and unknown state.
   The displayed chip subtotal is the outstanding recorded entitlement gross
   across wallet charges, ticket funding and satellite-seat entries, excluding
   already disposed entitlements. Funding-kind counts are separate. Final
   cancellation/refund authorization remains unknown until the existing exact
   cancellation authority verifies its rails, source credits and roster; the
   read-only preview does not claim that authority. Missing evidence stays unknown. This tool
   never executes a cancellation, refund, booking or publication.
5. Put the reviewed settings in the maintained JSON and the owning source
   migration, retain their equality/creation checks, then follow `PUBLISHING.md`:
   normal hooks, required checks, protected merge, exact migration installation
   and live configuration/booking readback. Existing started contracts retain
   their accepted terms. Do not replay prior cancellation receipts.

The workbook importer accepts unambiguous day/time, name, stack, guarantee,
rebuy/re-entry/add-on flags, game and existing blind-profile changes. It refuses
unsupported or conflicting data rather than guessing. A changed total buy-in
requires an explicit JSON principal/fee/total split. New events and full ladder
changes likewise require explicit JSON authoring; profile cells cannot silently
change a different ladder. The reviewed JSON is the full settings contract,
including fields the day tabs do not expose.

The existing required native schedule CI route invokes the validator and its
focused regressions before exercising real creation constraints and normalizers.
See `scripts/ci/fixtures/midway-weekly/README.md` for the exact isolation boundary.

## Reading the spreadsheet statuses

- **Definition status** compares recurring settings with the installed source.
- **Booking status** describes the next occurrence of that row's weekday/time:
  Open for registration, Published, Waiting for target, Outside booking window,
  Missing or Conflict.
- **Next published start (Central)** is populated only for an actual matching
  occurrence. A weekly definition does not imply every future date is booked.
- **Schedule ID** is hidden for readability and must be preserved during export.

Status cells are an on-demand snapshot, timestamped in Source notes. They do not
refresh automatically when registration changes. Ordinary events book within
72 hours, events costing at least 200 chips within six days; an explicit longer
spawn horizon may raise that floor to seven days. Satellites wait for an eligible
published target. The snapshot query mirrors those existing producer rules and
uses `America/Chicago` calendar dates across daylight-saving transitions.
