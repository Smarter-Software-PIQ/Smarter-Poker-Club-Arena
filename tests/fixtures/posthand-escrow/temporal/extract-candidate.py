from pathlib import Path
import sys
migration, output = map(Path, sys.argv[1:])
s = migration.read_text()
a = s.index('CREATE FUNCTION smarter_private.original_cash_hand_predecessor(')
b = s.index('CREATE OR REPLACE FUNCTION public.fn_union_pnl_prove_posthand_escrow(', a)
c = s.index('CREATE OR REPLACE FUNCTION public.fn_ca_process_hand_post_commit_obligations(', b)
d = s.index('DO $postimage$', c)
for name, body in [('helper', s[a:b]), ('prover', s[b:c]), ('completion', s[c:d])]:
    (output / (name + '.sql')).write_text(body)
