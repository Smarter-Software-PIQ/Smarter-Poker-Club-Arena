# Backup restores Lightning lane grants

Backup refresh 42917003209 failed restoring the production schema because `engine_lightning_lane`, introduced by #10392, was absent from the isolated role prerequisites. Add that exact role to the existing pre-restore loop as NOLOGIN. The production login and credential are never copied; all original ACLs, isolation, strict restore errors and schema validation remain unchanged.

The existing DR shell regression now refuses schema restoration until that role exists and confirms a failed role creation invalidates the previous copy. Exact Backup certification and production activation remain separate required delivery evidence.
