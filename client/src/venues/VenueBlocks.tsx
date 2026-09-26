import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Card, Eyebrow, GhostButton, Notice, RecessedCard } from '../ui';
import { color, gradient, label, radius, rule } from '../theme';
import { inputStyle } from './VenueForm';
import type { Venue } from './api';
import { VenueBlockError, createVenueBlock, describePeriod, fetchVenueBlocks, removeVenueBlock, type VenueBlock } from './blocksApi';

const EMPTY = { start: '', end: '', reason: '' };
const MAX_REASON_LENGTH = 500;

/** Venue Staff block a venue from use for a period, or remove a block (SG2-45). */
export default function VenueBlocks({ token, venue, onClose, onAccessLost }: {
  token: string;
  venue: Venue;
  onClose: () => void;
  /** The session expired or the role changed; the catalogue must drop its data. */
  onAccessLost: (message: string) => void;
}) {
  const [blocks, setBlocks] = useState<VenueBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState(EMPTY);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const pending = useRef<AbortController | null>(null);

  function report(failure: unknown) {
    if (failure instanceof VenueBlockError && [401, 403].includes(failure.status)) {
      onAccessLost(failure.message);
      return;
    }
    setError(failure instanceof VenueBlockError ? failure.message : 'Unable to reach the venue service. Please try again.');
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchVenueBlocks(token, controller.signal, venue.venue_id)
      .then(setBlocks)
      .catch(failure => { if (!controller.signal.aborted) report(failure); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // report only reads props that remount this screen when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, venue.venue_id]);

  useEffect(() => () => { pending.current?.abort(); }, []);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await action(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) report(failure);
    } finally {
      pending.current = null;
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const starts = Date.parse(values.start);
    const ends = Date.parse(values.end);
    const reason = values.reason.trim();
    const rejected = Number.isNaN(starts) || Number.isNaN(ends) || starts >= ends || ends <= Date.now() ||
      !reason || Array.from(reason).length > MAX_REASON_LENGTH;
    setInvalid(rejected);
    if (rejected) return;
    void run(async signal => {
      const block = await createVenueBlock(token, signal, venue.venue_id, {
        starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(), reason
      });
      setBlocks(current => [...current, block].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      setValues(EMPTY);
      setStatus(`${venue.name} is blocked ${describePeriod(block.starts_at, block.ends_at)}.`);
    });
  }

  function remove(block: VenueBlock) {
    void run(async signal => {
      await removeVenueBlock(token, signal, venue.venue_id, block.unavailability_id);
      setBlocks(current => current.filter(item => item.unavailability_id !== block.unavailability_id));
      setStatus(`Block removed. ${venue.name} is available again ${describePeriod(block.starts_at, block.ends_at)}.`);
    });
  }

  return (
    <div className="venue-editor">
      <Card padding="clamp(20px, 4vw, 36px)" style={{ gap: '24px', minWidth: 0 }}>
        <div>
          <Eyebrow>Venue availability</Eyebrow>
          <h2 style={{ fontSize: '28px', fontWeight: 500, letterSpacing: '-0.03em', margin: '10px 0 0', overflowWrap: 'anywhere' }}>
            Block {venue.name}
          </h2>
        </div>
        {status ? <Notice><span role="status">{status}</span></Notice> : null}
        {error ? <p role="alert">{error}</p> : null}
        <section aria-label="Upcoming blocks" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Eyebrow>Upcoming blocks</Eyebrow>
          {loading ? <p role="status">Loading blocks…</p> : blocks.length === 0 ? (
            <p style={{ margin: 0, color: color.silver, fontSize: '14px' }}>No upcoming blocks. {venue.name} is available unless booked.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
              {blocks.map(block => (
                <li key={block.unavailability_id} aria-label={block.reason}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
                    paddingBottom: '12px', borderBottom: rule.edge, overflowWrap: 'anywhere' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                    <span style={{ color: color.mist, fontSize: '14px' }}>{describePeriod(block.starts_at, block.ends_at)}</span>
                    <span style={{ color: color.silver, fontSize: '13px' }}>{block.reason}</span>
                  </div>
                  <GhostButton onClick={() => remove(block)} disabled={busy}>Remove block</GhostButton>
                </li>
              ))}
            </ul>
          )}
        </section>
        <form onSubmit={submit} aria-label="Block venue" style={{ paddingTop: '24px', borderTop: rule.edge }}>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="venue-fields">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <label htmlFor="block-start" style={label}>Unavailable from</label>
                <input id="block-start" type="datetime-local" required value={values.start} style={inputStyle}
                  onChange={e => setValues(current => ({ ...current, start: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <label htmlFor="block-end" style={label}>Unavailable until</label>
                <input id="block-end" type="datetime-local" required value={values.end} style={inputStyle}
                  onChange={e => setValues(current => ({ ...current, end: e.target.value }))} />
              </div>
              <div className="venue-field-wide" style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <label htmlFor="block-reason" style={label}>Reason</label>
                <textarea id="block-reason" rows={3} required value={values.reason} placeholder="e.g. Scheduled maintenance"
                  style={{ ...inputStyle, resize: 'vertical' }}
                  onChange={e => setValues(current => ({ ...current, reason: e.target.value }))} />
              </div>
            </div>
            {invalid ? <p role="alert">Enter a period that ends after it starts and has not already ended, and a reason within {MAX_REASON_LENGTH} characters.</p> : null}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '24px' }}>
              <button type="submit" style={{ border: 0, borderRadius: radius.sm, padding: '15px 22px',
                background: gradient.aurora, color: '#222', fontSize: '14px', cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'Saving…' : 'Block venue'}
              </button>
              <GhostButton onClick={onClose}>Back to catalogue</GhostButton>
            </div>
          </fieldset>
        </form>
      </Card>
      <RecessedCard padding="28px" style={{ gap: '14px', alignSelf: 'start' }}>
        <Eyebrow>While a venue is blocked</Eyebrow>
        <p style={{ margin: 0, color: color.silver, fontSize: '14px', lineHeight: 1.6 }}>
          Blocked periods show as unavailable on the Venue Availability calendar, so the venue is not offered for events then.
          A period that already holds a confirmed booking cannot be blocked. Removing a block makes the venue available again.
        </p>
      </RecessedCard>
    </div>
  );
}
