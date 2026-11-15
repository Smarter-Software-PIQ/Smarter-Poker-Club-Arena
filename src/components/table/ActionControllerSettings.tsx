import { useEffect, useState } from 'react';
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
      setError(`Enter Four Values From 1 To ${max}, With At Most One Decimal Place.`);
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

export function ActionControllerSettings({ colorsOnly = false }: { colorsOnly?: boolean }) {
  const { settings, update } = useActionControllerSettings();
  return (
    <section className="action-controller-settings" aria-label="Action Controller">
      <h3>Action Controller</h3>
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
      <p>Applies To All Your Tables. Tap Outside The Open Controller To Close It.</p>
      {!colorsOnly && (
        <>
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
        </>
      )}
    </section>
  );
}
