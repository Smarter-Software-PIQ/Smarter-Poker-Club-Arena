# An engine alert resolves its own episode (incident 484c4cee, 2026-11-21)

## What happened

`EngineReleaseFailed` (engine_alerts 3171, inbox 446445) stayed escalated after
an agent appended a correct resolved row (engine_alerts 3180, inbox 446778).
Intake (`smarter_private.reliability_ingest_alert`, ENGINE_EPISODE_IDENTITY_V1)
pairs an engine-alerts resolve with its firing row only through
`labels.engine_alert_episode_id` and the component. Neither row carried an
episode, so intake fell back to a member keyed by each row's own engine_alerts
id (`engine-alerts:EngineReleaseFailed:3171` and `...:3180`). The resolve
landed on a new member, was recorded `resolved_not_of_this_episode`, and the
incident closed only when the agent UPDATEd inbox row 446445 by hand.

## Root cause (read from rows and code)

`scripts/ci/record-engine-release-alert.mjs` raised `EngineReleaseFailed` with
no `engine_alert_episode_id`. Every resolve of such a row, by hand or by the
verified-ship auto-resolve (#11630), was unmatchable. The auto-resolve had a
second defect: its open-row query filtered and ordered on
`engine_alerts.created_at`, a column the table does not have (it has
`received_at`), so it threw and only warned before sending anything.

The engine's own journal (`server/src/services/engineAlertDelivery.ts`)
already carries the episode on both firing and resolved rows; it was never the
producer at fault.

## Fix

- `scripts/ci/engine-alert-episode.mjs`: a deterministic episode per
  fingerprint, the member key intake derives, and `buildEpisodeResolve`, which
  builds a resolve FROM its firing row (exact alertname, component,
  fingerprint, startsAt, episode; extra labels cannot override identity) and
  returns nothing for an episode-less row.
- `record-engine-release-alert.mjs`: the failure alert carries
  `engine_alert_episode_id`; the verified-ship resolve is built through
  `buildEpisodeResolve`, names any episode-less row instead of sending a
  resolve intake would reject, and reads `received_at`.
- The sanctioned manual path: operation `resolve` of
  `.github/workflows/triage-engine-release-incident.yml`
  (`scripts/ci/resolve-engine-alert-episode.mjs`). Given an incident id and a
  note, it reads the incident's open firing members and their firing rows and
  appends one resolve per member through `fn_record_engine_alerts`, then reads
  back intake's disposition. It refuses another family, a closed incident, no
  open firing member, or no member with an episode; it never UPDATEs or
  DELETEs. One manual resolve per episode: its `engine_alert_event_id` is
  derived from the episode, so a second, different request is refused (23505).
  No SQL migration was needed: existing intake already accepts these rows.

Pinned by `tests/an-engine-alert-resolves-its-own-episode.law.test.ts`.

## Not fixed here

- `OpenClawJobStale` rows (producer in the smarter-poker-workers repo,
  `src/routes/cron-staleness-watchdog.ts`) carry no episode either; incident
  723a21ea had five firing members keyed by row id on 2026-11-21. The manual
  path refuses them by name. Its producer needs the same change in that repo.
- Members raised before this change keep their row-id key; no appended row can
  resolve them. No EngineReleaseFailed member was open when this was written.
