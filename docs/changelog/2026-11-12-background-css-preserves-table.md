# Background stylesheet failures preserve the active table

A global Vite preload-error handler could replace a working document when an
optional stylesheet failed. Its separate recovery probe could navigate before
the importing caller retried, clearing every mounted game and returning to the
same URL with a cache-busting query. A WebKit mobile-layout reproduction loses
the original table DOM on the previous implementation.

The global handler now only removes failed stylesheet links and leaves the
rejection with the importing caller, as it already did for JavaScript. The
maintained Vite transform invalidates the failed CSS memo, so retries load and
await the stylesheet. Critical lazy imports retain their bounded retries and
terminal recovery; failures are not cancelled into unstyled successful renders.

Regression coverage exercises optional JavaScript and CSS retry, failed-link
cleanup, and critical recovery after exhausted retries. The existing production
mobile WebKit spectator check injects a browser-local optional CSS failure and
requires the same mounted table through a natural hand cycle. No engine or
financial behavior changes. This establishes a reproducible reset mechanism;
it does not identify the historical request in the reported Safari session.
