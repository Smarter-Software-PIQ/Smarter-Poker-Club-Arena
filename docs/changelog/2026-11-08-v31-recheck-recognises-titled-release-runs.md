# The V31 re-check recognises every engine release again

2026-11-08. After each engine release, the recheck-after-release job is meant to
re-check (and so keep serving) an active certified V31 playbook on the new
engine. It never did: it identified the release by the run's name, and release
runs are titled per engine ("Engine Release <sha>", the release workflow's
`run-name`). The successful release that put 391f7bc0 in service (run
42413295909) was answered "Not a successful protected-main engine release:
nothing to decide" (run 42415683930). No playbook is active yet, so nothing was
lost, but once R8 is promoted every release would have left it unbound.

`releaseEventAdmitted` now recognises the release workflow by its file path
(`.github/workflows/auto-deploy-hetzner.yml`), which every run carries
whatever its title. The test now uses the real payload shape of run
42413295909; it fails on the old rule and passes on the new one. This script
is CI control code outside the V31 decision closure and execution fingerprint.
The serving-binding page (fn_gto_v31_serving_binding_check, PR #10074) is the
backstop if a re-check is ever skipped again.
