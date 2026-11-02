# Sequence ACL observation and private restore ordering

Capture27 restored the schema and then refused exact catalogue parity. Bounded
samples identified sequence grant differences. Two independent defects were
reproduced on PostgreSQL17.11 using stock pg_dump and the actual private
restore-owner guards.

The observer used `acldefault('S', owner)`, which describes a foreign server.
Use the sequence code `s`, preserving all owner SELECT, UPDATE and USAGE rights
when an explicit owner-only ACL round-trips to NULL.

Separately, identity sequence creation inherited preinstalled table-owner
default grants. Defer only sequence defaults until after raw application DDL,
retaining exact original DEFAULT ACL blocks and validating the original
role/default catalogue before and after the private transaction. Preserve
ordinary application permissions, genuine providers and atomic rollback.

Stratify the existing eight mismatch samples across changed categories without
expanding their privacy or byte limits. Capture27 also found 28 constraints,
four triggers and one index differing; their underlying causes remain unknown.
Full-schema parity, connected application cases and live behavior are required
before those differences or the broader task can be closed.
