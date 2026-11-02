# Native perf package status preserves independent facts

The original operation's v2 read verified all fixed APT candidates and a clean dpkg audit, but a malformed status row discarded every status fact. Its exact offending output was not retained, so this repair makes no claim about that row or the installed package state.

The bounded read-only adapter now parses each fixed package status independently. A malformed row, unsupported architecture or duplicate alias invalidates that package's fact while preserving independently valid rows. Each unknown status row carries a closed reason; private labels and raw output remain excluded. The inner package schema is v3. Incomplete output and command errors keep the overall query and package read unverified. Empty versions remain unknown; no not-installed inference is added.

The existing isolated Ubuntu terminal-read case also exercises real dpkg-query against controlled private administrative status data, checks valid rows survive a malformed row, and verifies those administrative bytes remain unchanged. It adds no installation, expiry or native-fault case. Actual Linux execution remains required; local parser tests do not substitute for it.

The immutable original installer, package profile, native identity controller and planner remain unchanged. Original failed-install authority and retry prohibition remain intact. No installation recovery or native crash fix is claimed.
