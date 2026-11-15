import { useEffect, useId, useState } from 'react';
import { useActionControllerSettings } from '../../hooks/useActionControllerSettings';
import {
  ACTION_CONTROLLER_COLORS,
  DEFAULT_ACTION_CONTROLLER,
  validBetPresets,
} from '../../lib/actionController';
import './ActionController.css';

function PresetEditor({
  label,
  values,
  defaults,
  max,
  suffix,
  onApply,
}: {
  label: string;
  values: number[];
  defaults: number[];
  max: number;
  suffix: string;
  onApply: (values: number[]) => void;
}) {
  const [draft, setDraft] = useState(values.map(String));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const key = values.join(',');
  useEffect(() => {
    if (!dirty) setDraft(key.split(','));
  }, [key, dirty]);
  const apply = () => {
    const parsed = draft.map((value) => (value.trim() === '' ? NaN : Number(value)));
    if (!validBetPresets(parsed, max)) {
      setError(`Enter Four Values From 1 To ${max}, With At Most Two Decimal Places.`);
      return;
    }
    onApply(parsed);
    setError('');
    setDirty(false);
  };
  return (
    <fieldset className="action-controller-presets">
      <legend>{label}</legend>
      <div className="action-controller-preset-fields">
        {draft.map((value, index) => (
          <label key={index}>
            Option {index + 1} ({suffix})
            <input
              type="text"
              inputMode="decimal"
              value={value}
              aria-label={`${label} Option ${index + 1}`}
              onChange={(event) => {
                setDirty(true);
                setDraft((current) =>
                  current.map((entry, slot) => (slot === index ? event.target.value : entry))
                );
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  apply();
                }
              }}
            />
          </label>
        ))}
      </div>
      {error && (
        <div className="action-controller-preset-error" role="alert">
          {error}
        </div>
      )}
      <button type="button" onClick={apply}>
        Apply {label}
      </button>
      <button
        type="button"
        onClick={() => {
          onApply([...defaults]);
          setDraft(defaults.map(String));
          setDirty(false);
          setError('');
        }}
      >
        Restore Defaults
      </button>
    </fieldset>
  );
}

export function ActionControllerSettings() {
  const { settings, update } = useActionControllerSettings();
  const [editPresets, setEditPresets] = useState(false);
  const panelId = useId();
  const buttonId = useId();
  const colorsId = useId();
  const colorsTabId = useId();
  return (
    <section className="action-controller-settings" aria-label="Action Controller">
      <div
        className="action-controller-tabs"
        role="tablist"
        aria-label="Action Controller Settings"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? false : event.key === 'End' ? true : !editPresets;
          setEditPresets(next);
          const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
          tabs[next ? 1 : 0]?.focus();
        }}
      >
        <button
          className="action-controller-tab"
          type="button"
          role="tab"
          id={colorsTabId}
          aria-selected={!editPresets}
          aria-controls={colorsId}
          tabIndex={editPresets ? -1 : 0}
          onClick={() => setEditPresets(false)}
        >
          Action Controller
        </button>
        <button
          className="action-controller-tab"
          type="button"
          role="tab"
          id={buttonId}
          aria-selected={editPresets}
          aria-controls={panelId}
          tabIndex={editPresets ? 0 : -1}
          onClick={() => setEditPresets(true)}
        >
          Change Default Button Amounts
        </button>
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={buttonId} hidden={!editPresets}>
        <PresetEditor
          label="Preflop Multipliers"
          values={settings.preflop}
          defaults={DEFAULT_ACTION_CONTROLLER.preflop}
          max={100}
          suffix="X"
          onApply={(preflop) => update({ preflop })}
        />
        <PresetEditor
          label="Postflop Pot Percentages"
          values={settings.postflop}
          defaults={DEFAULT_ACTION_CONTROLLER.postflop}
          max={1000}
          suffix="%"
          onApply={(postflop) => update({ postflop })}
        />
        <p>
          Preflop Uses The Bet You Face, Or The Big Blind. Postflop Uses The Pot After Calling.
          Legal Minimums, Stack And Pot-Limit Caps Still Apply.
        </p>
      </div>
      <div role="tabpanel" id={colorsId} aria-labelledby={colorsTabId} hidden={editPresets}>
        <div className="action-controller-colors" aria-label="Action Controller Colors">
          {ACTION_CONTROLLER_COLORS.map((color) => (
            <button
              className="action-controller-choice"
              type="button"
              key={color.id}
              aria-pressed={settings.color === color.id}
              onClick={() => update({ color: color.id })}
            >
              <span
                className="action-controller-mini"
                data-controller-color={color.id}
                style={{ '--controller-filter': color.filter } as React.CSSProperties}
                aria-hidden="true"
              >
                <span className="action-controller-paint" />
                <span className="action-controller-allin-paint" />
                <strong>Raise 9</strong>
              </span>
              <span className="action-controller-choice-name">{color.name}</span>
            </button>
          ))}
        </div>
      </div>
      <p>Applies To All Your Tables. Tap Outside The Open Controller To Close It.</p>
    </section>
  );
}
