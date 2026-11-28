import type { ComponentProps } from 'react';
import type { SpadeConsole, PlateButtonProps } from '../console/SpadeConsole';
import '../ops/ArenaOps.css';
import './ClubPageSection.css';

type ClubPageSectionProps = ComponentProps<typeof SpadeConsole> & {
  /** #SmarterDesign (Dan 2026-11-27): a thin chrome case with a chrome title
   *  and its actions as one chrome switch, primary lit. */
  arena?: boolean;
};

/** Normal document sections for the operator pages whose frames the owner removed.
 * Keeps headings, status and actions in flow, with no art-sized text zones. */
export function ClubPageSection({
  eyebrow,
  title,
  titleAs: Heading = 'h2',
  titleId,
  subtitle,
  pill,
  pillInk = 'blue',
  plates,
  children,
  className = '',
  as: Tag = 'section',
  onClose,
  crest: _crest,
  family: _family,
  foot: _foot,
  arena = false,
  ...rest
}: ClubPageSectionProps) {
  const action = (props: PlateButtonProps, key: string) => {
    const { label, ink = 'blue', haptic, buttonRef, href, ...buttonProps } = props;
    void haptic;
    return href ? (
      <a key={key} href={href} className={`club-page-action sc-ink--${ink}`}>
        {label}
      </a>
    ) : (
      <button
        key={key}
        {...buttonProps}
        ref={buttonRef}
        type={buttonProps.type || 'button'}
        className={`club-page-action sc-ink--${ink}`}
      >
        {label}
      </button>
    );
  };
  if (arena) {
    const key = (props: PlateButtonProps, id: string, primary: boolean) => {
      const { label, ink, haptic, buttonRef, href, ...buttonProps } = props;
      void ink; // the arena keys take no painted ink
      void haptic;
      const cls = primary ? 'club-page-key--primary' : undefined;
      return href ? (
        <a key={id} href={href} className={cls}>
          {label}
        </a>
      ) : (
        <button
          key={id}
          {...buttonProps}
          ref={buttonRef}
          type={buttonProps.type || 'button'}
          className={cls}
        >
          {label}
        </button>
      );
    };
    /* The secondary key comes first and the primary last, so a dialog's focus
       trap still wraps from its decisive action back to Close. The primary is
       lit by its own class; with no secondary it is also the first child and
       arena-ops-primary lights it. */
    return (
      <Tag {...rest} className={`arena-case arena-ops-case ${className}`}>
        {eyebrow && <p className="arena-ops-eyebrow">{eyebrow}</p>}
        <div className="club-page-arena-head">
          <Heading id={titleId} className="arena-section-title">
            {title}
            {pill && <small>{pill}</small>}
          </Heading>
          {onClose && (
            <div className="arena-switch">
              <button type="button" onClick={onClose} aria-label="Close">
                Close
              </button>
            </div>
          )}
        </div>
        {subtitle && <p className="arena-ops-copy">{subtitle}</p>}
        {children}
        {plates && (plates.primary || plates.secondary) && (
          <div
            className={
              plates.secondary
                ? 'arena-switch arena-ops-keys club-page-keys'
                : 'arena-switch arena-ops-keys arena-ops-primary club-page-keys'
            }
          >
            {plates.secondary && key(plates.secondary, 'secondary', false)}
            {plates.primary && key(plates.primary, 'primary', true)}
          </div>
        )}
      </Tag>
    );
  }
  return (
    <Tag {...rest} className={`club-page-section ${className}`}>
      <header className="club-page-heading">
        <div>
          {eyebrow && <p className="club-page-eyebrow">{eyebrow}</p>}
          <Heading id={titleId}>{title}</Heading>
          {subtitle && <p className="club-page-subtitle">{subtitle}</p>}
        </div>
        {pill && <span className={`club-page-status sc-ink--${pillInk}`}>{pill}</span>}
        {onClose && (
          <button type="button" className="club-page-action" onClick={onClose} aria-label="Close">
            Close
          </button>
        )}
      </header>
      <div className="club-page-body">{children}</div>
      {plates && (
        <div className="club-page-actions">
          {plates.secondary && action(plates.secondary, 'secondary')}
          {plates.primary && action(plates.primary, 'primary')}
        </div>
      )}
    </Tag>
  );
}
