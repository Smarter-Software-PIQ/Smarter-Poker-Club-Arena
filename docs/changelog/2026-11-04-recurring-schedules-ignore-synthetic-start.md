# Recurring schedules can be saved outside event start hours

The Create Tournament modal no longer validates a synthetic immediate start when saving only a recurrence. The schedule spawner owns the actual event time. Recurrence plus a one-off still validates that event before saving the schedule, and TableConfigPage is unchanged.

Regression: the real modal and configuration builder refuse a daily schedule at Chicago midnight before this change and accept it afterward. The focused suite also preserves the midnight one-off refusal and exact daytime one-off start while omitting startTime from the schedule payload.

Validation: 53 modal recurrence/axes tests passed. Publication and live verification remain separate delivery requirements.
