# A Horse Option Goes On Only With Recorded Evidence

The live option switch (#10999) wrote `on` for a non-style option whenever the note had the right form: `authority: <option> <file> sha256 <64 hex>`. Nothing checked that the file or hash meant anything. Hand Analysis recorded this as owed (note N1 on the switch registry), under the owner's rule of 2026-11-14 23:10 Chicago: "Evidence gates must validate the required approval/status semantics, not section presence alone".

## What Changed

Migration `20261116004500_the_horse_option_switch_on_needs_a_recorded_evidence_row.sql` adds one table, `ca_horse_option_switch_evidence`, and one function that writes it. `fn_ca_horse_option_switch_set` now refuses `on` for a non-style option unless the sha256 its note cites is recorded for that same option.

A record is one of two kinds:

- `evidence`: an independent ACCEPT with the evidence rows met. The reference names the review.
- `owner_forced`: the owner ordered it on with evidence not met. The reference is his verbatim order.

The record function refuses an option that is not registered, an off-only option, a style option, an empty reference and a malformed hash. No role writes the table directly.

## What Did Not Change

Off and clear need no record. The seven style options keep on, shadow, canary and off. Off-only options stay refused with any note. Rows already in the switch are not touched: an option that is on stays on, and switching it on again needs its record. The registered names and the follow-up route for new options are unchanged; this migration carries no name list.

## How To Switch An Option On

Both statements run as the service role and are audited.

```sql
SELECT public.fn_ca_horse_option_switch_record_evidence(
  '<option>', 'docs/horse-default-on.d/<option>.md', '<sha256 of that file>',
  'evidence',            -- or 'owner_forced'
  '<the ACCEPT reference, or the owner''s verbatim order>',
  '<reviewed head>',     -- or NULL
  '<actor>');

SELECT public.fn_ca_horse_option_switch_set(
  '<option>', 'on', '<actor>',
  'authority: <option> docs/horse-default-on.d/<option>.md sha256 <the same sha256>');
```

Off: `SELECT public.fn_ca_horse_option_switch_set('<option>', 'off', '<actor>', '<note>');`

## Proof

`scripts/ci/test-horse-option-switch-evidence-postgres.sh` installs the migration (twice) after its existing assertions and proves on a throwaway PostgreSQL 17: on without a record refused, on with a record of either kind written, a hash that is not recorded refused, another option's record does not open this one, off-only refused with any note, the record refusing off-only, unregistered and style options, and the access law.

## Limits

The database still cannot read the evidence file; it checks that someone with the service role recorded that hash for that option with a reference. Hand Analysis's operating rule (the owner posts the option, file, hash and serving build, and Hand Analysis answers ACCEPT or OWNER-FORCED) is what the reference points to.
