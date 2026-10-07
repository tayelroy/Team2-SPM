import { useState, type FormEvent } from 'react';
import { STATUS_LABELS, type EquipmentRecord, type EquipmentValues, type OperationalStatus } from '../api/equipment';
import { Card, Eyebrow, GhostButton } from '../ui';
import { color, gradient, label, radius } from '../theme';
import { inputStyle } from '../venues/VenueForm';
const TEXT_FIELDS = [['type', 'Equipment type', 255], ['description', 'Description', 2000], ['location', 'Location', 2000]] as const;
export default function EquipmentForm({ equipment, saving, error, conflict, onSave, onCancel, onReload }: {
  equipment: EquipmentRecord | null; saving: boolean; error: string; conflict: boolean;
  onSave: (values: EquipmentValues) => void; onCancel: () => void; onReload: () => void;
}) {
  const [values, setValues] = useState(() => equipment ? {
    type: equipment.type, description: equipment.description, location: equipment.location,
    quantity: String(equipment.quantity_held), status: equipment.operational_status,
  } : { type: '', description: '', location: '', quantity: '', status: 'operational' as OperationalStatus });
  const [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || conflict) return;
    if (TEXT_FIELDS.some(([key, , max]) => !values[key].trim() || Array.from(values[key].trim()).length > max) ||
        !/^\d+$/.test(values.quantity) || Number(values.quantity) > 2147483647) {
      setInvalid(true); return;
    }
    setInvalid(false);
    onSave({ type: values.type.trim(), description: values.description.trim(), location: values.location.trim(),
      quantity_held: Number(values.quantity), operational_status: values.status });
  }
  return <Card padding="clamp(20px, 4vw, 36px)" style={{ gap: '24px', maxWidth: '840px', minWidth: 0 }}>
    <div><Eyebrow>Equipment records</Eyebrow><h2 style={{ fontSize: '28px', margin: '10px 0 0' }}>{equipment ? 'Edit equipment' : 'Add equipment'}</h2></div>
    <form aria-label={equipment ? 'Edit equipment' : 'Add equipment'} onSubmit={submit} noValidate>
      <fieldset disabled={saving || conflict} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '20px' }}>
          {TEXT_FIELDS.map(([key, title]) => <label key={key} htmlFor={`equipment-${key}`} style={{ ...label, display: 'grid', gap: '8px', minWidth: 0 }}>
            {title}<input id={`equipment-${key}`} required value={values[key]} style={inputStyle}
              onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} />
          </label>)}
          <label htmlFor="equipment-quantity" style={{ ...label, display: 'grid', gap: '8px', minWidth: 0 }}>Quantity held
            <input id="equipment-quantity" required type="number" min={0} max={2147483647} step={1} value={values.quantity} style={inputStyle}
              onChange={event => setValues(current => ({ ...current, quantity: event.target.value }))} />
          </label>
          <label htmlFor="equipment-status" style={{ ...label, display: 'grid', gap: '8px', minWidth: 0 }}>Operational status
            <select id="equipment-status" value={values.status} style={inputStyle}
              onChange={event => setValues(current => ({ ...current, status: event.target.value as OperationalStatus }))}>
              {Object.entries(STATUS_LABELS).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
            </select>
          </label>
        </div>
      </fieldset>
      <p style={{ color: color.silver, lineHeight: 1.5 }}>All fields are required. Damaged equipment and equipment under maintenance contribute no available stock.</p>
      {invalid ? <p role="alert">Complete every field. Equipment type allows 255 characters; description and location allow 2,000. Quantity must be a whole number from 0 to 2,147,483,647.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        <button type="submit" disabled={saving || conflict} style={{ background: gradient.aurora, border: 0, borderRadius: radius.sm,
          padding: '15px 22px', color: '#222222', fontSize: '14px', cursor: saving || conflict ? 'default' : 'pointer', opacity: saving || conflict ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save equipment'}
        </button>
        <GhostButton disabled={saving} onClick={onCancel}>Cancel</GhostButton>
        {conflict ? <GhostButton onClick={onReload}>Reload records</GhostButton> : null}
      </div>
    </form>
  </Card>;
}
