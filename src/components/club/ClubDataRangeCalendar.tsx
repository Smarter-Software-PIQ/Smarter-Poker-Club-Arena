import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SpadeConsole } from '../console/SpadeConsole';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { addCalendarDays, isCalendarDate } from '../../lib/clubDataDay';
import { clubDataRangeError, CLUB_DATA_MAX_DAYS, clubDataOldestDay } from '../../lib/clubDataRange';
import styles from './ClubDataRangeCalendar.module.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dateName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const monthName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
const monthOf = (day: string) => `${day.slice(0, 7)}-01`;
function shiftMonth(day: string, count: number) {
  const d = new Date(`${monthOf(day)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + count);
  return d.toISOString().slice(0, 10);
}

/** One calendar; both selected dates are included in the reporting window. */
export default function ClubDataRangeCalendar({
  start,
  end,
  today,
  zoneLabel,
  maxDays = CLUB_DATA_MAX_DAYS,
  onApply,
  onClose,
}: {
  start: string;
  end: string;
  today: string;
  zoneLabel?: string;
  maxDays?: number;
  onApply: (first: string, last: string) => void;
  onClose: () => void;
}) {
  const oldest = maxDays === CLUB_DATA_MAX_DAYS ? clubDataOldestDay(today) : null;
  const id = useId();
  const trap = useFocusTrap<HTMLDivElement>(true, '[data-calendar-focus="true"]');
  const grid = useRef<HTMLDivElement>(null);
  const [first, setFirst] = useState(start);
  const [last, setLast] = useState(end);
  const [choosingEnd, setChoosingEnd] = useState(false);
  const [month, setMonth] = useState(monthOf(end));
  const [focusDay, setFocusDay] = useState(end);
  const [error, setError] = useState<string | null>(null);
  const weekday = (new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7;
  const firstCell = addCalendarDays(month, -weekday);

  // A first answer can discover Pacific while the picker is already open.
  // Do not retain a date that is tomorrow on the club's confirmed basis.
  useEffect(() => {
    if (last <= today) return;
    if (first > today) setFirst(today);
    setLast(today);
    setMonth(monthOf(today));
    setFocusDay(today);
  }, [today, first, last]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const choose = (day: string) => {
    setError(null);
    if (!choosingEnd) {
      setFirst(day);
      setLast(day);
      setChoosingEnd(true);
    } else {
      setFirst(day < first ? day : first);
      setLast(day < first ? first : day);
      setChoosingEnd(false);
    }
    setFocusDay(day);
  };

  const moveFocus = (day: string) => {
    if (!isCalendarDate(day) || day > today || (oldest !== null && day < oldest)) return;
    setMonth(monthOf(day));
    setFocusDay(day);
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus()
    );
  };

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={trap}
        id="club-data-date-range"
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <SpadeConsole
          title="Select Dates"
          titleId={id}
          eyebrow="Date Range"
          pill="Inclusive"
          className={styles.frame}
          onClose={onClose}
          closeLabel="Close Date Range"
          plates={{
            secondary: { label: 'Cancel', onClick: onClose },
            primary: {
              label: 'Apply Dates',
              onClick: () => {
                const problem = clubDataRangeError(first, last, today, maxDays);
                setError(problem);
                if (!problem) onApply(first, last);
              },
            },
          }}
        >
          <p className={`sc-copy sc-copy--center ${styles.selection}`} aria-live="polite">
            <span className="sc-ink--blue">From </span>
            {dateName(first)}
            <br />
            <span className="sc-ink--blue">Through </span>
            {dateName(last)}
          </p>
          <p className={`sc-label sc-ink--muted ${styles.hint}`}>
            {zoneLabel && `${zoneLabel}. `}Both Dates Included.
          </p>
          <div className={styles.navigation}>
            <button
              type="button"
              className={styles.word}
              aria-label="Previous Month"
              disabled={oldest !== null && month <= monthOf(oldest)}
              onClick={() => {
                const next = shiftMonth(month, -1);
                setMonth(next);
                setFocusDay(next);
              }}
            >
              Prev
            </button>
            <h3 className={`sc-ink--silver ${styles.month}`}>{monthName(month)}</h3>
            <button
              type="button"
              className={styles.word}
              aria-label="Next Month"
              disabled={month >= monthOf(today)}
              onClick={() => {
                const next = shiftMonth(month, 1);
                setMonth(next);
                setFocusDay(next);
              }}
            >
              Next
            </button>
          </div>
          <div ref={grid} role="grid" aria-label={monthName(month)} className={styles.grid}>
            <div role="row" className={styles.week}>
              {WEEKDAYS.map((day) => (
                <span key={day} role="columnheader" className={styles.weekday}>
                  {day}
                </span>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, row) => (
              <div role="row" className={styles.week} key={row}>
                {Array.from({ length: 7 }, (_, col) => {
                  const day = addCalendarDays(firstCell, row * 7 + col);
                  const inMonth = monthOf(day) === month;
                  const selected = day >= first && day <= last;
                  return (
                    <div role="gridcell" aria-selected={inMonth && selected} key={day}>
                      {inMonth && (
                        <button
                          type="button"
                          className={`${styles.day} ${selected ? styles.selected : ''}`}
                          data-day={day}
                          data-calendar-focus={day === focusDay ? 'true' : undefined}
                          aria-label={dateName(day)}
                          aria-pressed={selected}
                          aria-current={day === today ? 'date' : undefined}
                          disabled={day > today || (oldest !== null && day < oldest)}
                          tabIndex={day === focusDay ? 0 : -1}
                          onClick={() => choose(day)}
                          onKeyDown={(event) => {
                            const offset = {
                              ArrowLeft: -1,
                              ArrowRight: 1,
                              ArrowUp: -7,
                              ArrowDown: 7,
                            }[event.key];
                            if (offset !== undefined) {
                              event.preventDefault();
                              moveFocus(addCalendarDays(day, offset));
                            }
                          }}
                        >
                          {Number(day.slice(8))}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className={`sc-copy sc-copy--center sc-ink--muted ${styles.hint}`}>
            {choosingEnd
              ? 'Select The Last Day, Or Apply For One Day.'
              : 'Select The First Day, Then The Last Day.'}
          </p>
          {error && (
            <p role="alert" className="sc-copy sc-ink--red">
              {error}
            </p>
          )}
        </SpadeConsole>
      </div>
    </div>,
    document.body
  );
}
