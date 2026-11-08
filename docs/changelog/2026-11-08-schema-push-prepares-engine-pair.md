# Prepare both exact engine proofs when schema inputs change

Protected main `2447fda7ae9bc093065492a2caa394f0e0d72af2` added migrations after the successful `36a5c44335388cce26c35f73c79f59ce1dde1706` Backup restore. Neither qualification workflow subscribed to migration-only pushes. The daily selector correctly refused the older restore, while a later scheduled Backup would not supply the missing exact prequalification for a client/schema head.

Both existing push filters now include `supabase/migrations/**`. Existing plan ancestry keeps a new migration push's SHA instead of retargeting backward to an older server commit; the inherited-proof guard forces physical certification for changed migration history. Existing refresh and strict selector checks remain unchanged. Focused regression covers paired triggers, exact migration target, and changed-schema inheritance refusal. No scheduler, manual dispatch or client-only qualification is added.
