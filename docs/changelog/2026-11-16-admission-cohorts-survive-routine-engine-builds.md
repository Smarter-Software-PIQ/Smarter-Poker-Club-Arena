# Admission cohorts survive routine engine builds

The modern population-policy producer already hashes admission semantics rather
than deployment identity. The collector's compatibility reader used a different
encoding for the pre-fingerprint engine, so replacing that engine with an
otherwise identical policy would discard the cohort a second time merely because
the new health response includes `policyFingerprint`.

The collector now canonicalizes those two wire representations to the existing
published cohort key. The immutable predecessor selects its proven policy;
modern engines select by their complete semantic fingerprint. Build SHA,
version, uptime and unrelated strategy metadata never select a modern cohort.
The historical `legacy-release:` string remains a stable wire alias, not the SHA
of the current deployment. Keeping that alias preserves already collected data.

The predecessor's v1 population fingerprint is `2624902867899093`. It was
calculated with the real v1 engine algorithm against immutable revision
`3529e86663daa427b380a8ab9bd09347270c670e`: StableHand blob
`d35988de4eedd8cd4c0a78781b414665b9539361`, HorseCashSchedule blob
`f4a51e021af1a8d4286534c36c1485c67505a26a`. The retained fixture contains the
complete 1,440-minute planned curve and variant/stake matrix. A wire-contract
regression runs the actual producer algorithm on those fixed inputs, so future
real policy changes can change their inputs without gratuitously changing the
identity of these inputs.

The real shell collector regression failed before the fix on the old-to-new
protocol transition. It now covers routine build identities, rollback, changed
SQL, changed population semantics, malformed/missing policy and large health
responses. Unknown legacy releases remain unreadable. Different SQL definitions
or population policies remain different cohorts.

No alert, historical sample, qualification duration or sample minimum changes.
The existing warmup still needs three real historical days under the same policy;
this prevents an unnecessary future restart of that process. Delivery uses the
existing Deploy Monitoring publisher; production must retain the same current
cohort and fresh policy observations. No engine replacement is required.
