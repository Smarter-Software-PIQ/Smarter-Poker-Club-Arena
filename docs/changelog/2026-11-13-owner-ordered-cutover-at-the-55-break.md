# Owner-ordered engine cutover at the :55 break

The owner ordered the engine changed over now, at a normal :55 break. Every commit since `49cbcd2b` had failed Backup certification because the standby restore did not create the production role `daily_content_reporter` (#10665), and the newest certificate, `f53b50f1`, carried the unsupported #10628 rule enabled. This books one single-use engine window for the exact serving predecessor `08c27924`, containing #10650.

The announcement guard that keeps an engine break clear of the hourly tournament break is not changed, so the break cannot cover :55 to :00. The window runs 21:38 to 22:00 Chicago, so the only break that fits ends before the tournament break and play returns as that break begins; a deferred announcement cannot fit and is refused. No runtime strategy or SQL bytes change.

Certification, dispatch, seal, thaw and live outcomes are recorded in the owning release checkpoint, not claimed here.
