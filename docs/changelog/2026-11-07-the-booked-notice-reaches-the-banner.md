# 2026-11-07 - The Booked Notice Reaches The Banner

Follow-up to #9952 and #9945 (Dan's 13:20 Chicago Lightning refusals).

- #9952 projected every booked owner window into the client (`bookedMaintenanceNotice`, `bookedMaintenanceNoticeText`) and its changelog said the banner shows it, but `MaintenanceBreakBanner` was not changed in that PR. It now is: outside a break, a booked window is shown ahead of the routine 4 AM notice ("Short Maintenance Break Possible Between 1:00 PM And 7:00 PM Chicago Time. Play Pauses For About Five Minutes."). A live break or a frozen entry door still outranks it.
- #9945 stopped `LightningEntryPage` from reporting a freeze refusal as a failure, which also hid it from #9952's freeze gauges (`fn_client_error_health.freeze_refusals_10m`). It is reported again under `LightningEntryPage.entry_frozen`; `errorReporter.pickCode` files it as `PLATFORM_FROZEN`, so it is counted as a freeze refusal and never as an error spike.

Law test: `tests/the-booked-notice-reaches-the-banner.law.test.tsx`; the Lightning page test now asserts the freeze is reported under its own source.
