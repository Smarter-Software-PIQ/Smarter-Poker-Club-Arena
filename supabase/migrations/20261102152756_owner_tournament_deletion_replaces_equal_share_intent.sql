-- Explicit owner instruction, chat01a19ccc, November2: delete old started
-- events; remaining chips to Midway Union Main Bank, Diamonds to KingFish.
-- Equal-share disposition is revoked for these exact140 identities. Empty
-- waiting SNG/Spin registrations are explicitly excluded. No funds move here.
-- This durable instruction is a prerequisite for the terminal deletion writer;
-- installing it is not evidence that deletion or transfer has occurred.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
CREATE TABLE smarter_private.owner_tournament_deletion_intents(
 tournament_id uuid PRIMARY KEY,
 original_started_at timestamptz NOT NULL CHECK(original_started_at<'2026-11-02T06:00:00Z'),
 asset text NOT NULL CHECK(asset IN ('chips','diamonds')),
 destination_id uuid NOT NULL,
 owner_chat_id uuid NOT NULL DEFAULT '01a19ccc-894e-75e2-a9e7-fe0d2df6c326',
 requested_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK((asset='chips' AND destination_id='fade0000-0000-0000-0000-000000000001')
 OR (asset='diamonds' AND destination_id='47965354-0e56-43ef-931c-ddaab82af765'))
);
REVOKE ALL ON smarter_private.owner_tournament_deletion_intents FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO smarter_private.owner_tournament_deletion_intents(tournament_id,original_started_at,asset,destination_id) VALUES
('0640f029-0372-4ca7-bb46-7cfd248da7b3','2026-11-01T23:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('0771b01a-b8ea-434b-bf2e-f7d4651d445e','2026-11-01T02:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('0903a95a-d53e-41f5-955f-6ea8c2150cf1','2026-10-31T17:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('095d7449-3282-46c5-8a39-768fe14dce5a','2026-10-29T05:52:47.484694+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('0cb8e80f-4031-4b72-bbd6-f076605f1575','2026-10-29T05:46:32.655496+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('0d98f87e-65bb-483c-b34d-0cc6af4a4e29','2026-10-29T22:45:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('0ef3dbfb-c092-4008-b7bd-bde65a474e83','2026-10-29T05:47:09.244299+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('0fc27b7b-4290-4e73-8680-9791e021f114','2026-10-31T01:00:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('10146b16-aaac-4606-a2aa-7bbc3863b750','2026-10-29T17:30:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('112ea67a-3885-4755-84cc-5f8523d3f82c','2026-10-29T05:32:18.758966+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('11615efe-bd76-4f8d-807c-f1f22bf345f9','2026-11-01T00:32:28.622764+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('120ffb44-a3e6-4691-a52c-450768a09056','2026-10-29T21:30:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('1294ab27-2191-484c-aa3e-98192de09e44','2026-10-29T05:41:18.734663+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('135b187e-c096-483a-b347-10be69df956b','2026-10-29T05:38:07.15777+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('15202cb0-648c-4583-a6f9-9512a6e678c6','2026-10-29T04:57:52.626421+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('161b65b2-a718-4fd7-9a6b-f60fbd77a40a','2026-11-01T17:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('16761305-83ad-4282-be72-5b9cb2dd88bc','2026-10-31T20:30:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('19349646-5d29-4e79-a65d-c01be5c0a7e6','2026-10-29T16:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('19486d1f-2959-41e5-9268-5e0908e0d356','2026-10-31T16:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('197ed0bd-8fdb-4897-b001-dfe902139f9c','2026-10-29T09:06:38.932191+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('19cf1192-d926-4042-a13c-67eca5ebf9a3','2026-10-29T05:33:21.242734+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('19d83ee0-03ed-4603-b4f0-2d5a944c7f15','2026-10-31T20:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('1bd6558e-1964-41d9-9ceb-cb908fde6c1a','2026-11-01T20:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('2305ddd2-58af-43fb-9089-567108e4ca77','2026-10-29T05:39:23.767813+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('261eacc5-a26b-40c8-a30e-1913ab6e5a9e','2026-11-01T14:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('26ebb662-63bf-4bc5-9ac8-962bc5ad8849','2026-10-29T19:15:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('2781bcd7-cc8a-4713-ab3e-0d0a81fdf110','2026-10-29T20:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('27b49998-863d-44f7-8f11-f38d4de476b8','2026-10-29T22:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('28fd0051-32fa-408d-950e-3a556c5979b2','2026-10-31T02:30:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('295fbdf9-653b-4389-961b-26bc83589219','2026-10-31T18:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('2b654457-f2ef-42c8-b72a-1c8dbc8885d5','2026-11-02T02:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('30bac12f-028e-4d05-841a-9c900c779850','2026-10-29T20:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('354624e9-5f96-4baf-afe8-294c701f7b5e','2026-11-02T00:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('369d46bd-1eba-44bf-a80f-fb19ec980614','2026-10-29T20:45:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('36c4dd29-99ca-4bc8-b719-416b82036b1f','2026-10-31T20:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('37b4adc0-f9f4-484e-a914-3c50749055df','2026-10-31T00:00:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('3859e739-513e-4ed5-af23-5a190aa40f46','2026-10-29T05:41:19.433237+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('41392bff-72d7-46bb-b4ae-8f393d000810','2026-11-01T23:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('4163a647-780e-4a5e-910f-ccc0fe5cf218','2026-10-29T22:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('45072749-ed7a-4e27-9891-f21cdd44a20a','2026-10-29T19:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('46ba2e7c-c9f8-42b6-b416-d7342a676531','2026-10-29T05:37:29.025329+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('4908686b-aade-485e-b16f-a473a9ccdbca','2026-11-01T00:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('4b7f3840-cc55-49b7-acd0-57216a89d044','2026-10-29T04:46:17.587509+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('4d88fc8c-a6d7-4e93-8cb6-ac45acb4e35d','2026-10-29T04:56:35.104923+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('4dfe400c-c942-41df-9e6b-bbd8336c9cf7','2026-10-29T05:14:22.133424+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('4e2cc712-8773-4d00-8927-6319153bddf4','2026-10-29T05:10:22.259956+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('525a9726-68f5-4deb-8071-d62a9c6d9480','2026-11-01T15:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('54abdabf-d625-4785-9b0e-099037446189','2026-10-31T23:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('54ca613b-0bd2-4492-8610-b1281dbaa822','2026-11-01T16:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('551125c0-4129-4f28-b174-caedb576cd99','2026-10-29T04:58:11.652+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('5638ff13-7d12-4a54-b784-4f309792db60','2026-10-29T05:24:43.988797+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('57af2978-595b-41b8-b302-d68de81c0c3a','2026-10-31T19:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('5a3e686c-8a9e-4c7c-b2c3-829c6a1ce096','2026-10-29T05:13:43.652109+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('5c05942e-3eac-4f3b-90e5-1f25942a36ba','2026-11-01T21:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('5ef9868a-03d3-4d3b-bc92-41c63bd8b10c','2026-10-29T05:23:42.904496+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('6379b29e-1307-4e8b-91e7-e9a0975cd64d','2026-10-29T17:30:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('6429087f-a9d1-49a3-b7cf-85e1ee283ac9','2026-10-29T05:30:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('644379fb-3252-412a-a843-378a77470790','2026-10-31T22:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('64599cc4-03bb-4f1d-8df7-ef610abe10af','2026-10-29T05:36:54.058722+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('65cb94c0-752a-43b4-981d-098294d044f9','2026-11-01T01:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('68af0f95-82f5-4047-b424-6780a4236f4d','2026-10-29T06:00:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('6a0cbe20-8139-4c73-90d0-a038c5095387','2026-11-01T20:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('6acde8fb-5631-4320-965d-bf9dbf01c4d8','2026-10-29T16:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('6c6724e5-1ee4-40c0-ad21-44e9f9b6d800','2026-10-29T05:50:16.234889+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('6d047305-e5ac-4200-803f-399c83cf76f3','2026-10-29T04:51:05.203999+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('6f25fd3f-b96a-40be-b32b-e9f8a39c22e8','2026-10-29T05:28:50.396822+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('73ad085c-0598-4202-84fc-27d30604d134','2026-11-01T18:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('768cb55b-e915-4a01-9c74-f97535f700a3','2026-10-29T05:45:52.298419+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('7850aedc-640b-4905-b9e1-61d75d9543d0','2026-10-29T05:02:19.715945+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('78d24c32-683a-42fa-8d7a-b5cf6dadf251','2026-10-31T01:30:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('78ed8458-4ffd-416a-a8fd-d0f0c5e3509e','2026-10-29T05:22:28.231303+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('7932d2bb-7cfb-4b0e-ae99-75fcbae82d52','2026-10-29T05:36:54.041523+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('7986217a-0a67-4585-bd43-254356a9cb54','2026-10-29T05:30:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('7ab02286-fa29-44a2-a64f-0cb3d60ca572','2026-10-29T05:49:11.118422+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('7de6c45c-ac37-4c32-a22a-4faea11d6cfa','2026-10-29T05:02:19.884519+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('80861496-ee6c-498e-bae4-4d6acd8381c2','2026-10-29T05:01:25.223722+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('8229a0af-3c5a-4672-b9df-3d8523613086','2026-10-29T05:35:12.503006+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('83d66653-e765-4cb8-943e-0ac3d510ad06','2026-10-31T20:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('85bec2f4-0aa8-42b8-8799-d9d3acff2275','2026-10-29T05:40:03.744611+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('8855c50e-c4ed-4235-91c1-323627023b15','2026-10-29T05:35:11.762502+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('8aae8210-0444-455f-97f6-19a3a072eda0','2026-10-29T05:02:19.479713+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('8b7cc4f1-b7d8-48f9-b3da-b15dff5cbed3','2026-10-31T16:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('8d8a5ecf-29c6-49e7-82fa-3109b6681fb6','2026-10-29T05:09:40.275828+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('90fc40a9-0f76-4835-a1e9-5c487f32b2c8','2026-10-29T05:25:53.300389+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('928dc47d-14b8-4721-9990-a5ccfd57a41e','2026-10-29T21:15:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('94beb183-6b2a-4dbf-b1ea-556bf9681124','2026-10-29T04:39:41.730995+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('94eefeb1-5435-4fdd-b601-dbd7938bfd82','2026-11-01T11:36:20.855049+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('95760eed-827d-4502-8be6-cfb8ec610e1b','2026-10-29T05:21:48.503988+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('962cb5ce-3255-4ac3-9672-769752b4d169','2026-10-29T05:02:19.472732+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('97b69931-4644-4e90-8f50-b70b9a247715','2026-10-31T21:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('9b0e7b08-17ad-46ad-be00-9745f788cdd3','2026-10-29T04:43:58.104934+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('9b23a2ec-d514-457f-ac61-fc80722068ad','2026-10-29T05:00:50.192779+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('9e527f7b-d2b5-499c-a0c1-0720e5e29369','2026-11-01T15:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('a3e9d95e-9f0a-4b6b-9652-f6c697baadac','2026-10-29T05:28:16.636917+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('a54bdd4f-26b8-47c5-aa24-2c2b97b14015','2026-10-31T00:30:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('aa8e9409-8385-4a8d-9607-9bbc00769f97','2026-11-01T14:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('b2870f16-db00-4820-a2d7-b5fc76e627ab','2026-10-29T09:06:56.645779+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('b6435b76-7225-4d40-87fe-52f3a9d4521e','2026-10-29T05:41:19.015171+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('b67b1975-f8cb-417b-87f9-9910c8290178','2026-10-29T04:59:15.99216+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('b8484257-68b3-4961-aad3-4b096bb7c7b5','2026-10-29T21:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('bab7002d-4e6c-4845-a6e0-af16a35a70cc','2026-10-29T05:00:13.548507+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('bc8b63f8-5d0b-46c3-9693-e80174d42934','2026-11-01T18:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('be27c5a4-8282-4dd1-8881-fe1145a94b5e','2026-10-29T05:18:49.581966+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('bed32f92-c2e5-485e-aa90-5ff62bdfd325','2026-10-29T18:00:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('bf050b4a-afd3-43d4-82f4-5eab0983d490','2026-10-29T04:51:05.215+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('bfad9be3-52f8-4f08-863b-cb8790ab4b75','2026-10-29T04:57:36.745295+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('c2835ddc-d3b6-4b91-9e1b-895028435b3c','2026-10-29T04:57:21.382608+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('c48b7118-a0e5-4b33-98df-79dcf29f15af','2026-10-29T05:21:48.294599+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('c685ebb7-954d-4a38-a26d-9c23c23600a4','2026-10-29T05:33:21.240245+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('cc64ed2b-90d3-4e8e-bb00-006c6d5e964f','2026-11-01T16:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('cc73fe07-8ab2-4282-9ba6-633563de2fec','2026-10-29T09:08:39.362891+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('d110fd05-846e-46c1-adca-a2e515e95144','2026-10-29T05:48:32.703076+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('d4fe7c06-14eb-4ded-a2fd-07a57559f2dd','2026-10-29T05:28:50.000511+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('d58470df-498c-42d0-b5d4-9d7cb5b7828a','2026-11-01T19:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('d5decc98-cd0f-417f-aa28-6df009a74c76','2026-10-31T13:30:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('d8b96746-98a8-444f-a779-76904bbca946','2026-10-29T05:15:02.811015+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('d9393e4e-63da-4a5b-8571-fbbf9654ad1a','2026-10-31T19:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('dbaca4cd-8959-427d-8b91-2d97310e6fd6','2026-10-29T05:51:33.196196+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('dcffef19-4c19-4c5a-b433-d043d3641bc9','2026-10-29T09:05:56.107845+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('de73adfa-bce1-4ac4-8eb6-aa8bc65631af','2026-11-02T02:24:15.015853+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('deaa61a7-0553-4c81-a178-e9ba822a1ba2','2026-10-29T05:49:43.010881+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('debf5e04-6f4d-4858-88a0-84b6fe1ba598','2026-10-29T05:35:11.589398+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('e287e6b9-630d-4f2e-a205-d21841a490d8','2026-10-31T03:00:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('e408f603-5364-44b0-80aa-5dd6a917e47a','2026-11-01T01:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('e507f99a-fc33-45f7-9f7a-60f2793d3876','2026-10-29T05:00:50.025702+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('e9e505d4-13ed-48ee-b7bf-1bdbb28cc8f2','2026-10-29T05:32:18.786019+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('eb82f8d7-53b9-4e2a-9fd5-c2b76ec73d19','2026-10-31T02:15:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('eb916895-36f9-49e9-a364-486ad4555744','2026-10-29T05:06:15.332989+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('eeed2c77-f292-4e09-a0db-dbe544c115f7','2026-11-01T14:39:47.321836+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('ef75f627-1f29-4729-97cd-9988495b49f1','2026-10-29T14:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('f18c199d-69e7-4c51-9f7b-c121cdacbebc','2026-11-01T15:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('f2c1265c-85f4-487c-b3f2-65984da196d7','2026-11-01T19:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('f4c2dd81-58d7-4a11-99de-da923b70d5f7','2026-10-31T02:00:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('f55d1faf-380b-4aeb-a0bf-e0151531dab5','2026-10-29T05:18:08.902128+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('fac51189-3bcc-4bd6-b5b5-34316c034edb','2026-10-29T04:54:39.76087+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('fcb7f99f-b43e-4043-88ad-4ed13c17d40a','2026-10-29T05:22:28.098897+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('fdfcadfd-4044-4696-874d-5ec50cf93a48','2026-10-29T05:50:16.418993+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('fe9145bb-acc1-4a51-97d1-e473d3c39c6e','2026-10-29T16:15:00+00:00','diamonds','47965354-0e56-43ef-931c-ddaab82af765'),
('ff1ec3f2-f2f2-46d6-b30e-e9ef612532b1','2026-10-31T18:45:00+00:00','chips','fade0000-0000-0000-0000-000000000001'),
('ff83fd35-a6d9-4111-a4dd-849f574264bc','2026-10-31T01:15:00+00:00','chips','fade0000-0000-0000-0000-000000000001');
DO $$BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)'::regprocedure)) IS DISTINCT FROM 'ef3c8122a5fccc4f90630c1672080240' THEN
 RAISE EXCEPTION 'owner_deletion_equal_share_authority_changed'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.fn_ca_settle_tournament_abort_equal_share(p_operation_id uuid, p_tournament_id uuid, p_expected_money_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE a smarter_private.tournament_abort_targets;t public.tournaments; financial jsonb; v_receipt jsonb; pre_roster jsonb; pre_seats jsonb; before_history jsonb; after_history jsonb;
 player_ids uuid[];refunded_ids uuid[];zero_ids uuid[];table_ids uuid[];seat_ids uuid[];released_ids uuid[];fee_ids uuid[]:='{}';
 fee record;fee_id uuid; rake_before numeric;rake_after numeric;fees_reversed numeric:=0; settled timestamptz:=clock_timestamp();
 recipient record;bank record;prize_units numeric;bounty_units numeric;total_units numeric;unit_scale numeric;n integer;ordinal integer:=0;share_units numeric;prize_part numeric;bounty_part numeric;key text;shares jsonb:='[]';prior_payouts jsonb;fee_receipt jsonb;
 actor constant uuid:='2d1cd6c3-5700-4af9-a271-d4863fdab20d'; v_close_note constant text:='Explicit operator equal-share close after generation-bound physical and manager drain';
BEGIN
 PERFORM smarter_private.cancellation_lane(p_tournament_id);
 PERFORM smarter_private.assert_tournament_abort_not_recovered(p_operation_id,p_tournament_id);
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'equal_share_platform_frozen' USING ERRCODE='55000';END IF;
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE operation_id=p_operation_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'operator_abort_target_not_owned';END IF;
 IF a.state='settled' THEN
  IF a.receipt->>'mode' IS DISTINCT FROM 'started_operator_equal_share' THEN RAISE EXCEPTION 'operator_abort_disposition_already_committed';END IF;
  RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id);END IF;
 IF EXISTS(SELECT 1 FROM smarter_private.owner_tournament_deletion_intents WHERE tournament_id=p_tournament_id) THEN
  RAISE EXCEPTION 'owner_deletion_supersedes_equal_share' USING ERRCODE='55000';
 END IF;
 PERFORM smarter_private.assert_tournament_abort_quiesced(p_operation_id,p_tournament_id);
 IF p_expected_money_hash IS NULL OR p_expected_money_hash IS DISTINCT FROM a.quiescence->>'money_hash' THEN RAISE EXCEPTION 'operator_abort_review_hash_mismatch' USING ERRCODE='55000';END IF;
 IF t.started_at IS NULL OR upper(t.status) NOT IN('RUNNING','BREAK','LATE_REG') THEN RAISE EXCEPTION 'operator_abort_parent_not_running';END IF;
 PERFORM 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.tables WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id ORDER BY s.id FOR UPDATE OF s;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'),coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') INTO player_ids,pre_roster FROM public.tournament_players p WHERE tournament_id=p_tournament_id;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO table_ids FROM public.tables WHERE tournament_id=p_tournament_id;
 SELECT coalesce(array_agg(s.id ORDER BY s.id),'{}') INTO seat_ids FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'table_id',s.table_id,'user_id',s.user_id,'seat_number',s.seat_number,'stack',s.stack,'status',s.status,'left_at',s.left_at,'occupancy_id',to_jsonb(s)->'occupancy_id') ORDER BY s.id),'[]'::jsonb) INTO pre_seats FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id;
 SELECT coalesce(array_agg(s.id ORDER BY s.id),'{}') INTO released_ids FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id AND s.left_at IS NULL;
 before_history:=jsonb_build_object('awards',a.money_snapshot->'awards','bounty_awards',a.money_snapshot->'bounty_awards','satellite_awards',a.money_snapshot->'satellite_awards',
  'hands',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id)::text,'[]')) FROM public.hand_history h WHERE h.tournament_id=p_tournament_id));
 -- Earned unpaid claims are never silently reclassified as shares.
 IF EXISTS(SELECT 1 FROM public.tournament_obligations WHERE tournament_id=p_tournament_id AND amount_owed>amount_paid) THEN RAISE EXCEPTION 'equal_share_earned_obligation_unpaid';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id AND ((status::text='playing') IS DISTINCT FROM (eliminated_at IS NULL))) THEN RAISE EXCEPTION 'equal_share_remaining_roster_ambiguous';END IF;
 SELECT count(*) INTO n FROM public.tournament_players WHERE tournament_id=p_tournament_id AND status::text='playing' AND eliminated_at IS NULL;
 IF n=0 OR EXISTS(SELECT user_id FROM public.tournament_players WHERE tournament_id=p_tournament_id AND status::text='playing' GROUP BY user_id HAVING count(*)<>1 OR user_id IS NULL) THEN RAISE EXCEPTION 'equal_share_remaining_roster_invalid';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p)-'terminal_closed_at' ORDER BY id),'[]') INTO prior_payouts FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id;
 IF a.asset='diamonds' THEN
  SELECT * INTO bank FROM public.fn_poker_diamond_tournament_escrow(p_tournament_id);
  unit_scale:=1;
  PERFORM public.fn_poker_diamond_tournament_open_shadow(p_tournament_id);
 ELSE
  SELECT * INTO bank FROM public.tournament_escrow WHERE tournament_id=p_tournament_id AND enforced AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'equal_share_escrow_missing';END IF;
  unit_scale:=100;
 END IF;
 IF bank.prize_balance IS NULL OR bank.bounty_balance IS NULL OR bank.fee_balance IS NULL
 OR bank.prize_balance::text IN('NaN','Infinity','-Infinity') OR bank.bounty_balance::text IN('NaN','Infinity','-Infinity')
 OR bank.fee_balance::text IN('NaN','Infinity','-Infinity')
 OR bank.prize_balance<0 OR bank.bounty_balance<0 OR bank.fee_balance<0
 OR bank.fee_balance*unit_scale<>trunc(bank.fee_balance*unit_scale)
 OR bank.prize_balance*unit_scale<>trunc(bank.prize_balance*unit_scale) OR bank.bounty_balance*unit_scale<>trunc(bank.bounty_balance*unit_scale) THEN RAISE EXCEPTION 'equal_share_bank_units_invalid';END IF;
 prize_units:=bank.prize_balance*unit_scale;bounty_units:=bank.bounty_balance*unit_scale;total_units:=prize_units+bounty_units;
 -- Split the COMBINED bank, preventing two independent remainder allocations.
 -- UUID order fixes the indivisible remainder without a fabricated finish rank.
 FOR recipient IN SELECT id,user_id FROM public.tournament_players WHERE tournament_id=p_tournament_id AND status::text='playing' AND eliminated_at IS NULL ORDER BY user_id LOOP
  ordinal:=ordinal+1;share_units:=trunc(total_units/n)+CASE WHEN ordinal<=mod(total_units,n) THEN 1 ELSE 0 END;
  prize_part:=least(prize_units,share_units);bounty_part:=share_units-prize_part;
  key:='tourney:'||p_tournament_id||':operator-equal-share:'||p_operation_id||':'||recipient.user_id;
  IF prize_part>0 THEN
   IF public.fn_credit_and_log(recipient.user_id,prize_part/unit_scale,key||':prize','prize','Equal share of remaining tournament prize',p_tournament_id,'PLAYER',NULL,NULL,NULL,'operator_abort_equal_share') IS NOT TRUE THEN RAISE EXCEPTION 'equal_share_unexpected_prior_prize_key';END IF;
  END IF;
  IF bounty_part>0 THEN
   IF public.fn_credit_and_log(recipient.user_id,bounty_part/unit_scale,key||':bounty','bounty','Equal share of remaining tournament bounty',p_tournament_id) IS NOT TRUE THEN RAISE EXCEPTION 'equal_share_unexpected_prior_bounty_key';END IF;
  END IF;
  shares:=shares||jsonb_build_array(jsonb_build_object('registration_id',recipient.id,'user_id',recipient.user_id,'amount',share_units/unit_scale,'prize',prize_part/unit_scale,'bounty',bounty_part/unit_scale,'key',key));
  prize_units:=prize_units-prize_part;bounty_units:=bounty_units-bounty_part;
 END LOOP;
 IF prize_units<>0 OR bounty_units<>0 THEN RAISE EXCEPTION 'equal_share_banks_not_conserved';END IF;
 financial:=jsonb_build_object('asset',a.asset,'fully_settled',true,'refunds','[]'::jsonb,'total_refunded',0,'shares',shares,'total_distributed',total_units/unit_scale,'prize_before',bank.prize_balance,'bounty_before',bank.bounty_balance,'fee_before',bank.fee_balance,'unit_scale',unit_scale);
 SELECT CASE WHEN a.asset='diamonds' THEN coalesce(t.total_rake,0) ELSE coalesce(sum(rake_amount),0) END INTO rake_before FROM public.rake_records WHERE tournament_id=p_tournament_id AND is_tournament;
 IF rake_before<0 OR rake_before::text IN('NaN','Infinity','-Infinity') OR (a.asset='chips' AND round(coalesce(t.total_rake,0),2) IS DISTINCT FROM rake_before) THEN RAISE EXCEPTION 'equal_share_rake_cache_mismatch';END IF;
 UPDATE public.tournaments SET status='COMPLETING',current_players=0 WHERE id=p_tournament_id;
 fee_receipt:=public.fn_settle_tournament_rake(p_tournament_id,'operator_abort_equal_share');
 IF fee_receipt->>'ok' IS DISTINCT FROM 'true' OR fee_receipt->>'attributed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'equal_share_fee_settlement_incomplete:%',fee_receipt;END IF;
 rake_after:=rake_before;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id=p_tournament_id AND enforced AND closed_at IS NULL AND prize_balance=0 AND bounty_balance=0 AND fee_balance=0) THEN RAISE EXCEPTION 'operator_abort_escrow_not_exact_zero';END IF;
 UPDATE public.tournament_escrow SET closed_at=settled,close_note=v_close_note,updated_at=now() WHERE tournament_id=p_tournament_id;
 -- A transaction-bound administrative retirement is not a poker bust. The
 -- deferred admission constraint demands this transaction's canonical receipt.
 UPDATE smarter_private.tournament_abort_targets SET receipt=jsonb_build_object('mode','equal_share_retirement_admission','transaction_id',txid_current()) WHERE tournament_id=p_tournament_id AND operation_id=p_operation_id AND state='quiesced';
 -- Keep original eliminated_at, elimination sequence, finish position and prize.
 -- Active remaining virtual stacks are administrative retirements, not results.
 UPDATE public.tournament_players SET status='eliminated',chips=0,current_bounty=0 WHERE tournament_id=p_tournament_id AND status::text<>'eliminated';
 -- equal_share_preactivation_mystery_cache: these busts earned no bounty.
 -- The original roster above retains every head and elimination witness.
 IF t.is_mystery_bounty IS TRUE AND coalesce(t.is_pko,false)=false
 AND t.mystery_bounty_stage='pending' AND t.mystery_bounty_regular_pool_percent=0 THEN
  UPDATE public.tournament_players SET current_bounty=0
   WHERE tournament_id=p_tournament_id AND status::text='eliminated'
   AND chips=0 AND current_bounty>0
   AND current_bounty::text NOT IN('NaN','Infinity','-Infinity');
 END IF;

 IF EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id AND (status::text<>'eliminated' OR chips IS DISTINCT FROM 0 OR current_bounty IS DISTINCT FROM 0)) THEN RAISE EXCEPTION 'equal_share_roster_retirement_incomplete';END IF;
 UPDATE public.table_seats s SET left_at=coalesce(s.left_at,settled),status='left',stack=0,leave_pending=false,is_sitting_out=false,is_away=false,sit_out_at=NULL,scheduled_leave_hands=NULL
  FROM public.tables tb WHERE tb.id=s.table_id AND tb.tournament_id=p_tournament_id;
 UPDATE public.tournaments SET status='CANCELLED',ended_at=settled,updated_at=now(),prize_pool=0,bounty_pool=0,total_rake=rake_after,current_players=0,on_break=false,break_started_at=NULL,break_ends_at=NULL WHERE id=p_tournament_id;
 UPDATE public.tables SET status='closed',lifecycle='closed',current_players=0,terminal_closed_at=settled,updated_at=now() WHERE tournament_id=p_tournament_id;
 after_history:=jsonb_build_object('awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'awards','bounty_awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'bounty_awards','satellite_awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'satellite_awards',
  'hands',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id)::text,'[]')) FROM public.hand_history h WHERE h.tournament_id=p_tournament_id));
 IF EXISTS(SELECT value FROM jsonb_array_elements(prior_payouts) EXCEPT SELECT to_jsonb(p)-'terminal_closed_at' FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id) THEN RAISE EXCEPTION 'equal_share_prior_payout_changed';END IF;
 IF before_history IS DISTINCT FROM after_history THEN RAISE EXCEPTION 'operator_abort_earned_results_or_original_hands_changed:%:%:%:%',before_history,after_history,financial->'prior_awards_preserved',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_obligations o WHERE tournament_id=p_tournament_id AND kind<>'refund');END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO refunded_ids FROM public.tournament_players p WHERE p.tournament_id=p_tournament_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(financial->'refunds') r WHERE (r->>'user_id')::uuid=p.user_id);
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO zero_ids FROM unnest(player_ids) id WHERE NOT id=ANY(refunded_ids);
 v_receipt:=jsonb_build_object('ok',true,'success',true,'fully_settled',true,'receipt_version',4,'mode','started_operator_equal_share','operation_id',p_operation_id,'tournament_id',p_tournament_id,'actor_id',actor,'status','CANCELLED',
 'source_player_count',cardinality(player_ids),'refunded_count',cardinality(refunded_ids),'refund_line_count',jsonb_array_length(financial->'refunds'),'ticket_return_count',0,'ticket_returns','[]'::jsonb,'total_ticket_returned',0,
 'total_refunded',(financial->>'total_refunded')::numeric,'fees_reversed',fees_reversed,'closed_table_count',cardinality(table_ids),'source_seat_count',cardinality(seat_ids),'released_seat_count',cardinality(released_ids),'refunds',financial->'refunds','settled_at',settled,
 'original_started_at',t.started_at,'financial',financial,'fee_receipt',fee_receipt,'pre_abort_roster',pre_roster,'pre_abort_seats',pre_seats,'preserved_history',before_history,'quiescence',a.quiescence,'payout_history',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'[]')) FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id),'fee_settlement',(SELECT to_jsonb(r) FROM public.tournament_rake_settlements r WHERE tournament_id=p_tournament_id),'terminal_snapshot',smarter_private.tournament_abort_terminal_snapshot(p_tournament_id));
 v_receipt:=v_receipt||jsonb_build_object('allocation_hash',md5((financial->'shares')::text));
 UPDATE smarter_private.tournament_abort_targets SET state='settled',receipt=v_receipt,settled_at=settled WHERE tournament_id=p_tournament_id AND operation_id=p_operation_id;
 INSERT INTO public.tournament_cancellation_receipts(tournament_id,actor_id,receipt_version,source_player_count,source_player_ids,refunded_count,refunded_registration_ids,refund_line_count,ticket_return_count,ticket_return_ids,total_ticket_returned,zero_refund_count,zero_refund_registration_ids,total_refunded,fees_reversed,total_rake_before,total_rake_after,closed_table_count,closed_table_ids,source_seat_count,source_seat_ids,released_seat_count,released_seat_ids,fee_reversal_ids,escrow_closed_at,escrow_close_note,spin_unwind_tournament_id,receipt,settled_at)
 VALUES(p_tournament_id,actor,4,cardinality(player_ids),player_ids,cardinality(refunded_ids),refunded_ids,jsonb_array_length(financial->'refunds'),0,'{}',0,cardinality(zero_ids),zero_ids,(financial->>'total_refunded')::numeric,fees_reversed,rake_before,rake_after,cardinality(table_ids),table_ids,cardinality(seat_ids),seat_ids,cardinality(released_ids),released_ids,fee_ids,settled,v_close_note,NULL,v_receipt,settled);

 RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id);
END $function$
;
COMMIT;
