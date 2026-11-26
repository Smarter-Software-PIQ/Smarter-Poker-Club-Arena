import { useId, type ComponentPropsWithoutRef } from 'react';
import './StatsSection.css';

type StatsSectionProps = ComponentPropsWithoutRef<'section'> & {
  title: string;
  titleId?: string;
  eyebrow: string;
  subtitle?: string;
  status: string;
};

export default function StatsSection({
  title,
  titleId,
  eyebrow,
  subtitle,
  status,
  children,
  className = '',
  ...region
}: StatsSectionProps) {
  const generatedId = useId();
  const headingId = titleId ?? generatedId;

  return (
    <section
      className={`stats-report-section ${className}`.trim()}
      aria-labelledby={region['aria-label'] ? undefined : headingId}
      {...region}
    >
      <header className="stats-report-heading">
        <div>
          <span className="stats-section-label">{eyebrow}</span>
          <h2 id={headingId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <span className="stats-report-status">{status}</span>
      </header>
      {children}
    </section>
  );
}
