-- 20261102201808_certification_cleanup_removes_the_spectator_membership
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 20:18:08 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- THE CERTIFICATION CLEANUP DOOR REMOVES THE SPECTATOR MEMBERSHIP ITS CALLER CREATES (2026-11-02).
-- scripts/ci/production-e2e-account.mjs prepare-spectator joins the reserved
-- post-deploy identity to KINGS CLUB through fn_join_club as an ordinary
-- zero-balance player under the club owner, and documents that cleanup
-- removes it with the identity. cleanup_reserved_certification_account
-- admitted a KINGS CLUB membership only with role 'admin' in both guarded
-- branches (Deep Stack staff, and the immutable-ledger-actor retirement), so
-- any run that also took the Deep Stack staff membership, or acted on the
-- ledger, was refused with *_HAS_AUTHORITY_OR_CUSTODY and its identity stayed
-- in KINGS CLUB, Deep Stack Society and Midway Union (2026-11-02: 16 such
-- identities were found in the real clubs; another was left at 19:11 UTC).
-- Both guards now admit role 'player' in KINGS CLUB beside 'admin', and the
-- retirement branch removes it; every other condition is unchanged (the
-- certification email, zero balances and credit, no agent other than the
-- club owner, no parent agent, no seat, no tournament, no ownership).
-- Applied as three exact replacements over the live definition, refused
-- unless each occurs once and the preimage is the installed one.
-- @live-proof: position($p$(club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid AND role IN ('admin','player'))$p$ IN pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure))>0
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
DO $patch$
DECLARE
 d text:=pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure);
 pre CONSTANT text:='c26eff38698d666a151ef188ef68b00d';
 r text[][]:=ARRAY[
  ARRAY[$o1$(club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid AND role = 'admin')$o1$,
        $n1$(club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid AND role IN ('admin','player'))$n1$],
  ARRAY[$o2$OR NOT (role = 'admin' OR (club_id = 'fade0000-0000-0000-0000-000000000001'::uuid AND role = 'player')) IS TRUE$o2$,
        $n2$OR NOT (role IN ('admin','player')) IS TRUE$n2$],
  ARRAY[$o3$AND (role = 'admin' OR (club_id = 'fade0000-0000-0000-0000-000000000001'::uuid AND role = 'player')) AND COALESCE(chip_balance, 0) = 0$o3$,
        $n3$AND role IN ('admin','player') AND COALESCE(chip_balance, 0) = 0$n3$]];
 i int;
BEGIN
 IF position(r[1][2] IN d)>0 AND position(r[3][2] IN d)>0 THEN RETURN; END IF;
 IF md5(d) IS DISTINCT FROM pre THEN RAISE EXCEPTION 'CERTIFICATION_CLEANUP_PREIMAGE_CHANGED'; END IF;
 FOR i IN 1..3 LOOP
  IF (length(d)-length(replace(d,r[i][1],'')))<>length(r[i][1]) THEN RAISE EXCEPTION 'CERTIFICATION_CLEANUP_PATCH_NOT_SINGLE %', i; END IF;
  d:=replace(d,r[i][1],r[i][2]);
 END LOOP;
 EXECUTE d;
END $patch$;
REVOKE ALL ON FUNCTION public.cleanup_reserved_certification_account(uuid) FROM PUBLIC, anon, authenticated;
COMMIT;
