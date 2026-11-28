/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AGENT INVOICES PANEL — view + pay weekly credit invoices
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Lists the agent's credit_invoices (CreditService.getAgentInvoices) and lets them
 *  pay an outstanding balance from their player wallet in that club (CreditService.processPayment).
 *  Invoices are generated weekly by fn_generate_all_credit_invoices on the server weekly close. Mobile-first, no emoji.
 *
 *  #SmarterDesign (batch A2, 2026-11-28): the Agent Portal is this panel's only
 *  host, and it is an arena workspace page, so the panel is one thin chrome
 *  case: its title over the hairline, the weekly line and status where the
 *  console pill stood, every invoice a chrome ledger row, Pay Now and Retry lit
 *  chrome keys. Words, figures, handlers and guards are unchanged.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  CreditService,
  OWED_INVOICE_STATUSES,
  type CreditInvoice,
} from '../../services/CreditService';
import { useToast } from '../common/Toast';
import { masterBus } from '../../core/MasterBus';
import { reportError } from '../../utils/errorReporter';
import { uuid } from '../../utils/uuid';
import { compactChips } from '../../utils/format';
import { titleCase } from '../../utils/titleCase';
import '../ops/ArenaOps.css';
import './AgentInvoicesArena.css';

interface Props {
  /** agents.id PK (NOT auth.uid) */
  agentId: string | null;
}

/** The workspace ink a status reads in (AgentInvoicesArena.css). */
type Ink = 'gold' | 'red' | 'green' | 'muted' | 'blue';

const STATUS_INKS: Record<string, Ink> = {
  pending: 'gold',
  partial: 'gold',
  overdue: 'red',
  disputed: 'red',
  paid: 'green',
  // Cancelled, not owed. Grey so it reads as settled history rather than as an
  // unknown state, which is what the fallback colour said about 224 of them.
  void: 'muted',
};

// Which statuses still owe money is defined once, in CreditService, because
// this panel and CreditService.checkSuspension disagreeing about it is how a
// cancelled invoice ends up suspending an agent.

function fmtDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return 'Date Unavailable';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Date Unavailable';
  }
}

function invoiceStatus(status: CreditInvoice['status']): string {
  return titleCase(status.replace(/_/g, ' '));
}

