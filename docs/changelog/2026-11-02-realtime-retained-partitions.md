# Realtime native schema parity

The isolated service now requires the genuine v2.144.0 tenant migration set: 91 versions through 20261009120000 with exact installed-version digest. Its native UTC timestamp defaults and SELECT/INSERT grant options are verified as supplied, without replaying obsolete fixture ALTERs or GRANTs.

A fresh Realtime database creates five UTC daily message partitions, from yesterday through three days ahead. Its 72-hour retention rule preserves seven partitions on an established deployment. The captured configuration adds only the two missing earlier partitions through normal partition DDL and owner assignment, inside the existing bounded bootstrap transaction. It refuses unknown shapes, dates, ACL/default-ACL drift, occupied names, populated tables and repeated installation; all existing relation/index/constraint/default/initial-ACL metadata and the genuine migration ledger remain guarded. The later ACL module is a strict readback of all eight native relations.

Focused date/contract tests and a genuine PostgreSQL17.11 execution of the complete pinned public schema proved the transition, native ACLs, attached indexes, rollback and independent readback. These checks do not certify the Realtime Elixir binary, hosted full-schema composition or product behavior.
