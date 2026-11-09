# Evening report identifies the missing migration and the Backup run

The evening release report now compares the reported candidate's required migrations with production and the installed rows in its digest-bound Backup certificate. The summary names missing versions from either side, the physical certificate run and its actual target. The JSON contains all differences. The full production listing stays in the temporary runner snapshot.

For an executing refresh or certification, the report compares its phase start with up to three recent, successful physical Backup runs. It publishes the sample runtimes, estimated finish and margin to the next 03:30 America/Chicago cutoff. A missing phase start, unavailable history or elapsed time beyond the measured median yields an unknown finish. A pending certificate status can bind an executing run to its actual candidate. The workflow head is reported independently.

The report's existing workflow and JSON artifact carry these diagnostics. A known candidate mismatch marks it NOT_READY. Unreadable evidence marks it UNKNOWN when an engine change is owed.