export default function AgentInvoicesPanel({ agentId }: Props) {
  const toast = useToast();
  const [state, setState] = useState<{
    agentId: string | null;
    rows: CreditInvoice[];
    loading: boolean;
    unavailable: boolean;
  }>({ agentId, rows: [], loading: true, unavailable: false });
  const [payingId, setPayingId] = useState<string | null>(null);
  const scope = useRef(0);
  const request = useRef(0);
  const payment = useRef<string | null>(null);
  const paymentOperations = useRef(new Map<string, { amount: number; operationId: string }>());
  const invalidateScope = useCallback(() => {
    scope.current++;
    request.current++;
  }, []);

  const load = useCallback(async () => {
    const generation = scope.current;
    const read = ++request.current;
    const current = () => generation === scope.current && read === request.current;
    setState({ agentId, rows: [], loading: !!agentId, unavailable: false });
    if (!agentId) return;
    try {
      const rows = await CreditService.getAgentInvoices(agentId);
      if (!Array.isArray(rows)) throw new Error('Invoice list is unavailable');
      if (current()) setState({ agentId, rows, loading: false, unavailable: false });
    } catch (e) {
      if (!current()) return;
      reportError(e, 'AgentInvoicesPanel.load', { agentId });
      setState({ agentId, rows: [], loading: false, unavailable: true });
    }
  }, [agentId]);

  useLayoutEffect(() => {
    invalidateScope();
    payment.current = null;
    paymentOperations.current.clear();
    setPayingId(null);
    void load();
    return invalidateScope;
  }, [invalidateScope, load]);

  const visible = state.agentId === agentId;
  const invoices = visible && !state.loading && !state.unavailable ? state.rows : [];
  const loading = !visible || state.loading;
  const unavailable = visible && state.unavailable;
  const actionScope = scope.current;
  const actionRequest = request.current;
  const handlePay = async (inv: CreditInvoice) => {
    const current = () => actionScope === scope.current && actionRequest === request.current;
    if (
      !current() ||
      payment.current ||
      !invoices.includes(inv) ||
      !OWED_INVOICE_STATUSES.has(inv.status) ||
      inv.status === 'disputed' ||
      inv.amountRemaining <= 0
    )
      return;
    payment.current = inv.id;
    setPayingId(inv.id);
    try {
      let attempt = paymentOperations.current.get(inv.id);
      if (!attempt || attempt.amount !== inv.amountRemaining) {
        attempt = { amount: inv.amountRemaining, operationId: uuid() };
        paymentOperations.current.set(inv.id, attempt);
      }
      const receipt = await CreditService.processPayment(inv.id, inv.amountRemaining, 'wallet', {
        operationId: attempt.operationId,
      });
      // A sent payment may commit; only consume its result in the original selection.
      if (!current()) return;
      paymentOperations.current.delete(inv.id);
      toast.success(`Paid ${compactChips(receipt.amount)} Chips Toward Invoice`);
      masterBus.emit('BALANCE_UPDATED', { source: 'credit_invoice_payment' });
      await load();
    } catch (e) {
      if (!current()) return;
      const msg = e instanceof Error ? e.message : 'Payment failed';
      reportError(e, 'AgentInvoicesPanel.handlePay', { invoiceId: inv.id });
      toast.error(msg);
    } finally {
      if (actionScope === scope.current) {
        payment.current = null;
        setPayingId(null);
      }
    }
  };

  const outstanding = invoices.filter(
    (invoice) => OWED_INVOICE_STATUSES.has(invoice.status) && invoice.amountRemaining > 0
  );
  const pill = unavailable
    ? 'Unavailable'
    : loading
      ? 'Checking'
      : outstanding.length > 0
        ? `${outstanding.length} Due`
        : 'Clear';
  const pillInk: Ink = unavailable
    ? 'red'
    : loading
      ? 'blue'
      : outstanding.length > 0
        ? 'gold'
        : 'green';

  return (
    <section
      className="arena-case arena-ops-case agent-invoices-arena"
      aria-labelledby="agent-credit-invoices-title"
      aria-busy={loading || Boolean(payingId)}
    >
      <h2 id="agent-credit-invoices-title" className="arena-section-title">
        Credit Invoices
      </h2>
      <p className="agent-invoices-arena__status">
        Weekly Credit
        <span className={`agent-invoices-arena__ink--${pillInk}`}>{pill}</span>
      </p>
      {loading ? (
        <div className="agent-invoices-arena__state" role="status" aria-live="polite">
          <p>Loading Invoices...</p>
        </div>
      ) : unavailable ? (
        <div className="agent-invoices-arena__state" role="alert">
          <p className="agent-invoices-arena__ink--red">
            Invoices Unavailable. Try Again To Check Your Balance.
          </p>
          <div className="arena-switch arena-ops-keys arena-ops-primary">
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          </div>
        </div>
      ) : invoices.length === 0 ? (
        <p className="agent-invoices-arena__empty">
          No Invoices. Weekly Top-Up Invoices Use Your Credit Line Minus Your Agent Wallet Before
          Rakeback.
        </p>
      ) : (
        <ol className="agent-invoices-arena__list" aria-label="Credit Invoice History">
          {invoices.map((inv) => {
            const ink = STATUS_INKS[inv.status] ?? 'muted';
            // A number alone was not enough. Ask the STATUS as well, so a
            // cancelled or settled invoice can never offer a button the server
            // is going to refuse.
            const canPay = OWED_INVOICE_STATUSES.has(inv.status) && inv.amountRemaining > 0;
            return (
              <li className="agent-invoices-arena__row arena-ledger-row" key={inv.id}>
                <div className="agent-invoices-arena__identity">
                  <strong>Week Of {fmtDate(inv.periodStart)}</strong>
                  <span className="agent-invoices-arena__meta">
                    <span>Due {fmtDate(inv.dueDate)}</span>
                    <span className={`agent-invoices-arena__ink--${ink}`}>
                      {invoiceStatus(inv.status)}
                    </span>
                  </span>
                </div>
                <div className="agent-invoices-arena__amount">
                  <strong>
                    {compactChips(inv.amountRemaining)} <span>Due</span>
                  </strong>
                  {inv.amountPaid > 0 && (
                    <small>
                      {compactChips(inv.amountPaid)} Of {compactChips(inv.debtOwed)} Paid
                    </small>
                  )}
                </div>
                {canPay && (
                  <div className="arena-switch arena-ops-keys arena-ops-primary agent-invoices-arena__pay">
                    <button
                      type="button"
                      title="Pay From Your Player Wallet In This Club"
                      onClick={() => handlePay(inv)}
                      disabled={payingId === inv.id}
                    >
                      {payingId === inv.id ? 'Paying...' : 'Pay Now'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
