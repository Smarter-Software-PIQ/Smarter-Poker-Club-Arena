-- @live-proof: EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Players list their own operator avatar objects' AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[])
-- Save approved published avatar assignments in the existing private ownership
-- ledger, independently of the single equipped-avatar mirror. The asset paths
-- come from the verified custom publication map and current assignment readback.
-- Operator-created storage objects keep their assignment in the object key.
BEGIN;
SET LOCAL lock_timeout = '2s';

INSERT INTO public.avatar_unlocks (user_id, avatar_id, unlock_method)
SELECT p.id, 'custom-art:' || art.asset_path, 'operator_upload'
FROM (VALUES
  ('99877ca4-6de2-4407-8f1c-322851461e1a'::uuid, '/avatars/table/custom_complete_d37c37f20ee2cad3@2x.webp'),
  ('7e616640-58dd-4d8d-a18e-2f37f057bcd9'::uuid, '/avatars/table/custom_complete_18f0699283328e6e@2x.webp'),
  ('7e616640-58dd-4d8d-a18e-2f37f057bcd9'::uuid, '/avatars/table/custom_complete_73072f2a2aa98d3d@2x.webp'),
  ('41da1807-7cd1-4e0e-b60c-38ffe0d962e9'::uuid, '/avatars/table/custom_complete_42fd8b6f6c4ad623@2x.webp'),
  ('ec174028-bacb-4d30-b577-fc9243c574f7'::uuid, '/avatars/table/custom_complete_c5f5a8c1b7012b74@2x.webp'),
  ('abe28116-2cc8-4e5e-99ab-9ace99ebf781'::uuid, '/avatars/table/custom_complete_c109592c8cfaddb0@2x.webp'),
  ('d2914627-745d-4e55-b081-a105f255b54a'::uuid, '/avatars/table/custom_complete_3cc909ae5d88316a@2x.webp'),
  ('9004abc7-3c55-48da-8a63-657f60d35ca1'::uuid, '/avatars/table/custom_complete_d26e7f051db82666@2x.webp'),
  ('b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216'::uuid, '/avatars/table/custom_complete_fe70c4d8bb381471@2x.webp'),
  ('1a6964d4-5aab-4ec6-8d5d-74f1572bdb1a'::uuid, '/avatars/table/custom_complete_7f10ed2af667ba12@2x.webp'),
  ('9b2f1aa6-c7dc-42e5-a73e-137a9493f3c8'::uuid, '/avatars/table/custom_kaelastacks_20261105.png'),
  ('47965354-0e56-43ef-931c-ddaab82af765'::uuid, '/avatars/table/custom_complete_843ce7ea72fe7a0d@2x.webp'),
  ('388dc5ea-0e9f-4a49-865f-d14737f58713'::uuid, '/avatars/table/custom_complete_4b54611bbfb7d88b@2x.webp'),
  ('3bb71bfe-f723-427c-aac7-a853ba04a014'::uuid, '/avatars/table/custom_complete_10532176e04b308b@2x.webp'),
  ('c9b675bc-cd6f-4196-9483-2959ade947b5'::uuid, '/avatars/table/custom_complete_433068844d76bfbb@2x.webp'),
  ('e5abee6e-abe2-4400-9005-b5c81577155d'::uuid, '/avatars/table/custom_complete_0da1fb1798f3cae1@2x.webp'),
  ('7d31b237-b893-49b7-be84-6e25b143d8e8'::uuid, '/avatars/table/custom_complete_4342d338731689df@2x.webp'),
  ('9ca264f1-c0aa-4df9-bc39-1a97bdaad016'::uuid, '/avatars/table/custom_complete_6cb197d65578c31b@2x.webp'),
  ('9ca264f1-c0aa-4df9-bc39-1a97bdaad016'::uuid, '/avatars/table/custom_complete_7f7b826d18995340@2x.webp'),
  ('6b0f6365-e866-4d6b-b0a8-7678bcbdcb4c'::uuid, '/avatars/table/custom_complete_5444979bbcd6722d@2x.webp'),
  ('5807334e-45ed-4fe7-bfeb-85f4745c3abe'::uuid, '/avatars/table/custom_complete_a837b0680094f110@2x.webp'),
  ('69f2cefa-017d-49f3-ac3e-61505633747c'::uuid, '/avatars/table/custom_complete_0131b099c918d884@2x.webp'),
  ('40d1eb2b-a528-4baa-ab87-41bc650bf9b4'::uuid, 'generated/40d1eb2b-a528-4baa-ab87-41bc650bf9b4_1793936602252.png')
) AS art(user_id, asset_path)
JOIN public.profiles AS p ON p.id = art.user_id
JOIN auth.users AS u ON u.id = art.user_id
ON CONFLICT (user_id, avatar_id) DO NOTHING;

-- Only privileged uploads have no owner_id. Keep listing strictly confined
-- to the recipient and the two established operator object key formats.
CREATE POLICY "Players list their own operator avatar objects"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'custom-avatars'
  AND owner_id IS NULL
  AND name ~ (
    '^(avatars/free/owner_' || (SELECT auth.uid())::text ||
    '_|generated/' || (SELECT auth.uid())::text || '_owner_)[a-f0-9]{16}[.]png$'
  )
);

COMMIT;
