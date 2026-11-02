# Cash game spectator navigation

Every cash lobby View/Watch action prepares and opens the public table,
including Lightning games whose participation entry remains on Join Lightning.
Embedded lobby details close after successful preparation. Existing game tabs
are reused even at the four-game cap and when navigation repeats the same URL.

Cash View controls disable while preparing; controls without a viewer disable
instead of silently doing nothing. Failures retain the existing visible error
and leave details available for another attempt.

Regression coverage renders cash cards on desktop and mobile across variants
and game modes, verifies viewing never joins or changes a waitlist, exercises
preparation and failures in the mounted lobby, and exercises tab reuse in the
mounted multi-table page. These run in the required client unit-test check.
