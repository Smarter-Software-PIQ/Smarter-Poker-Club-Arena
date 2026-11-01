# Only Today’s Top Events Are Pinned

The old rule kept every started event and any sole upcoming edition pinned. When today’s Nightly 10K was already running, its sole future edition was mistaken for a weekly flagship, putting both editions at the top.

All tournament displays now pin a host-featured event only when its start date is today in the viewer’s calendar. Future nightly and weekly events remain in their normal schedule position without the red featured frame. No tournament is deleted and no database flag changes. Regression coverage includes a running edition with one future edition, weekly events, unknown dates and local midnight.

The required browser shards were blocked before test execution when ubuntu-latest rolled to Ubuntu 26.04, which locked Playwright 1.58 does not support. The three browser-consuming jobs (CSS, Diamond and Production Build performance checks) now use the same supported Ubuntu 24.04 hosted image as their last successful run. Their suites, matrices, assertions and required aggregates are unchanged.

The money-trigger pre-install Node contract remains dependency-free while enforcing those exact three supported runner routes; all other runner expectations are unchanged.
