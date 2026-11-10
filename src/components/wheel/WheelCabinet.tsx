import { useRef, type ReactNode } from 'react';
import type { DeckBay } from '../console/DeckConsole';
import { type PlateButtonProps, type ConsoleInk } from '../console/SpadeConsole';
import { WheelPrizeArt } from './WheelPrizeArt';
import { wheelPrizeTitle } from './WheelExperience';
import type { WheelSegment } from '../../services/DiamondWheelService';
import { TapHaptic } from '../haptics/TapHaptic';
import styles from './WheelCabinet.module.css';

/** The wheel and its attached controls share one available play viewport. */
export function WheelCabinet({
  title,
  titleId,
  bays,
  primary,
  entry,
  setup,
  navigation,
  notice,
  children,
}: {
  title: string;
  titleId?: string;
  pill?: string;
  pillInk?: ConsoleInk;
  bays: DeckBay[];
  primary?: PlateButtonProps;
  entry?: ReactNode;
  setup?: ReactNode;
  navigation?: ReactNode;
  notice?: ReactNode;
  /** The painted "?" (Dan 2026-10-17), top right of the cabinet's heading. */
  children?: ReactNode;
} & Record<string, unknown>) {
  return (
    <section className={styles.cabinet} aria-labelledby={titleId}>
      <header className={styles.heading}>
        <h1 id={titleId}>
          <img
            className={styles.titleBadge}
            src={`${import.meta.env.BASE_URL}assets/diamond-spins/diamond-spins-badge.webp`}
            width="780"
            height="131"
            alt={title}
          />
        </h1>
        {navigation && <div className={styles.headerAction}>{navigation}</div>}
      </header>
      <div className={styles.wheel}>{children}</div>
      <aside className={styles.controls} aria-label="Diamond Spins Controls">
        {setup}
        <div className={styles.dashboard}>
          {entry}
          <dl className={styles.metrics}>
            {bays.map((bay) => (
              <div key={bay.label}>
                <dt>{bay.label}</dt>
                <dd data-ink={bay.ink}>{bay.value}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.actions}>
            {primary && (
              <button
                type="button"
                className={styles.primary}
                onClick={primary.onClick}
                disabled={primary.disabled}
                data-ink={primary.ink}
                data-compact-label={
                  primary.label !== undefined && !/^Spin [\d,]+$/.test(primary.label)
                    ? true
                    : undefined
                }
              >
                {primary.label?.startsWith('Spin ') && /^Spin [\d,]+$/.test(primary.label) ? (
                  <span aria-label={primary.label}>
                    Spin<span className={styles.srOnly}> {primary.label.slice(5)}</span>
                  </span>
                ) : (
                  primary.label
                )}
                <TapHaptic disabled={primary.disabled} radius="4px" />
              </button>
            )}
          </div>
        </div>
        <div className={styles.notice}>{notice}</div>
      </aside>
    </section>
  );
}

export function WheelPrizeGallery({ segments }: { segments: WheelSegment[] }) {
  return (
    <section className={styles.prizes} aria-label="Wheel Prizes">
      <h2>{segments.length === 12 ? 'The Twelve Prizes' : 'The Prizes'}</h2>
      {segments.some((s) => s.kind === 'upgrade') && (
        <p>Land On A Bonus Game To Play. Upgrade Opens Super Games And Instant Chip Wins.</p>
      )}
      <ul>
        {[...segments]
          .sort((a, b) => a.ord - b.ord)
          .map((segment, i) => (
            <li key={segment.ord}>
              <WheelPrizeArt segment={segment} className={styles.prizeArt} />
              <strong>{wheelPrizeTitle(segment)}</strong>
              {segment.kind === 'chips' && segment.multiplier && (
                <span>{segment.multiplier}x Chip Payout</span>
              )}
              {segment.kind === 'bonus' && <span>Bonus Game</span>}
              {segment.kind === 'upgrade' && <span>Super Games And Chip Wins</span>}
              <i aria-hidden="true" style={{ animationDelay: `${i * -0.2}s` }} />
            </li>
          ))}
      </ul>
    </section>
  );
}

export function WheelEntry({
  value,
  availableDiamonds,
  disabled,
  onChange,
}: {
  value: number;
  availableDiamonds?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const picker = useRef<HTMLDialogElement>(null);
  return (
    <div className={styles.entry}>
      <button
        type="button"
        className={styles.amountToggle}
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => picker.current?.showModal()}
      >
        Amount {Number.isFinite(value) && value.toLocaleString()} ▾
      </button>
      <span className={styles.srOnly} id="diamond-spin-range">
        {availableDiamonds != null ? `Available: ${availableDiamonds.toLocaleString()}` : null}
      </span>
      <dialog ref={picker} className={styles.amountDialog} aria-label="Choose Spin Amount">
        <form method="dialog" className={styles.stakePanel}>
          <label htmlFor="diamond-spin-entry">Diamonds To Spin</label>
          <input
            id="diamond-spin-entry"
            aria-describedby="diamond-spin-range"
            autoFocus
            type="number"
            inputMode="numeric"
            min={1}
            max={availableDiamonds}
            step={1}
            value={Number.isNaN(value) ? '' : value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.valueAsNumber)}
          />

          <button
            type="button"
            className={styles.max}
            disabled={disabled || !availableDiamonds}
            onClick={() => {
              if (availableDiamonds) onChange(availableDiamonds);
            }}
          >
            Max
          </button>
          <button className={styles.done} type="submit">
            Done
          </button>
        </form>
      </dialog>
      <div className={styles.presets}>
        {[25, 100, 500, 1000, 2500].map((amount) => (
          <button
            key={amount}
            type="button"
            disabled={disabled || (availableDiamonds != null && amount > availableDiamonds)}
            aria-pressed={value === amount}
            onClick={() => onChange(amount)}
          >
            {amount.toLocaleString()}
          </button>
        ))}
      </div>
    </div>
  );
}
