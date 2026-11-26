import './CashierBalanceLedger.css';

interface LedgerBalance {
  key: string;
  label: string;
  amount: string;
  onOpen?: () => void;
}

const primaryClubWallets = ['player_wallet', 'club_bank', 'agent_wallet', 'promo_wallet'];

function ledgerOrder(key: string) {
  const index = primaryClubWallets.indexOf(key);
  return index < 0 ? primaryClubWallets.length : index;
}

/** Rows arrive already authorized and formatted by DynamicWallet. */
export default function CashierBalanceLedger({ balances }: { balances: LedgerBalance[] }) {
  return (
    <div className="cashier-balance-ledger">
      {[...balances]
        .sort((a, b) => ledgerOrder(a.key) - ledgerOrder(b.key))
        .map((row) => {
          const unit = row.key === 'diamonds' ? 'Diamonds' : 'Chips';
          const contents = (
            <>
              <span className="dw__row-label">{row.label}</span>
              <span className="dw__row-value">{row.amount}</span>
              <span className="cashier-balance-unit">{unit}</span>
            </>
          );
          return row.onOpen ? (
            <button
              type="button"
              key={row.key}
              data-wallet-key={row.key}
              aria-label={`Open ${row.label}`}
              aria-description={row.amount === '-' ? 'Unavailable' : `${row.amount} ${unit}`}
              onClick={row.onOpen}
            >
              {contents}
            </button>
          ) : (
            <div key={row.key} data-wallet-key={row.key}>
              {contents}
            </div>
          );
        })}
    </div>
  );
}
