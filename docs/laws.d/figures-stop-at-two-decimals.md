# tests/figures-stop-at-two-decimals.law.test.ts

Dan, 2026-11-27: "NUMERS AFTER A DECIMAL NEED TO STOP AFTER 2 DIGITS ANY WHERE AND EVERYWHERE." Pins that every shared figure formatter prints at most two decimals (Cash Rake Today 403.3814552027556 reads 403.38), that the extra digits are cut and never rounded (0.999 reads 0.99, per the 2026-09-04 no-rounding rule), that a tiny negative never prints as -0.00, that stored values stay exact, and that `src/utils/twoDecimalDisplay.ts` caps the browser's default `Number#toLocaleString()` as the first import of `src/main.tsx`.
