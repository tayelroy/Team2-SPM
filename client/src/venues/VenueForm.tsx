import { useState } from 'react';
import type { FormEvent } from 'react';
import { Card, Eyebrow, GhostButton, RecessedCard } from '../ui';
import { color, gradient, label, radius, rule, surface } from '../theme';
import type { Venue, VenueValues } from './api';
import { LAYOUT_LABELS, LAYOUTS } from './layoutsApi';
import type { Layout, VenueLayout, VenueLayoutValues } from './layoutsApi';

const FIELDS = [
  ['name', 'Venue name', 'e.g. Atrium Hall'],
  ['location', 'Location', 'e.g. Level 1, North Wing'],
  ['capacity', 'Capacity', 'Maximum number of guests'],
  ['facilities', 'Facilities', 'e.g. Stage, projector, catering kitchen'],
  ['accessibility_features', 'Accessibility features', 'e.g. Step-free entrance, hearing loop'],
  ['operating_information', 'Operating information', 'e.g. Mon–Fri, 09:00–22:00. Staff access from 08:00.']
] as const;
const EMPTY = { name: '', location: '', capacity: '', facilities: '', accessibility_features: '', operating_information: '' };
export const inputStyle = {
  width: '100%', minWidth: 0, background: surface.field, border: rule.control,
  borderRadius: radius.sm, padding: '13px 14px', color: color.mist, fontSize: '14px', lineHeight: 1.5
};

