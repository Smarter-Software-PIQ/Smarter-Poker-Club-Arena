import { useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import '../lobby/ArenaWorkspace.css';
import '../ops/ArenaOps.css';
import './DiamondOpsKit.css';

/**
 * THE DIAMOND OPERATIONS PAGES IN #SMARTERDESIGN (Dan 2026-11-27). The Diamond
 * Wheel, Diamond Games and Diamond Costs consoles wear the arena workspace
 * language Player Management and the Cashier already wear: thin chrome cases,
 * chrome readout tiles, chrome keys that light blue when chosen, chrome ledger
 * rows and dark wells for the fields. The painted console plates are the old
 * style and are never used here. These pieces keep the props the plates took,
 * so every page keeps its behaviour and only its dress changes.
 */

/** How a figure reads: the smarter.poker chrome blues, gold and red only. */
export type OpsInk = 'silver' | 'white' | 'blue' | 'green' | 'red' | 'gold' | 'muted';

export type OpsKey = {
  label: string;
  ink?: OpsInk;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

const TONE: Partial<Record<OpsInk, string>> = {
  blue: 'live',
  green: 'live',
  gold: 'attention',
  red: 'danger',
  muted: 'muted',
};

function Key({ k, primary }: { k: OpsKey; primary: boolean }) {
  const { label, ink, className, ...rest } = k;
  const cls = [primary ? 'dops-key--primary' : '', className ?? ''].join(' ').trim();
  return (
    <button type="button" className={cls || undefined} data-ink={ink} {...rest}>
      {label}
    </button>
  );
}

/**
 * One chrome case: an eyebrow, the title and a state word on top, the body,
 * and the case's own keys underneath. It is named by its eyebrow and title,
 * and carries its state word as data-pill.
 */
export function OpsCase({
  eyebrow,
  title,
  titleId,
  pill,
  pillInk = 'blue',
  plates,
  foot,
  children,
  className,
  'aria-labelledby': _named,
  ...rest
}: {
  eyebrow?: string;
  title: string;
  titleId?: string;
  pill?: string;
  pillInk?: OpsInk;
  plates?: { secondary?: OpsKey; middle?: OpsKey; primary?: OpsKey };
  /** 'foot' closes the case without its keys, as the plates' foot did. */
  foot?: 'plates' | 'foot';
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  /* A case is always named by its eyebrow and its title together, so a
     caller's own aria-labelledby (the title alone) is set aside. */
  void _named;
  const auto = useId();
  const headId = titleId ?? `${auto}title`;
  const eyebrowId = `${auto}eyebrow`;
  const keys = foot === 'foot' ? [] : [plates?.secondary, plates?.middle, plates?.primary];
  return (
    <section
      className={className ? `arena-case arena-ops-case ${className}` : 'arena-case arena-ops-case'}
      aria-labelledby={eyebrow ? `${eyebrowId} ${headId}` : headId}
      data-pill={pill || undefined}
      {...rest}
    >
      <div className="dops-case__head">
        <div className="dops-case__titles">
          {eyebrow ? (
            <p id={eyebrowId} className="arena-ops-eyebrow">
              {eyebrow}
            </p>
          ) : null}
          <h2 id={headId} className="dops-case__title">
            {title}
          </h2>
        </div>
        {pill ? (
          <span className="dops-case__pill" data-ink={pillInk}>
            {pill}
          </span>
        ) : null}
      </div>
      {children}
      {keys.some(Boolean) ? (
        <div className="arena-switch arena-ops-keys dops-case__keys">
          {keys.map((k, i) =>
            k ? <Key key={i} k={k} primary={i === 2 && keys.filter(Boolean).length > 1} /> : null
          )}
        </div>
      ) : null}
    </section>
  );
}

/** The stack of rows inside a case. */
export function OpsRows({ children }: { children?: ReactNode }) {
  return <div className="dops-rows">{children}</div>;
}

/** One chrome ledger row: the label, its figure on the right, a note under both. */
export function OpsRow({
  label,
  value,
  ink = 'silver',
  meta,
  wrap = false,
}: {
  label: ReactNode;
  value: ReactNode;
  ink?: OpsInk;
  meta?: ReactNode;
  /** Let a long label or value wrap inside the row (375px). */
  wrap?: boolean;
}) {
  return (
    <div className="arena-ledger-row dops-row" data-ink={ink} data-wrap={wrap || undefined}>
      <span className="dops-row__label">{label}</span>
      <span className="dops-row__value">{value}</span>
      {meta ? <span className="dops-row__meta">{meta}</span> : null}
    </div>
  );
}

/** A ledger row that is a control: it lights blue while it is pressed. */
export function OpsChoice({
  label,
  meta,
  value,
  ink = 'silver',
  onClick,
  disabled,
  pressed,
  ariaLabel,
}: {
  label: string;
  meta: string;
  value: string;
  ink?: OpsInk;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  ariaLabel?: string;
}) {
  const metaId = useId();
  return (
    <button
      type="button"
      className="arena-ledger-row dops-row dops-row--choice"
      data-ink={ink}
      data-wrap
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={ariaLabel ?? `${label}: ${value}`}
      aria-describedby={metaId}
    >
      <span className="dops-row__label">{label}</span>
      <span className="dops-row__value">{value}</span>
      <span id={metaId} className="dops-row__meta">
        {meta}
      </span>
    </button>
  );
}

/** A switch row: the row is the control and its state is its printed value. */
export function OpsToggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="arena-ledger-row dops-row dops-row--choice"
      data-ink={on ? 'green' : 'muted'}
      data-wrap
      onClick={onToggle}
      aria-pressed={on}
    >
      <span className="dops-row__label">{label}</span>
      <span className="dops-row__value">{on ? 'On' : 'Off'}</span>
      <span className="dops-row__meta">{hint}</span>
    </button>
  );
}

/** A labelled dark well for a number or a line of text. */
export function OpsField({
  label,
  value,
  onChange,
  hint,
  mode = 'numeric',
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  mode?: 'decimal' | 'numeric' | 'text';
  disabled?: boolean;
}) {
  const hintId = useId();
  return (
    <label className="dops-field">
      <span className="dops-field__label">{label}</span>
      <input
        className="arena-ops-well"
        inputMode={mode}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <span id={hintId} className="dops-field__hint">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/** The fields of a case, two across on a desktop and one on a phone. */
export function OpsFields({ children }: { children?: ReactNode }) {
  return <div className="dops-fields">{children}</div>;
}

/** A row of chrome readout tiles: four across on a desktop, two on a phone. */
export function OpsReadings({ label, children }: { label?: string; children?: ReactNode }) {
  return (
    <dl className="arena-ops-readings dops-readings" aria-label={label}>
      {children}
    </dl>
  );
}

/** One chrome readout tile: the label, the figure and a line under it. */
export function OpsReading({
  label,
  value,
  ink = 'silver',
  meta,
}: {
  label: string;
  value: string;
  ink?: OpsInk;
  meta?: string;
}) {
  return (
    <div className="arena-meter" data-tone={TONE[ink]}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {meta ? <dd className="arena-ops-reading-sub">{meta}</dd> : null}
    </div>
  );
}

/** A dark chrome table: a header row, then one ledger line per record. */
export function OpsTable({
  head,
  label,
  children,
}: {
  head: string[];
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div className="dops-grid" role="table" aria-label={label}>
      <div className="dops-grid__row dops-grid__row--head" role="row">
        {head.map((h) => (
          <span key={h} className="dops-grid__cell" role="columnheader">
            {h}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

export function OpsTableRow({ children }: { children?: ReactNode }) {
  return (
    <div className="dops-grid__row" role="row">
      {children}
    </div>
  );
}

export function OpsCell({
  ink,
  meta,
  dim,
  children,
}: {
  ink?: OpsInk;
  meta?: ReactNode;
  dim?: boolean;
  children?: ReactNode;
}) {
  return (
    <span className="dops-grid__cell" role="cell" data-ink={ink} data-dim={dim || undefined}>
      {children}
      {meta ? <small className="dops-grid__meta">{meta}</small> : null}
    </span>
  );
}

/** The way back, above the mast and never inside it. */
export function OpsBack({
  onClick,
  label = '‹ Operations',
  ariaLabel,
}: {
  onClick: () => void;
  label?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="arena-switch dops-back">
      <button type="button" onClick={onClick} aria-label={ariaLabel}>
        {label}
      </button>
    </div>
  );
}
