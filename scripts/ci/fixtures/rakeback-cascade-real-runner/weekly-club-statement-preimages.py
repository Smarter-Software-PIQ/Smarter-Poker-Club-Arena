# Original union cash transfer receipts, original agreement history and the shared
# Messenger issuer run on an already released disposable paid week.
migrations=R/'supabase/migrations'
def original_definition(prefix, start, end):
    body=next(migrations.glob(prefix+'_*')).read_text()
    return body[body.index(start):body.index(end,body.index(start))]

q("SET check_function_bodies=off;"+original_definition('20261112152702',
  'CREATE OR REPLACE FUNCTION public.fn_union_issue_weekly_invoices(', 'CREATE OR REPLACE FUNCTION public.ca_union_statement_board('))
q("SET check_function_bodies=off;"+original_definition('20261110005719',
  'CREATE OR REPLACE FUNCTION public.fn_ca_governance_eco_proven(', 'REVOKE ALL ON FUNCTION public.fn_ca_governance_eco_proven'))
q("SET check_function_bodies=off;"+original_definition('20261115205037',
  'CREATE FUNCTION smarter_private.weekly_payout_owner_milestones(', 'REVOKE ALL ON FUNCTION smarter_private.weekly_payout_owner_milestones').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1))
q('SET check_function_bodies=off;'+original_definition('20261115011424','CREATE OR REPLACE FUNCTION smarter_private.union_statement_figure(',
  'REVOKE ALL ON FUNCTION smarter_private.union_statement_figure('))
q("CREATE TABLE IF NOT EXISTS public.messenger_hidden_messages(user_id uuid,message_id uuid,PRIMARY KEY(user_id,message_id)); ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;")
inbox=original_definition('20261025201533','CREATE OR REPLACE FUNCTION public.fn_get_user_conversations(', 'DO $postflight$')
q("SET check_function_bodies=off;"+inbox.replace("AND si.invoice_type IS DISTINCT FROM 'cashier_cashout'",
    "AND COALESCE(si.invoice_type, '') NOT IN ('cashier_cashout', 'union_weekly_squareup', 'union_weekly_credit_note')"))
# This fixture freezes November 15 books. Apply the November 16 membership and
# eligible-scope definitions together, including their reviewed digest check.
q(original_definition('20261116143103','CREATE FUNCTION smarter_private.standalone_week_belongs_to_union','-- The original owner-stamping triggers'))