export default function VenueForm({ venue, layouts, saving, error, onSave, onCancel }: {
  venue: Venue | null;
  /** The venue's current supported layouts (SG2-43). Only passed — and only
   * then is the layouts section shown — when editing an existing venue and
   * the caller may manage them; omitted entirely while creating a venue,
   * since layouts need a venue id that does not exist yet. */
  layouts?: VenueLayout[];
  saving: boolean;
  error: string;
  onSave: (values: VenueValues, layouts?: VenueLayoutValues[]) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(() => venue ? {
    name: venue.name, location: venue.location ?? '', capacity: venue.capacity === null ? '' : String(venue.capacity),
    facilities: venue.facilities ?? '', accessibility_features: venue.accessibility_features ?? '',
    operating_information: venue.operating_information ?? ''
  } : EMPTY);
  const [invalid, setInvalid] = useState(false);
  const [selectedLayouts, setSelectedLayouts] = useState<Set<Layout>>(() => new Set((layouts ?? []).map(item => item.layout)));
  const [otherDescription, setOtherDescription] = useState(() => layouts?.find(item => item.layout === 'other')?.other_description ?? '');
  const [layoutsInvalid, setLayoutsInvalid] = useState(false);

  function toggleLayout(layout: Layout) {
    setSelectedLayouts(current => {
      const next = new Set(current);
      if (next.has(layout)) next.delete(layout); else next.add(layout);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const capacity = Number(values.capacity);
    const venueInvalid = !Number.isInteger(capacity) || capacity < 1 || capacity > 2147483647 ||
      FIELDS.some(([key]) => !values[key].trim()) || Array.from(values.name.trim()).length > 255;
    const otherNeedsDescription = layouts !== undefined && selectedLayouts.has('other') &&
      (!otherDescription.trim() || Array.from(otherDescription.trim()).length > 255);
    setInvalid(venueInvalid);
    setLayoutsInvalid(otherNeedsDescription);
    if (venueInvalid || otherNeedsDescription) return;
    const venueValues: VenueValues = { name: values.name.trim(), location: values.location.trim(), capacity,
      facilities: values.facilities.trim(), accessibility_features: values.accessibility_features.trim(),
      operating_information: values.operating_information.trim() };
    if (layouts === undefined) {
      onSave(venueValues);
      return;
    }
    const layoutValues: VenueLayoutValues[] = Array.from(selectedLayouts).map(layout =>
      layout === 'other' ? { layout, other_description: otherDescription.trim() } : { layout });
    onSave(venueValues, layoutValues);
  }

  return (
    <div className="venue-editor">
      <Card padding="clamp(20px, 4vw, 36px)" style={{ gap: '24px', minWidth: 0 }}>
        <div>
          <Eyebrow>Venue records</Eyebrow>
          <h2 style={{ fontSize: '28px', fontWeight: 500, letterSpacing: '-0.03em', margin: '10px 0 0' }}>
            {venue ? 'Edit venue' : 'Add venue'}
          </h2>
        </div>
        <form onSubmit={submit} aria-label={venue ? 'Edit venue' : 'Add venue'}>
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="venue-fields">
              {FIELDS.map(([key, title, placeholder]) => (
                <div key={key} className={key === 'operating_information' ? 'venue-field-wide' : undefined}
                  style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                  <label htmlFor={`venue-${key}`} style={label}>{title}</label>
                  {key === 'operating_information' ? (
                    <textarea id={`venue-${key}`} rows={4} required value={values[key]} placeholder={placeholder}
                      style={{ ...inputStyle, resize: 'vertical' }}
                      onChange={e => setValues(current => ({ ...current, [key]: e.target.value }))} />
                  ) : (
                    <input id={`venue-${key}`} required type={key === 'capacity' ? 'number' : 'text'}
                      min={key === 'capacity' ? 1 : undefined} max={key === 'capacity' ? 2147483647 : undefined}
                      step={key === 'capacity' ? 1 : undefined} value={values[key]} placeholder={placeholder}
                      style={inputStyle} onChange={e => setValues(current => ({ ...current, [key]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
            <p style={{ color: color.silver, fontSize: '13px', lineHeight: 1.5 }}>
              All fields are required. If a feature is not available, record “None”.
            </p>
            {invalid ? <p role="alert">Complete every field, keep the name within 255 characters and enter a positive whole-number capacity.</p> : null}
            {layouts !== undefined ? (
              <div style={{ marginTop: '28px', paddingTop: '24px', borderTop: rule.edge, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <Eyebrow>Supported layouts</Eyebrow>
                  <p style={{ margin: '8px 0 0', color: color.silver, fontSize: '13px', lineHeight: 1.5 }}>
                    Select every layout this venue supports. A venue that does not support a required layout will not be offered as a match when one is requested.
                  </p>
                </div>
                {LAYOUTS.map(layout => (
                  <div key={layout} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: color.mist, fontSize: '14px' }}>
                      <input type="checkbox" checked={selectedLayouts.has(layout)} onChange={() => toggleLayout(layout)} />
                      {LAYOUT_LABELS[layout]}
                    </label>
                    {layout === 'other' && selectedLayouts.has('other') ? (
                      <input
                        type="text"
                        aria-label="Describe the other layout"
                        required
                        value={otherDescription}
                        placeholder="Describe this layout"
                        style={{ ...inputStyle, marginLeft: '26px', width: 'auto' }}
                        onChange={e => setOtherDescription(e.target.value)}
                      />
                    ) : null}
                  </div>
                ))}
                {layoutsInvalid ? <p role="alert">Describe the "Other" layout in 255 characters or fewer.</p> : null}
              </div>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '24px' }}>
              <button type="submit" style={{ border: 0, borderRadius: radius.sm, padding: '15px 22px',
                background: gradient.aurora, color: '#222', fontSize: '14px', cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Saving…' : venue ? 'Save changes' : 'Create venue'}
              </button>
              <GhostButton onClick={onCancel}>Cancel</GhostButton>
            </div>
          </fieldset>
        </form>
      </Card>
      <RecessedCard padding="28px" style={{ gap: '14px', alignSelf: 'start' }}>
        <Eyebrow>Keep planning information current</Eyebrow>
        <p style={{ margin: 0, color: color.silver, fontSize: '14px', lineHeight: 1.6 }}>
          Saved details appear in the venue catalogue and search. Include access instructions and operating hours so coordinators can plan with confidence.
        </p>
      </RecessedCard>
    </div>
  );
}
