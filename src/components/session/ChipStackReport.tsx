import { useId } from 'react';
import { useFitText } from '../lobby/game-cards/useFitText';
import './ChipStackReport.css';

type Stat = { label: string; value: string };
type Action = { label: string; onClick: () => void; disabled?: boolean };

function Fitted({ text, className }: { text: string; className: string }) {
  const ref = useFitText<HTMLSpanElement>(text, 1, 0.28);
  return (
    <span className={className}>
      <span ref={ref}>{text}</span>
    </span>
  );
}

export function ChipStackReport({
  name,
  headline,
  value,
  loss,
  stats,
  onClose,
  onView,
  share,
  primary,
}: {
  name: string;
  headline: string;
  value: string;
  loss?: boolean;
  stats: Stat[];
  onClose: () => void;
  onView: () => void;
  share: Action;
  primary: Action;
}) {
  const id = useId();
  const lobby = primary.label.toLowerCase() === 'game lobby';
  return (
    <section className="chip-report" aria-labelledby={id}>
      <h2 id={id} className="chip-report__reader">
        Session Results
      </h2>
      <button className="chip-report__close" aria-label="Close Session Results" onClick={onClose} />
      <Fitted text={name} className="chip-report__name" />
      <Fitted text={headline} className="chip-report__headline" />
      <Fitted
        text={value}
        className={'chip-report__amount' + (loss ? ' chip-report__amount--loss' : '')}
      />
      <dl className="chip-report__stats">
        {[0, 3, 6, 9].map((start, index) => (
          <div className="chip-report__row" key={start}>
            {stats.slice(start, start + (index === 3 ? 2 : 3)).map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd
                  className={
                    stat.label === 'Net'
                      ? loss
                        ? 'chip-report__net--loss'
                        : 'chip-report__net'
                      : undefined
                  }
                >
                  {stat.value}
                </dd>
              </div>
            ))}
          </div>
        ))}
      </dl>
      <button className="chip-report__view" onClick={onView} aria-label="View Session" />
      <button
        className="chip-report__share"
        onClick={share.onClick}
        disabled={share.disabled}
        aria-label="Share"
      />
      {share.label.toLowerCase() !== 'share' && (
        <span className="chip-report__feedback" role="status">
          {share.label}
        </span>
      )}
      <button
        className={'chip-report__primary' + (lobby ? '' : ' chip-report__primary--replay')}
        onClick={primary.onClick}
        disabled={primary.disabled}
        aria-label={primary.label}
      >
        {!lobby && <span>{primary.label}</span>}
      </button>
    </section>
  );
}
