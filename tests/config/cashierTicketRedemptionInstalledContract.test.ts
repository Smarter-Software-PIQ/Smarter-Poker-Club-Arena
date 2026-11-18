import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const hash = (source: string) => createHash('md5').update(source).digest('hex');
const original = read(
  'supabase/migrations/20261015132042_cashier_sends_a_ticket_into_one_tournament.sql'
);
const patch = read(
  'supabase/migrations/20261112204754_promo_tickets_batch_allowance_receipts_and_redeem_names_its_.sql'
);
const contract = read('scripts/verification-harness/cashier-release-contract.sql');

it('derives the sole accepted redemption body from the protected promo receipt patch', () => {
  const start = original.indexOf('CREATE OR REPLACE FUNCTION public.fn_redeem_tournament_ticket(');
  expect(start).toBeGreaterThan(0);
  const end = original.indexOf('$function$;', start);
  const before = original.slice(start, end) + '$function$\n';
  expect(hash(before)).toBe('0bb17681b38164a7a2746e17d07597b3');
  const literals = patch.match(/n := replace\(d, '((?:''|[^'])*)',\s*'((?:''|[^'])*)'\);/);
  expect(literals).not.toBeNull();
  const oldText = literals![1].replaceAll("''", "'");
  const newText = literals![2].replaceAll("''", "'");
  expect(before.split(oldText)).toHaveLength(2);
  const after = before.replace(oldText, newText);
  expect(after.replace(newText, oldText)).toBe(before);
  expect(hash(after)).toBe('49cb942d53af3521ff14a6502520924c');
  const entry = contract.match(
    /'signature', 'public\.fn_redeem_tournament_ticket\(uuid\)',([\s\S]*?)\n {4}\)/
  )![1];
  expect(
    [...entry.matchAll(/'(?:replacement_)?hash', '([a-f0-9]{32})'/g)].map((m) => m[1])
  ).toEqual([hash(after)]);
  expect(hash(after.replace('IF v_me IS NULL THEN', 'IF FALSE THEN'))).not.toBe(hash(after));
});

it('binds the installed migration bytes and retains function authority checks', () => {
  expect(hash(patch)).toBe('8d1ecb9da84062ffccc1dcd97d7c761d');
  expect(contract).toContain("version = '20261112204754'");
  expect(contract).toContain(
    "name = 'promo_tickets_batch_allowance_receipts_and_redeem_names_its_'"
  );
  expect(contract).toContain("md5(statements[1]) = '8d1ecb9da84062ffccc1dcd97d7c761d'");
  expect(contract).toContain("RAISE EXCEPTION 'cashier function ACL drift:");
  expect(contract).toContain("RAISE EXCEPTION 'cashier function is not SECURITY DEFINER:");
});

it('pins the cancellation successor and its exact installed migration', () => {
  const cancel = read(
    'supabase/migrations/20261112235138_a_replayed_promo_ticket_cancel_names_its_promo_wallet.sql'
  );
  expect(hash(cancel)).toBe('18080405ffb48a82e323e59d9ffe8d3d');
  const postimage = cancel.match(/-- @live-proof:.*= '([a-f0-9]{32})'/)![1];
  const entry = contract.match(
    /'signature', 'public\.fn_cancel_tournament_ticket\(uuid\)',([\s\S]*?)\n {4}\)/
  )![1];
  expect(
    [...entry.matchAll(/'(?:replacement_)?hash', '([a-f0-9]{32})'/g)].map((m) => m[1])
  ).toEqual([postimage]);
  expect(contract).toContain("version = '20261112235138'");
  expect(contract).toContain("name = 'a_replayed_promo_ticket_cancel_names_its_promo_wallet'");
  expect(contract).toContain("md5(statements[1]) = '18080405ffb48a82e323e59d9ffe8d3d'");
});
