# tests/a-missed-cycle-is-recorded-in-the-alert-store.law.test.ts

The latest definition of public.fn_ca_note_cycle_did_not_seal records the missed cycle in operational_alert_events (engine-cutover-watch, cycle-not-sealed:<cycle>, addressed to the Production Alerts fleet, warning so it never pages twice) before the owner's Messenger note, refuses to send without a store id, and the fixing migration records every cycle noted before it once.
