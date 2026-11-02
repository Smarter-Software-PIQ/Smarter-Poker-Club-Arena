# Overdue Diamond tournament cancellations, November 2, 2026

Fifty overdue, never-started Diamond MTT and satellite events were cancelled through the installed `public.atomic_cancel_tournament` authority. Twenty registrations were released and 34,600 Diamonds returned. Each event is now CANCELLED with zero current players and a validated fully settled cancellation receipt. Financial records remain intact.

## Funded events

Night Owl Special (NLH), `849e12b9-fa92-4bb5-8a25-c4a962519e9f`, committed at 04:09:48.331982 UTC. ReidSr, EddieJr and rextran each received their full 200-Diamond entry back: 120 prize contribution, 60 bounty contribution and 20 fee. Total: 600 Diamonds. The event had never started and had no table or hand.

Sunday 200 Deep Stack, `4b5263cc-30f7-40e8-9640-019daf67cb26`, committed at 04:10:29.999773 UTC. LOUAce, rakesnap1, xviking, TURN, TheViking, Setmine22, ninja_95, Bea93, tylerchen, Trey, sa_jules, wizardd, OldPriya, OldRavi, CBusOwen, YoungNadia and UncleWill each received their full 2,000-Diamond entry back: 1,800 prize contribution and 200 fee. Total: 34,000 Diamonds. This event also had never started and had no table or hand.

Independent readbacks at 04:09:55.887126 and 04:10:38.084377 UTC validated canonical receipts, no remaining active participants or unreleased custody, and zero prize, bounty and fee caches. No unresolved financial alert matched either event at verification.

## Forty-eight empty events

These scheduled MTT/satellite events were more than two hours overdue and had no registrations, tables, hands or player funds. Canonical cancellation returned zero funds and zero released seats. All 48 receipts were independently validated at 04:14:04.517767 UTC. Empty SNG/Spin events waiting for a field and future scheduled events were excluded.

- `000c5870-82d6-4ad4-b043-84f5b2d26e45`
- `148f059f-d9a8-4131-9202-22a29fc1d174`
- `153bd420-090f-4f77-a7b6-8a364f4007ee`
- `189fe345-3680-46d2-a624-5b7cf5ad0fa4`
- `1bf9011d-8f8f-460f-bae6-a3921d3f75f4`
- `1f5053af-0621-40ef-95c3-75306cef7128`
- `22c53b10-36c1-4b8d-a945-0fecfb2d4603`
- `27868adf-c8c5-48ea-bf6f-c4559a568572`
- `2e0a287d-6121-4e6b-8ec5-56d8f7f6780f`
- `3752eab9-ab16-4861-8b6e-21731ef26c71`
- `39fa4883-b066-4ea3-9b70-f01ea0ced902`
- `3e6254aa-2b29-4d8d-9427-41e462254752`
- `3f31aedb-7d72-45ad-90b5-10d3b6ee77ef`
- `3fbe9677-94fa-4f33-82f5-8128d3014c10`
- `469c34ca-ba77-42b8-8069-750ad44f1587`
- `4946aed3-5667-436d-8b95-6a9ed28e7dee`
- `5087ada1-7403-4992-8270-39cd0bd74762`
- `517ab1cd-2bed-4b33-ab57-973502751fd7`
- `523d65b4-6aaf-4cca-9342-1aeb5aeb1a01`
- `54526509-164e-4394-8ce1-8cf3e57217be`
- `5c71390e-d562-4f09-b03b-d5efeef382e8`
- `5fc028d6-e99b-44e8-a045-8ac09f553f6a`
- `69637969-b9e1-42aa-adf8-0348addc03d0`
- `6d3d399d-0f14-42e2-aac4-895c9b7d3e1d`
- `825486b2-00fe-4704-b850-5116dd493ef7`
- `8428a2f4-a853-44b5-b76b-eb82eb5548f8`
- `8524f43c-b4b5-4366-81c2-53d525ed37fb`
- `9204d457-1a43-4be8-a6b4-0db26c129994`
- `a0097029-930d-4051-9e3a-62dd84df913e`
- `a06825f2-f564-46f2-875e-d0786de11203`
- `a2c15702-44fb-48ab-a676-7b588b5166da`
- `a88d1a87-d911-4991-9c10-463f5efa63a7`
- `a8a49a26-84c4-433e-b58e-a906bbd084c2`
- `aa942302-b1e8-46cf-aae1-1b0497bcd0fe`
- `b633f9b4-2974-4c85-9514-7f9592db9ab2`
- `c014ef5d-875b-4810-9b0e-c91accfaa257`
- `c802b32c-3a8c-41f3-98ca-aa5149f7e5af`
- `ce41b56c-7c82-433d-a1ee-b7605a311b03`
- `d0d93b7c-ae44-49eb-9335-d3d38dec7f9d`
- `d5b258fb-1a2c-4f73-8392-d063be68fe6e`
- `d921ed3e-8f1c-44a6-9598-0afc4e7c0af4`
- `dfaf3d17-07e9-464f-80ca-18a76ac111b0`
- `e41b4dcf-df95-4074-bed8-55f2a3f70b64`
- `ed2a2850-960a-430b-9fab-3393ea85fc1e`
- `ed7e8a17-59dc-4906-83ea-b5c4ba1b95ec`
- `f6fb5e65-aa66-40c8-9f13-2735f8654f4b`
- `f754c69d-d55d-4fb7-b9e6-63667f67cace`
- `fb5ace75-6da1-4f27-b180-ea17e9c67ff5`

## Transaction safeguards and evidence

Each financial operation was first executed in one self-aborting transaction. Commit assertions matched the preview's recipients, custody, registration and request identities and each refund component. Existing service-role execution, canonical idempotency, custody release, guarantee release and immutable journals were preserved. Busy lock admission refused before writes; no blocking retry loop, new-start hold, raw wallet edit or seat deletion was used.

Evidence is retained under `/Volumes/SmarterArchives/agent-evidence/frozen-events-01a19a5c/`: `night-owl-qualified-rollback-preview.json`, `night-owl-committed.json`, `night-owl-durable-readback.json`, `deep-stack-preview-attempt.json`, `deep-stack-committed.json`, `deep-stack-durable-readback.json`, `empty-0-preview.json`, `empty-0-committed.json`, `empty-0-readback.json`, `empty-remaining-preview-2.json`, `empty-remaining-commit-2.json` and `empty48-durable-readback.json`.

## Remaining incident

This record establishes these 50 closures only. Probyourmom's started tournament `2781bcd7-cc8a-4713-ab3e-0d0a81fdf110` was not closed by these operations. The 03:59:53 UTC census identified 139 started-event candidates with 1,676 retained seats; age is triage evidence, not permission to discard a live hand. Started-event settlement remains dependent on physical engine quiescence and the three prerequisite migrations. The active recovery retains its original operation identities. No root-cause resolution, browser visibility proof or platform-wide zero-stall result is claimed here.
