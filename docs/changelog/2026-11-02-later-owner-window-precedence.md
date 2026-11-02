# Later owner windows retain their reset restriction

A later explicit owner order can require :53 notice and a :55 cutover while the temporary Phase1 on-the-hour policy remains active. Previously the activation reader selected Phase1 first, and the transaction reserved an on-the-hour cycle even when an owner window was selected.

An exact reviewed owner-window record may now opt into `supersedesPhase1Schedule: true`, restricted to the :53 announcement shape. Fresh requests select that window; the transaction keeps prior-owner, foreign-operation and retained-custody checks, but does not reserve a competing hourly cycle. Existing routine entries keep their original policy. Expiry refuses a new engine request instead of silently allowing another reset schedule; independent client publication and legacy floor expiry remain unchanged.

Actual helper and transaction-function regressions failed before repair. The maintained wrapper executed all 26 native cases in five groups, passing in 48.99 seconds; root TypeScript and 1,822 source bindings passed. Tests preserve existing ownership, custody, expiry, notice and certificate checks. No actual owner-window authorization entry is added by this correction, and no runtime activation has occurred. Phase2 remains incomplete pending integrated qualification and live proof.
